// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { AssistantProposal } from '@tano/protocol';
import AssistantChangeList from './AssistantChangeList.vue';

let app: ReturnType<typeof createApp>, root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
it('groups file operations within one turn, expands differences lazily, and routes each review separately', async () => {
  const proposals = reactive<AssistantProposal[]>([
    { id: '1', runId: 'run', workspaceId: 'workspace', kind: 'edit', fileId: 'abc123', path: 'note.md', base: 'old', content: 'new', status: 'ready', reason: 'edit' },
    { id: '2', runId: 'run', workspaceId: 'workspace', kind: 'rename', fileId: 'abc123', path: 'note.md', destination: 'renamed.md', base: 'old', content: 'old', status: 'ready', reason: 'rename' },
    { id: '3', runId: 'run', workspaceId: 'workspace', kind: 'delete', fileId: 'abc456', path: 'obsolete.md', base: 'obsolete', content: '', status: 'ready', reason: 'delete', preview: { before: 'obsolete', after: '', path: 'obsolete.md', diskHash: 'hash' } },
    { id: '4', runId: 'run', workspaceId: 'workspace', kind: 'create', path: 'new.md', base: '', content: 'created', status: 'rejected', reason: 'create' },
  ]);
  const review = vi.fn(), reject = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantChangeList, { proposals, busy: false, onReview: review, onReject: reject })); app.mount(root);
  expect(root.querySelectorAll('.assistant-change-list')).toHaveLength(1);
  expect(root.querySelectorAll('.assistant-file-change')).toHaveLength(3);
  expect(root.textContent).toContain('3 个文件 · 4 项操作');
  expect(root.querySelector('.change-diff')).toBeNull();
  root.querySelector<HTMLElement>('summary')!.click();
  await vi.waitFor(() => expect(root.querySelectorAll('.assistant-proposal')).toHaveLength(2));
  expect(root.querySelector('.change-diff')!.textContent).toContain('new');
  expect(root.querySelector('.proposal-path')!.textContent).toContain('note.md → renamed.md');
  const preview = [...root.querySelectorAll('button')].filter(button => button.textContent?.includes('查看差异'));
  preview[1].click(); expect(review).toHaveBeenLastCalledWith(proposals[1]);
  root.querySelectorAll<HTMLElement>('summary')[1].click();
  await vi.waitFor(() => expect(root.querySelectorAll('.assistant-proposal')).toHaveLength(3));
  const deletion = [...root.querySelectorAll('button')].find(button => button.textContent === '删除文件')!;
  deletion.click(); expect(review).toHaveBeenLastCalledWith(proposals[2], true);
  proposals[2].status = 'applied'; await nextTick();
  expect(root.querySelectorAll('summary')[1].querySelector('small')).toBeNull();
  expect([...root.querySelectorAll('button')].some(button => button.textContent === '删除文件')).toBe(false);
  expect([...root.querySelectorAll('button')].some(button => button.textContent === '撤回内容')).toBe(false);
});
