import { describe, expect, it, vi } from 'vitest';
import type { AssistantSource, AssistantTransport, AssistantToolCall, AssistantRequest } from '@tano/protocol';
import { AssistantStream, proposalFromTool, runAssistant } from './engine';

const source: AssistantSource = { id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: 'note.md',
  content: '---\ntitle: 测试\n---\n\n论证一。\n\n论证二。[引用](paper.pdf)\n', hash: 'hash', origin: 'draft' };
const call = (name: string, args: unknown): AssistantToolCall => ({ id: 'call_one', type: 'function', function: { name, arguments: JSON.stringify(args) } });
const encode = (frames: unknown[]) => new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
const responseFrames = (frames: unknown[]) => new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''));

describe('assistant streaming and proposals', () => {
  it.each(['propose_task_update', 'propose_assignment', 'propose_relation_change'])('routes %s through authorized proposal review without writing', async name => {
    for (const allowed of [false, true]) {
      const requests: AssistantRequest[] = [];
      const proposals: unknown[] = [];
      const propose = vi.fn(async () => ({ id: 'suggestion', status: 'ready' } as never));
      const transport = { async request(_id, request, _signal, chunk) {
        requests.push(structuredClone(request));
        chunk(encode(requests.length === 1 ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call(name, {}) }] } }] }]
          : [{ choices: [{ index: 0, delta: { content: '等待审阅' }, finish_reason: 'stop' }] }]));
      } } as AssistantTransport;
      await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run',
        sources: [], history: [], prompt: '跟进事项', signal: new AbortController().signal, delta: () => {}, progress: () => {},
        proposal: proposal => proposals.push(proposal), ...(allowed ? { structures: { read: async () => ({}), propose } } : {}),
      });
      expect(requests[0].tools?.some(tool => tool.function.name === name)).toBe(allowed);
      expect(propose).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(proposals).toHaveLength(allowed ? 1 : 0);
      const result = JSON.parse(requests[1].messages.at(-1)!.content!);
      expect(result.written).toBe(false);
      if (allowed) expect(result.status).toBe('awaiting_review');
      else expect(result.error).toContain('未允许');
    }
  });
  it.each(['none', 'search', 'objects', 'both'])('scopes reference-context reads to both permissions (%s)', async permission => {
    const requests: AssistantRequest[] = [];
    const references = vi.fn(async () => ({ outgoing: [], incoming: [{ source: { type: 'event', id: 'a00001', name: 'Task' } }], errors: [] }));
    const transport = { async request(_id, request, _signal, chunk) {
      requests.push(structuredClone(request));
      chunk(encode(requests.length === 1 ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call('read_reference_context', { type: 'document', id: 'abc123' }) }] } }] }]
        : [{ choices: [{ index: 0, delta: { content: 'Done' }, finish_reason: 'stop' }] }]));
    } } as AssistantTransport;
    await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [], history: [], prompt: 'context', signal: new AbortController().signal,
      delta: () => {}, proposal: () => {}, progress: () => {}, references,
      ...(['search', 'both'].includes(permission) ? { lookup: { search: async () => [], read: async () => source } } : {}),
      ...(['objects', 'both'].includes(permission) ? { structures: { read: async () => ({}), propose: async () => { throw new Error('Unexpected proposal'); } } } : {}),
    });
    const names = requests[0].tools?.map(tool => tool.function.name) ?? [];
    expect(names.includes('read_reference_context')).toBe(permission === 'both');
    expect(references).toHaveBeenCalledTimes(permission === 'both' ? 1 : 0);
    const result = JSON.parse(requests[1].messages.at(-1)!.content!);
    if (permission === 'both') expect(result.incoming[0].source.name).toBe('Task');
    else expect(result.error).toContain('未同时允许');
  });
  it('reads Responses text once and retains reasoning and complete tools for continuation', () => {
    let text = '';
    const stream = new AssistantStream(delta => { text += delta; });
    const output = [
      { type: 'reasoning', id: 'rs_one', summary: [], encrypted_content: 'opaque-reasoning' },
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '中文内容' }] },
      { type: 'function_call', call_id: 'call_one', name: 'propose_create', arguments: '{"path":"new.md","content":"x","reason":"test"}', status: 'completed' },
    ];
    const bytes = responseFrames([
      { type: 'response.output_text.delta', delta: '中文内容' },
      { type: 'response.output_text.done', text: '中文内容' },
      { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"path":' },
      { type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 30, output_tokens: 12 } } },
    ]);
    for (const byte of bytes) stream.push(new Uint8Array([byte]));
    expect(stream.finish()).toEqual([call('propose_create', { path: 'new.md', content: 'x', reason: 'test' })]);
    expect(text).toBe('中文内容');
    expect(stream.responseItems).toEqual(output);
    expect(stream.usage).toEqual({ input: 30, output: 12 });
  });
  it('requires response.completed before permitting Responses tools', () => {
    const item = { type: 'function_call', call_id: 'one', name: 'propose_create', arguments: '{}' };
    const partial = new AssistantStream(() => {});
    partial.push(encode([{ type: 'response.output_item.done', item }]));
    expect(() => partial.finish()).toThrow('中断');
    for (const type of ['response.failed', 'response.incomplete']) {
      const failed = new AssistantStream(() => {});
      expect(() => failed.push(responseFrames([{ type, response: { output: [item] } }]))).toThrow('未完成');
    }
    const invalid = new AssistantStream(() => {});
    expect(() => invalid.push(responseFrames([{ type: 'response.completed', response: { status: 'incomplete', output: [item] } }]))).toThrow('完整');
  });
  it('returns complete Responses reasoning with tool receipts in the next request', async () => {
    const requests: AssistantRequest[] = [];
    const output = [
      { type: 'reasoning', encrypted_content: 'opaque', summary: [] },
      { type: 'function_call', call_id: 'call_one', name: 'propose_create', arguments: JSON.stringify({ path: 'new.md', content: 'x', reason: 'test' }) },
    ];
    const transport = { async request(_id, request, _signal, chunk) {
      requests.push(structuredClone(request));
      chunk(responseFrames([{ type: 'response.completed', response: { status: 'completed', output: requests.length === 1 ? output : [] } }]));
    } } as AssistantTransport;
    let suggestions = 0;
    await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [], history: [], prompt: '修改', signal: new AbortController().signal,
      delta: () => {}, proposal: () => { suggestions++; }, progress: () => {} });
    expect(suggestions).toBe(1);
    expect(requests[1].messages.at(-2)?.responseItems).toEqual(output);
    expect(requests[1].messages.at(-1)?.tool_call_id).toBe('call_one');
  });
  it('handles every UTF-8 and CRLF split and assembles streamed tool arguments', () => {
    let text = '';
    const stream = new AssistantStream(delta => { text += delta; });
    const frames = encode([
      { choices: [{ index: 0, delta: { content: '中文内容' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'one', type: 'function', function: { name: 'propose_edit', arguments: '{"sourceId":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"S1"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } },
    ]);
    for (const byte of frames) stream.push(new Uint8Array([byte]));
    expect(stream.finish()[0].function.arguments).toBe('{"sourceId":"S1"}');
    expect(text).toBe('中文内容'); expect(stream.usage).toEqual({ input: 30, output: 12 });
  });
  it('rejects truncated responses and partial tool calls before producing suggestions', () => {
    const stream = new AssistantStream(() => {});
    stream.push(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'));
    expect(() => stream.finish()).toThrow('中断');
    const incomplete = new AssistantStream(() => {});
    incomplete.push(encode([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] }]));
    expect(() => incomplete.finish()).toThrow('不完整');
  });
  it('preserves frontmatter and citations and refuses ambiguous or out-of-scope replacements', () => {
    const proposal = proposalFromTool(call('propose_edit', { sourceId: 'S1', oldText: '论证一。', newText: '改写一。', reason: '简化表达' }), [source], 'workspace', 'run');
    expect(proposal.content).toBe(source.content.replace('论证一。', '改写一。'));
    expect(proposal.base).toBe(source.content); expect(proposal.status).toBe('ready');
    expect(() => proposalFromTool(call('propose_edit', { sourceId: 'S2', oldText: '论证一。', newText: '', reason: 'test' }), [source], 'workspace', 'run')).toThrow('只能修改');
    expect(() => proposalFromTool(call('propose_edit', { sourceId: 'S1', oldText: 'same', newText: '', reason: 'test' }), [{ ...source, content: 'same same' }], 'workspace', 'run')).toThrow('不唯一');
    const selected = { ...source, selection: { text: '论证一。', from: source.content.indexOf('论证一。'), to: source.content.indexOf('论证一。') + 4 } };
    expect(() => proposalFromTool(call('propose_edit', { sourceId: 'S1', oldText: '论证二。', newText: '', reason: 'test' }), [selected], 'workspace', 'run')).toThrow('超出');
    expect(() => proposalFromTool(call('execute_shell', { command: 'rm' }), [source], 'workspace', 'run')).toThrow('未授权');
    expect(() => proposalFromTool(call('propose_create', { path: '../escape.md', content: 'x', reason: 'x' }), [source], 'workspace', 'run')).toThrow('路径');
  });
  it('returns tool receipts that explicitly say no write occurred and continues to a final answer', async () => {
    const requests: AssistantRequest[] = [];
    const proposals: unknown[] = [];
    let answer = '';
    const transport = { async request(_id, request, _signal, chunk) {
      requests.push(request);
      chunk(encode(requests.length === 1 ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call('propose_edit', { sourceId: 'S1', oldText: '论证一。', newText: '新论证。', reason: 'test' }) }] } }] }]
        : [{ choices: [{ index: 0, delta: { content: '请审阅修改。' }, finish_reason: 'stop' }] }]));
    } } as AssistantTransport;
    await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [source], history: [], prompt: '修改', signal: new AbortController().signal,
      delta: text => { answer += text; }, proposal: proposal => proposals.push(proposal), progress: () => {} });
    expect(proposals).toHaveLength(1); expect(answer).toContain('请审阅');
    expect(requests.map(request => request.model)).toEqual(['test', 'test']);
    expect(JSON.parse(requests[1].messages.at(-1)!.content!)).toMatchObject({ written: false, status: 'awaiting_review' });
  });
  it('does not execute tools after cancellation or an unfinished response', async () => {
    const abort = new AbortController(); let suggestions = 0;
    const transport = { async request(_id, _request, _signal, chunk) {
      chunk(encode([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call('propose_create', { path: 'new.md', content: 'x', reason: 'test' }) }] } }] }]));
      abort.abort();
    } } as AssistantTransport;
    await expect(runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [source], history: [], prompt: '修改', signal: abort.signal,
      delta: () => {}, proposal: () => { suggestions++; }, progress: () => {} })).rejects.toThrow();
    expect(suggestions).toBe(0);
  });
  it('reads authorized search results once and exposes only actual source identities', async () => {
    const requests: AssistantRequest[] = [];
    const sources: AssistantSource[] = [];
    let reads = 0;
    const names = ['search_documents', 'read_document', 'read_document'];
    const args = [{ query: '论证' }, { fileId: 'abc123' }, { fileId: 'abc123' }];
    const transport = { async request(_id, request, _signal, chunk) {
      const index = requests.length; requests.push(structuredClone(request));
      chunk(encode(index < names.length
        ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call(names[index], args[index]), id: `call-${index}` }] } }] }]
        : [{ choices: [{ index: 0, delta: { content: '来源明确。[来源:S1]' }, finish_reason: 'stop' }] }]));
    } } as AssistantTransport;
    await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources, history: [], prompt: '查询',
      rules: [{ path: '.tano/rules/assistant.md', content: '保留术语' }], signal: new AbortController().signal,
      lookup: { search: async () => [{ fileId: 'abc123', path: 'note.md', excerpt: '论证' }], read: async () => { reads++; return { ...source }; } },
      delta: () => {}, proposal: () => {}, progress: () => {} });
    expect(reads).toBe(1); expect(sources).toHaveLength(1);
    expect(JSON.parse(requests[2].messages.at(-1)!.content!).id).toBe('S1');
    expect(requests[0].messages.some(message => message.role === 'system' && message.content?.includes('不能扩大读取范围'))).toBe(true);
  });
  it('refuses unsolicited read tools when workspace search was not authorized', async () => {
    const requests: AssistantRequest[] = [];
    const transport = { async request(_id, request, _signal, chunk) {
      requests.push(structuredClone(request));
      chunk(encode(requests.length === 1
        ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call('read_document', { fileId: 'abc123' }) }] } }] }]
        : [{ choices: [{ index: 0, delta: { content: '停止读取' }, finish_reason: 'stop' }] }]));
    } } as AssistantTransport;
    await runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [], history: [], prompt: '查询',
      signal: new AbortController().signal, delta: () => {}, proposal: () => {}, progress: () => {} });
    expect(JSON.parse(requests[1].messages.at(-1)!.content!).error).toContain('未允许');
  });
});
