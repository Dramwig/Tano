import type { useAssistantStore } from './store';
import type { useWorkspaceStore } from '../stores/workspace';

export const ASSISTANT_TAB_ID = 'view:assistant';

/** Both document and navigation entrances reuse the same workspace session. */
export function openAssistantPage(workspace: ReturnType<typeof useWorkspaceStore>, assistant: ReturnType<typeof useAssistantStore>, id?: string, create = false) {
  if (!workspace.workspace || !assistant.available || assistant.loading) return;
  if ((create || (id && id !== assistant.session?.id)) && (assistant.busy || assistant.applying)) return;
  if (create) {
    assistant.newSession();
    assistant.files = [];
    assistant.selection = null;
  } else if (id && id !== assistant.session?.id) assistant.selectSession(id);
  workspace.openViewTab(ASSISTANT_TAB_ID);
  assistant.setDisplayMode('fullscreen');
  assistant.open();
}
