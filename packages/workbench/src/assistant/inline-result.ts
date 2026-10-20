import type { AssistantMessage, AssistantProposal } from '@tano/protocol';
import { uiLocale } from '../i18n';
import { assistantCopy } from './language';
import { assistantAnswerText } from './results';

export interface InlineAssistantResult {
  state: 'completed' | 'response' | 'error';
  message: string;
  proposal?: AssistantProposal;
}

/** A successful reply is not necessarily an edit; only storage receipts prove an update. */
export function inlineAssistantResult(reply?: AssistantMessage, error = ''): InlineAssistantResult {
  const copy = assistantCopy(uiLocale.value).result;
  const answer = reply ? assistantAnswerText(reply).trim() : '';
  const proposals = reply?.proposals ?? [];
  const applied = proposals.filter(item => item.execution === 'direct' && item.status === 'applied');
  if (reply?.state === 'cancelled') return { state: 'response', message: applied.length ? copy.stoppedSaved : copy.stoppedUnchanged };
  const blocked = proposals.find(item => item.status === 'conflicted' || item.status === 'unknown' || item.status === 'applying' || item.error);
  const failure = error || reply?.error || blocked?.error ||
    (blocked ? copy.conflict : '') ||
    (!applied.length ? reply?.toolResults?.find(item => item.status === 'failed')?.error : '');
  if (failure || reply?.state === 'failed' || reply?.state === 'interrupted') return {
    state: 'error', message: `${applied.length ? copy.partial : ''}${failure ||
      (reply?.termination ? assistantCopy(uiLocale.value).run.reasons[reply.termination.reason]
        : reply?.state === 'interrupted' ? assistantCopy(uiLocale.value).run.reasons.interrupted : copy.failed)}`,
  };
  if (proposals.some(item => item.status === 'ready')) return { state: 'response', message: copy.review };
  if (applied.length) return { state: 'completed', message: answer || copy.completed, proposal: applied[0] };
  if (answer) return { state: 'response', message: answer };
  return { state: 'response', message: copy.empty };
}
