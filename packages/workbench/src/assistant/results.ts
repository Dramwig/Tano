import type { AssistantActivity, AssistantMessage, AssistantToolResult, AssistantUserInput, AssistantWireMessage } from '@tano/protocol';
import { uiLocale } from '../i18n';
import { assistantCopy } from './language';

export function assistantMessageParts(message: AssistantMessage) {
  const parts: ({ kind: 'text'; content: string } | { kind: 'input'; input: AssistantUserInput })[] = [];
  let offset = 0;
  for (const input of message.userInputs ?? []) {
    if (input.contentOffset > offset) parts.push({ kind: 'text', content: message.content.slice(offset, input.contentOffset) });
    parts.push({ kind: 'input', input });
    offset = input.contentOffset;
  }
  if (offset < message.content.length) parts.push({ kind: 'text', content: message.content.slice(offset) });
  return parts;
}

export type AssistantDisplayPart =
  | { kind: 'text'; content: string; key: string }
  | { kind: 'input'; input: AssistantUserInput; key: string }
  | { kind: 'tool'; tool: Extract<AssistantActivity, { kind: 'tool' }>; result?: AssistantToolResult; key: string };

export function assistantDisplayParts(message: AssistantMessage) {
  const process: AssistantDisplayPart[] = [], answer: AssistantDisplayPart[] = [];
  const unfinished = !!message.state && ['failed', 'cancelled', 'interrupted'].includes(message.state);
  if (!message.activity) {
    (unfinished ? process : answer).push(...assistantMessageParts(message).map((part, index) => ({ ...part, key: `legacy-${index}` })));
    return { process, answer };
  }
  for (const [index, item] of message.activity.entries()) {
    const key = `activity-${index}`;
    if (item.kind === 'text') {
      const content = message.content.slice(item.start, item.end);
      const live = message.state === 'running' || message.state === 'waiting';
      if (content.trim()) (unfinished || item.phase === 'working' || (item.phase === 'pending' && !live) ? process : answer).push({ kind: 'text', content, key });
    } else if (item.kind === 'tool') {
      process.push({ kind: 'tool', tool: item, key, result: message.toolResults?.[item.resultIndex!] });
    } else {
      const input = message.userInputs?.find(input => input.id === item.inputId);
      if (input) process.push({ kind: 'input', input, key });
    }
  }
  return { process, answer };
}

/** Copy/export only the final (or currently streaming) answer, never the work log. */
export function assistantAnswerText(message: AssistantMessage): string {
  if (message.state && !['running', 'waiting', 'completed'].includes(message.state)) return '';
  if (!message.activity) return message.content;
  return message.activity.filter(item => item.kind === 'text' && item.phase === 'answer')
    .map(item => item.kind === 'text' ? message.content.slice(item.start, item.end) : '').join('\n\n');
}

/** Keep the model's prose separate from the application's current review state. */
export function assistantHistory(messages: readonly AssistantMessage[]): AssistantWireMessage[] {
  return messages.slice(-16).flatMap<AssistantWireMessage>(message => {
    if (message.role === 'user') return [{ role: 'user', content: message.content }];
    const history: AssistantWireMessage[] = [];
    for (const part of assistantMessageParts(message)) {
      if (part.kind === 'text') history.push({ role: 'assistant', content: part.content });
      else if (part.input.status === 'answered') history.push({ role: 'user', content: JSON.stringify({
        questions: part.input.questions, answers: part.input.answers,
      }) });
    }
    // Include actual operation receipts even when a message only asked questions.
    const last = history.at(-1);
    const answer = last?.role === 'assistant' ? history.pop()!.content : '';
    history.push({ role: 'assistant', content: JSON.stringify({ answer, execution: {
      state: message.state ?? 'unknown',
      ...(message.termination ? { termination: message.termination.reason } : {}),
      ...(message.error ? { error: message.error.slice(0, 2000) } : {}),
      // Null distinguishes old conversations without receipts from a verified empty list.
      tools: message.toolResults ?? null,
      proposals: (message.proposals ?? []).map(proposal => ({
        id: proposal.id, kind: proposal.kind, path: proposal.path, status: proposal.status,
        ...(proposal.execution ? { execution: proposal.execution } : {}),
        ...(proposal.destination ? { destination: proposal.destination } : {}),
        review: proposal.suggestionGroupId ? 'document' : 'conversation',
        written: proposal.suggestionGroupId || ['applying', 'unknown'].includes(proposal.status)
          ? null : proposal.status === 'applied',
      })),
    } }) });
    return history;
  });
}

export function assistantToolLabel(name: string) {
  const copy = assistantCopy(uiLocale.value);
  const toolLabels: Record<string, string> = copy.tools;
  return Object.prototype.hasOwnProperty.call(toolLabels, name) ? toolLabels[name] : copy.result.toolCall;
}
