// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { AssistantProposal } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import TaskProposalPreview from './TaskProposalPreview.vue';

let app: ReturnType<typeof createApp>, pinia: ReturnType<typeof createPinia>, root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); useWorkspaceStore(pinia).dispose(); disposePinia(pinia); });
it('shows original and new task dates, opens the original and requires acknowledgement for possible duplicates', async () => {
  localStorage.clear(); pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter(), native: false, mobile: false }); setActivePinia(pinia);
  const store = useWorkspaceStore(); await store.openWorkspace();
  const original = await store.createObject({ type: 'event', name: '核对发布清单', description: '保留引用', archived: false, properties: { checkable: true, due: '2026-10-03', syncRemoteId: 'remote' } });
  const proposal = reactive<AssistantProposal>({ id: 'suggestion', runId: 'run', workspaceId: store.workspace!.id, kind: 'object', path: original.path,
    fileId: 'a00001', base: original.snapshot.content, content: JSON.stringify({ ...original.object, properties: { ...original.object.properties, due: '2026-10-09' } }), reason: '改期', status: 'ready' });
  const opened = vi.fn(), ready = vi.fn(); root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(TaskProposalPreview, { proposal, onOpenReference: opened, onReady: ready })).use(pinia); app.mount(root);
  expect(root.textContent).toContain('2026-10-03'); expect(root.textContent).toContain('2026-10-09');
  root.querySelector<HTMLButtonElement>('button')!.click(); expect(opened.mock.calls[0][0].id).toBe(original.object.id);
  proposal.base = ''; proposal.content = JSON.stringify({ ...original.object, id: 'f00001' });
  proposal.preview = { before: '', after: proposal.content, diskHash: null, path: proposal.path }; await nextTick();
  expect(root.textContent).toContain('可能重复'); expect(ready).toHaveBeenLastCalledWith(false);
  root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await nextTick(); expect(ready).toHaveBeenLastCalledWith(true);
  proposal.preview = { ...proposal.preview, after: proposal.content + '\n' }; await nextTick(); expect(ready).toHaveBeenLastCalledWith(false);
});
