import { Channel, invoke } from '@tauri-apps/api/core';
import { splitFrontmatter } from '@tano/editor/syntax';
import { ASSISTANT_PROTOCOL_VERSION, parseAssistantSession, isDataTableFilePath, parseDataTable } from '@tano/protocol';
import type { AssistantConnection, AssistantRequest, AssistantSession, AssistantSource, AssistantTransport } from '@tano/protocol';
import { assistantCopy, assistantRequestLocale, assistantSourceSeparator, assistantTaskPrompts, formatAssistantText } from './language';

export function nativeAssistantTransport(): AssistantTransport {
  let compatible: Promise<void> | undefined;
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    compatible ??= invoke<number>('assistant_protocol_version').catch(() => {
      throw new Error('桌面助手后端版本过旧或不可用。请保存文档并完全退出同页，再通过 local-desktop.bat 重新启动；仅刷新页面不会更新桌面后端。');
    }).then(version => {
      if (version !== ASSISTANT_PROTOCOL_VERSION)
        throw new Error(`助手前端与桌面后端版本不一致（前端协议 ${ASSISTANT_PROTOCOL_VERSION}，桌面后端协议 ${version}）。请保存文档并完全退出同页，再通过 local-desktop.bat 重新启动。`);
    });
    await compatible;
    return invoke<T>(command, args);
  }
  return {
    connections: () => call('assistant_connections'),
    async models(connectionId, signal) {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const cancel = () => { void call('assistant_cancel', { requestId }).catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const models = await call<string[]>('assistant_models', { connectionId, requestId });
        signal.throwIfAborted();
        return models;
      } finally { signal.removeEventListener('abort', cancel); }
    },
    saveConnection: (connection, key) => call('assistant_connection_save', { connection, key: key || null }),
    removeConnection: id => call('assistant_connection_remove', { id }),
    async request(connectionId, request, signal, chunk) {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      let streamError: unknown;
      let closed = false;
      let delivered!: () => void;
      const delivery = new Promise<void>(resolve => { delivered = resolve; });
      const cancel = () => {
        delivered();
        void call('assistant_cancel', { requestId }).catch(() => {});
      };
      const channel = new Channel<number[]>();
      channel.onmessage = bytes => {
        if (closed || signal.aborted || streamError) return;
        // Successful delivery ends with an ordered empty chunk.
        // The invoke result can arrive before Tauri has delivered channel data.
        if (!bytes.length) { closed = true; delivered(); return; }
        try { chunk(new Uint8Array(bytes)); }
        catch (error) { streamError = error; cancel(); }
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await call('assistant_request', { connectionId, requestId, request, onChunk: channel });
        await delivery;
        if (streamError) throw streamError;
        signal.throwIfAborted();
      } catch (error) { if (streamError) throw streamError; throw error; }
      finally { closed = true; signal.removeEventListener('abort', cancel); }
    },
    async loadSessions(workspaceId) {
      const values = await call<unknown[]>('assistant_sessions_load', { workspaceId });
      return values.map(parseAssistantSession);
    },
    saveSession: session => call('assistant_session_save', { session: JSON.parse(JSON.stringify(session)) }),
    deleteSession: (workspaceId, id, expectedRevision) => call('assistant_session_delete', { workspaceId, id, expectedRevision }),
    async loadExternalSessions(workspaceId) {
      const values = await call<unknown[]>('assistant_external_sessions', { workspaceId });
      return values.map(parseAssistantSession);
    },
    recordExternalResult: session => call('assistant_external_result', { workspaceId: session.workspaceId, id: session.id, expectedRevision: session.revision }),
  };
}

const demoConnection: AssistantConnection = {
  id: '0ba40b16-9c6e-4193-b165-ecda23c407ef', name: '浏览器模拟', endpoint: '', tools: true, maxOutputTokens: 4096, hasKey: false,
};
const demoKey = 'tano.assistant-demo.v1';
export function demoAssistantTransport(): AssistantTransport {
  const read = () => {
    const values: unknown = JSON.parse(localStorage.getItem(demoKey) ?? '[]');
    if (!Array.isArray(values)) throw new Error('助手演示记录损坏，原记录已保留');
    return values.map(parseAssistantSession);
  };
  const locked = async <T>(action: () => T) => {
    if (!navigator.locks) throw new Error('浏览器不支持安全保存助手会话');
    return navigator.locks.request(demoKey, action);
  };
  return {
    demo: true,
    connections: async () => [{ ...demoConnection }],
    models: async (_id, signal) => { signal.throwIfAborted(); return ['模拟响应', '简洁模拟']; },
    saveConnection: async () => { throw new Error('浏览器演示仅提供模拟连接'); },
    removeConnection: async () => { throw new Error('模拟连接无法删除'); },
    loadSessions: async workspaceId => read().filter(session => session.workspaceId === workspaceId),
    saveSession: session => locked(() => {
      const sessions = read();
      const current = sessions.find(item => item.id === session.id && item.workspaceId === session.workspaceId);
      if ((current?.revision ?? 0) !== session.revision) throw new Error('此演示会话已在其他窗口更新');
      const next = parseAssistantSession(JSON.parse(JSON.stringify({ ...session, revision: session.revision + 1 })));
      localStorage.setItem(demoKey, JSON.stringify([...sessions.filter(item => item.id !== session.id), next]));
      return next.revision;
    }),
    deleteSession: (workspaceId, id, expectedRevision) => locked(() => {
      const sessions = read();
      const current = sessions.find(item => item.id === id && item.workspaceId === workspaceId);
      if (current && current.revision !== expectedRevision) throw new Error('此演示会话已在其他窗口更新');
      localStorage.setItem(demoKey, JSON.stringify(sessions.filter(item => item.id !== id || item.workspaceId !== workspaceId)));
    }),
    async request(_connectionId, request: AssistantRequest, signal, chunk) {
      const locale = assistantRequestLocale(request);
      const copy = assistantCopy(locale);
      const demo = copy.demo;
      const last = request.messages.at(-1)!;
      const toolResponse = last.role === 'tool';
      const sourceMessage = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? '';
      const separator = assistantSourceSeparator();
      const sources = JSON.parse(sourceMessage.slice(sourceMessage.indexOf(separator) + separator.length)) as AssistantSource[];
      const source = sources[0];
      const question = sourceMessage.slice(0, sourceMessage.indexOf(separator));
      const direct = request.tools?.some(tool => tool.function.name === 'edit_document') && !/建议|方案|先.*看|不要|暂不|仅分析|suggest|proposal|do not|don't/i.test(question);
      const frames: unknown[] = [];
      const answeredQuestions = toolResponse && request.messages.some(message => message.tool_calls?.some(call => call.id === last.tool_call_id && call.function.name === 'ask_user'));
      if (!toolResponse && [assistantTaskPrompts.startDraft, '开始草稿'].includes(question.trim()) && request.tools?.some(tool => tool.function.name === 'ask_user')) {
        frames.push({ choices: [{ index: 0, delta: { content: demo.clarifying } }] });
        frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'demo_questions', type: 'function', function: {
          name: 'ask_user', arguments: JSON.stringify({ questions: [
            { id: 'topic', question: demo.topic },
            { id: 'audience', question: demo.audience, options: demo.audienceOptions },
            { id: 'goal', question: demo.goal },
            { id: 'format', question: demo.format, options: demo.formatOptions },
            { id: 'context', question: demo.context },
          ] }),
        } }] } }] });
      }
      if (answeredQuestions && source && !splitFrontmatter(source.content).body.trim()) {
        const answers = JSON.parse(last.content ?? '{}').answers as { questionId: string; answer: string | null }[] | undefined;
        const topic = answers?.find(item => item.questionId === 'topic')?.answer;
        if (!topic) frames.push({ choices: [{ index: 0, delta: { content: demo.missingTopic } }] });
        else frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'demo_draft', type: 'function', function: {
          name: direct ? 'edit_document' : 'propose_edit', arguments: JSON.stringify({ sourceId: source.id, oldText: source.content,
            newText: splitFrontmatter(source.content).prefix + formatAssistantText(demo.draft, [topic]), reason: demo.draftReason }),
        } }] } }] });
      }
      if (!frames.length && !toolResponse && request.tools && source && isDataTableFilePath(source.path) && /添加|新增|改|整理|建议|测试|\b(add|edit|change|organize|suggest|test)\b/i.test(question)) {
        const table = parseDataTable(source.content);
        const field = table.fields.find(field => field.type === 'text');
        table.rows.push({ id: `demo_${crypto.randomUUID().slice(0, 8)}`, values: field ? { [field.id]: demo.record } : {} });
        frames.push({ choices: [{ index: 0, delta: { content: demo.tablePreview } }] });
        frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'demo_table_edit', type: 'function', function: {
          name: direct ? 'edit_document' : 'propose_edit', arguments: JSON.stringify({ sourceId: source.id, oldText: source.content,
            newText: JSON.stringify(table, null, 2) + '\n', reason: demo.tableReason }),
        } }] } }] });
      }
      if (!frames.length && !toolResponse && request.tools && source && !isDataTableFilePath(source.path) && /改|整理|润色|建议|测试|\b(edit|rewrite|polish|organize|suggest|test)\b/i.test(question)) {
        const original = source.selection?.from !== undefined ? source.content.slice(source.selection.from, source.selection.to)
          : source.content.split('\n').find(line => line.trim() && !line.startsWith('#') && source.content.indexOf(line) === source.content.lastIndexOf(line));
        if (original) {
          frames.push({ choices: [{ index: 0, delta: { content: demo.editPreview } }] });
          frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'demo_edit', type: 'function', function: {
            name: direct ? 'edit_document' : 'propose_edit', arguments: JSON.stringify({ sourceId: source.id, oldText: original, newText: `${original}\n\n${demo.editAddition}`, reason: demo.editReason }),
          } }] } }] });
        }
      }
      if (!frames.length) {
        const receipt = toolResponse ? JSON.parse(last.content ?? '{}') : undefined;
        const text = toolResponse ? receipt.written === true ? demo.saved
          : receipt.status === 'awaiting_review' ? demo.review
          : receipt.written === null ? demo.unknown : demo.failed : source
          ? `${formatAssistantText(demo.read, [source.path])}\n\n${source.selection?.text ?? source.content.slice(0, request.model === '简洁模拟' ? 100 : 280)}\n\n[来源:${source.id}]`
          : demo.noSources;
        for (const character of text) frames.push({ choices: [{ index: 0, delta: { content: character } }] });
      }
      frames.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      const encoder = new TextEncoder();
      for (const frame of frames) {
        signal.throwIfAborted();
        chunk(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new DOMException('已停止', 'AbortError')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 8);
          signal.addEventListener('abort', aborted, { once: true });
        });
      }
      chunk(encoder.encode('data: [DONE]\n\n'));
    },
  };
}
