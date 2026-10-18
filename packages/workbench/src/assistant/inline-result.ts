import type { AssistantMessage, AssistantProposal } from '@tano/protocol';
import { uiLocale } from '../i18n';
import { assistantCopy } from './language';

export interface InlineAssistantResult {
  state: 'completed' | 'response' | 'error';
  message: string;
  proposal?: AssistantProposal;
}

/** A successful reply is not necessarily an edit; only storage receipts prove an update. */
export function inlineAssistantResult(reply?: AssistantMessage, error = ''): InlineAssistantResult {
  const copy = assistantCopy(uiLocale.value).result;
  const proposals = reply?.proposals ?? [];
  const applied = proposals.filter(item => item.execution === 'direct' && item.status === 'applied');
  if (reply?.state === 'cancelled') return { state: 'response', message: applied.length ? copy.stoppedSaved : copy.stoppedUnchanged };
  const blocked = proposals.find(item => item.status === 'conflicted' || item.status === 'unknown' || item.status === 'applying' || item.error);
  const failure = error || reply?.error || blocked?.error ||
    (blocked ? copy.conflict : '') ||
    (!applied.length ? reply?.toolResults?.find(item => item.status === 'failed')?.error : '');
  if (failure || reply?.state === 'failed') return {
    state: 'error', message: `${applied.length ? copy.partial : ''}${failure || copy.failed}`,
  };
  if (proposals.some(item => item.status === 'ready')) return { state: 'response', message: copy.review };
  if (applied.length) return { state: 'completed', message: reply?.content.trim() || copy.completed, proposal: applied[0] };
  if (reply?.content.trim()) return { state: 'response', message: reply.content.trim() };
  return { state: 'response', message: copy.empty };
}
