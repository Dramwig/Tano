// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';
import { useAssistantStore } from '../assistant/store';
import AssistantPanel from './AssistantPanel.vue';
let app: ReturnType<typeof createApp> | undefined;
let pinia: ReturnType<typeof createPinia>;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); useWorkspaceStore(pinia).dispose(); disposePinia(pinia); });
it('opens task evidence from an assistant report and disables references in a different workspace', async () => {
  localStorage.clear();
  pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia); const workspace = useWorkspaceStore(); await workspace.openWorkspace();
  const task = await workspace.createObject({ type: 'event', name: '验收', description: '', archived: false, properties: { checkable: true, completed: true } });
  const assistant = useAssistantStore();
  await vi.waitFor(() => expect(assistant.loading).toBe(false));
  assistant.session = { version: 1, id: crypto.randomUUID(), workspaceId: workspace.workspace!.id, title: '周报', createdAt: 1, updatedAt: 1, revision: 0,
    messages: [{ id: 'answer', role: 'assistant', content: `本周完成 [@验收](object://event/${task.object.id})。`, createdAt: 1, state: 'completed' }] };
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  const opened = vi.fn(); root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantPanel, { onOpenReference: opened })).use(pinia); app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.tano-reference button')).not.toBeNull());
  root.querySelector<HTMLButtonElement>('.tano-reference button')!.click();
  expect(opened).toHaveBeenCalledWith({ type: 'event', id: task.object.id });
  expect(root.querySelector('.tano-reference')!.textContent).toContain('已完成');
  assistant.session.workspaceId = 'another-workspace'; await nextTick();
  expect(root.querySelector<HTMLButtonElement>('.tano-reference button')!.disabled).toBe(true);
});
