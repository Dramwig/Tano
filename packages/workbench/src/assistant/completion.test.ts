import { expect, it, vi } from 'vitest';
import type { AssistantRequest, AssistantTransport } from '@tano/protocol';
import { AssistantStream, assistantLimits, runAssistant } from './engine';
import type { AssistantRunEvent } from './engine';
import { AssistantTextDecoder } from './completion';

const sse = (frames: unknown[], done = true) => new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''));
const chat = (content: string, extra: Record<string, unknown> = {}) => ({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop', ...extra }] });
const message = (text: string, phase?: string) => ({ type: 'message', role: 'assistant', phase, status: 'completed', content: [{ type: 'output_text', text }] });
const response = (output: unknown[], end_turn?: boolean) => ({ type: 'response.completed', response: { status: 'completed', output, end_turn } });

function runner(frames: (round: number, request: AssistantRequest) => Uint8Array) {
  const requests: AssistantRequest[] = [], events: AssistantRunEvent[] = [];
  let text = '';
  const transport = { request: vi.fn(async (_id, request, _signal, chunk) => {
    requests.push(structuredClone(request)); chunk(frames(requests.length, request));
  }) } as unknown as AssistantTransport;
  const toolResult = vi.fn(), lookup = { search: vi.fn(async () => []), read: vi.fn() };
  return { requests, events, get text() { return text; }, toolResult, lookup,
    run: () => runAssistant({ transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run',
      sources: [], history: [], prompt: 'Complete the task.', signal: new AbortController().signal, delta: value => { text += value; },
      proposal: () => {}, progress: () => {}, activity: event => events.push(event), lookup, toolResult }),
  };
}

it('continues a progress-only response and finishes directly on the final answer', async () => {
  const task = runner(round => sse([chat(round === 1 ? '[[tano:progress]]\nChecking the context.' : '[[tano:final]]\nThe answer.')]));
  await task.run();
  expect(task.requests).toHaveLength(2);
  expect(task.text).toBe('Checking the context.\n\nThe answer.');
  expect(task.requests[1].messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Checking the context.' });
  expect(task.events.filter(event => event.type === 'response-end')).toMatchObject([
    { continuing: true, segments: [{ phase: 'working' }] }, { continuing: false, segments: [{ phase: 'answer' }] },
  ]);
  expect(task.events.at(-1)).toEqual({ type: 'run-complete' });
});

it('buffers split markers without leaking them or guessing ordinary text', () => {
  for (const phase of ['progress', 'final']) {
    let text = '';
    const stream = new AssistantTextDecoder(value => { text += value; });
    for (const character of `[[tano:${phase}]]\r\n中英文 answer`) stream.push(character);
    stream.finish(); expect(text).toBe('中英文 answer');
    expect(stream.phase).toBe(phase === 'progress' ? 'working' : 'answer');
  }
  const task = runner(() => sse([chat('Let me explain: this is a direct answer.')]));
  return task.run().then(() => expect(task.requests).toHaveLength(1));
});

it.each(['commentary', 'partial_answer'])('continues native %s without tools and preserves Responses items', async phase => {
  const first = message('Continue working.', phase);
  const task = runner(round => sse([response([round === 1 ? first : message('Done.', 'final_answer')])], false));
  await task.run();
  expect(task.requests).toHaveLength(2);
  expect(task.requests[1].messages.at(-1)?.responseItems).toEqual([first]);
});

it('honors end_turn=false even when the model labels its text as a final answer', async () => {
  const task = runner(round => sse([response([message(round === 1 ? 'First part.' : 'Complete answer.', 'final_answer')], round !== 1)], false));
  await task.run();
  expect(task.requests).toHaveLength(2);
  expect(task.events.filter(event => event.type === 'response-end')[0]).toMatchObject({ continuing: true, segments: [{ phase: 'working' }] });
});

it('keeps commentary and final text separate within one Responses response', async () => {
  const task = runner(() => sse([
    { type: 'response.output_item.added', output_index: 0, item: message('', 'commentary') },
    { type: 'response.output_text.delta', output_index: 0, delta: 'Checking.' },
    { type: 'response.output_item.added', output_index: 1, item: message('', 'final_answer') },
    { type: 'response.output_text.delta', output_index: 1, delta: 'Done.' },
    response([message('Checking.', 'commentary'), message('Done.', 'final_answer')], true),
  ], false));
  await task.run();
  expect(task.requests).toHaveLength(1);
  expect(task.events.find(event => event.type === 'response-end')).toMatchObject({ segments: [
    { start: 0, end: 9, phase: 'working' }, { start: 9, end: 14, phase: 'answer' },
  ] });
});

it('prefers native phases over the compatibility marker and accepts late chat phase metadata', async () => {
  const task = runner(round => sse([
    chat(round === 1 ? '[[tano:final]]\nStill working.' : 'Final answer.'),
    { choices: [{ index: 0, delta: { phase: round === 1 ? 'commentary' : 'final_answer' } }] },
  ]));
  await task.run(); expect(task.requests).toHaveLength(2);
});

it('stops repeated progress-only responses without inventing completion', async () => {
  const task = runner(() => sse([chat('[[tano:progress]]\nStill planning.')]));
  await expect(task.run()).rejects.toMatchObject({ reason: 'no_progress' });
  expect(task.requests).toHaveLength(assistantLimits.idleRounds);
  expect(task.events.some(event => event.type === 'run-complete')).toBe(false);
});

it('preserves actual tool receipts at the round limit without an extra summary request', async () => {
  const task = runner(round => sse([{ choices: [{ index: 0, delta: {
    content: '[[tano:final]]\nPremature claim.',
    tool_calls: [{ index: 0, id: `call-${round}`, type: 'function', function: { name: 'search_documents', arguments: '{"query":"test"}' } }],
  }, finish_reason: 'tool_calls' }] }]));
  await expect(task.run()).rejects.toMatchObject({ reason: 'round_limit' });
  expect(task.requests).toHaveLength(assistantLimits.rounds);
  expect(task.lookup.search).toHaveBeenCalledTimes(assistantLimits.rounds);
  expect(task.toolResult.mock.calls.every(([receipt]) => receipt.status === 'succeeded')).toBe(true);
  expect(task.events.filter(event => event.type === 'response-end').every(event => event.segments[0].phase === 'working')).toBe(true);
  expect(task.events.some(event => event.type === 'run-complete')).toBe(false);
});

it('does not finish successfully on an empty response or execute incomplete tools', async () => {
  const empty = runner(() => sse([response([])], false));
  await expect(empty.run()).rejects.toMatchObject({ reason: 'empty_response' });
  const stream = new AssistantStream(() => {});
  stream.push(sse([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'search_documents', arguments: '{}' } }] }, finish_reason: 'length' }] }]));
  expect(() => stream.finish()).toThrow('输出达到上限');
});

it.each(['max_output_tokens', 'other'])('preserves the Responses incomplete reason %s', async reason => {
  const task = runner(() => sse([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason } } }], false));
  await expect(task.run()).rejects.toMatchObject({ reason: reason === 'max_output_tokens' ? 'output_limit' : 'incomplete' });
  expect(task.events.some(event => event.type === 'run-complete')).toBe(false);
});
