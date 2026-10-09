// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { AssistantProposal } from '@tano/protocol';
import { parseAssistantSession } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';

let adapter: DemoAdapter, store: ReturnType<typeof useWorkspaceStore>, pinia: ReturnType<typeof createPinia>;
beforeEach(async () => {
  localStorage.clear();
  adapter = new DemoAdapter({ files: { 'note.md': 'original', 'folder/other.md': 'other' } });
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.openWorkspace();
});
afterEach(() => { store.dispose(); disposePinia(pinia); vi.restoreAllMocks(); });
const scope = () => ({ id: store.workspace!.id, path: store.workspace!.path });
function proposal(kind: 'delete' | 'rename' | 'move', destination?: string): AssistantProposal {
  return { id: crypto.randomUUID(), runId: 'run', workspaceId: store.workspace!.id, kind, destination,
    path: 'note.md', fileId: store.workspace!.files.find(file => file.path === 'note.md')!.id,
    base: 'original', content: kind === 'delete' ? '' : 'original', reason: 'test', status: 'ready' };
}

it.each([['rename', 'renamed.md'], ['move', 'folder/note.md']] as const)('applies %s once, keeping the identity and the open document', async (kind, destination) => {
  const suggested = proposal(kind, destination);
  await store.openFileInNewTab(store.workspace!.files.find(file => file.id === suggested.fileId)!);
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  expect(preview).toMatchObject({ path: 'note.md', destination, before: 'original', after: 'original' });
  expect((await adapter.refresh()).files.some(file => file.path === 'note.md')).toBe(true);
  const changed = vi.spyOn(adapter, 'changeFile');
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('saved');
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('saved');
  expect(changed).toHaveBeenCalledTimes(1);
  expect(store.workspace!.files.find(file => file.id === suggested.fileId)?.path).toBe(destination);
  expect(store.active?.path).toBe(destination);
  expect((await adapter.read(destination)).content).toBe('original');
});

it('requires another review after an external edit before deleting and closes the document only on success', async () => {
  const suggested = proposal('delete');
  await store.openFileInNewTab(store.workspace!.files.find(file => file.id === suggested.fileId)!);
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  await adapter.write('note.md', 'external', (await adapter.read('note.md')).hash);
  const stale = await store.reviewAssistantProposal(scope(), suggested, preview);
  expect(stale.status).toBe('stale'); expect(stale.preview?.before).toBe('external');
  expect((await adapter.read('note.md')).content).toBe('external');
  expect((await store.reviewAssistantProposal(scope(), suggested, stale.preview)).status).toBe('saved');
  expect(store.workspace!.files.some(file => file.id === suggested.fileId)).toBe(false);
  expect(store.documents.some(doc => doc.id === suggested.fileId)).toBe(false);
});

it('protects drafts, occupied paths, missing folders, and destination changes after preview', async () => {
  const suggested = proposal('move', 'folder/note.md');
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  suggested.destination = 'folder/next.md';
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('stale');
  suggested.destination = 'folder/other.md';
  await expect(store.reviewAssistantProposal(scope(), suggested)).rejects.toThrow('已经存在');
  suggested.destination = 'missing/note.md';
  await expect(store.reviewAssistantProposal(scope(), suggested)).rejects.toThrow('文件夹不存在');
  await store.openFileInNewTab(store.workspace!.files.find(file => file.id === suggested.fileId)!);
  store.editDocument(suggested.fileId!, 'unsaved');
  await expect(store.reviewAssistantProposal(scope(), proposal('delete'))).rejects.toThrow('请先保存');
  expect(store.active!.content).toBe('unsaved');
});

it('checks identity and hash at the adapter boundary, including a race after review', async () => {
  const suggested = proposal('delete');
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  await expect(adapter.changeFile({ workspaceId: scope().id, fileId: 'ffffff', path: 'note.md', expectedHash: preview.diskHash! })).rejects.toThrow('身份');
  const original = adapter.changeFile.bind(adapter);
  vi.spyOn(adapter, 'changeFile').mockImplementationOnce(async request => {
    await adapter.write('note.md', 'late edit', (await adapter.read('note.md')).hash);
    return original(request);
  });
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('stale');
  expect((await adapter.read('note.md')).content).toBe('late edit');
});

it('retains new operation types across session reloads and rejects malformed destinations', () => {
  const proposals = [proposal('delete'), proposal('rename', 'renamed.md'), proposal('move', 'folder/note.md')];
  const session = { version: 1, id: crypto.randomUUID(), workspaceId: scope().id, title: 'files', createdAt: 1, updatedAt: 1, revision: 0,
    messages: [{ id: 'run', role: 'assistant', content: '', createdAt: 1, proposals }] };
  expect(parseAssistantSession(session).messages[0].proposals).toEqual(proposals);
  proposals[1].destination = undefined;
  expect(() => parseAssistantSession(session)).toThrow('修改记录');
});

it('preserves input arriving during deletion as a missing draft', async () => {
  const suggested = proposal('delete');
  await store.openFileInNewTab(store.workspace!.files.find(file => file.id === suggested.fileId)!);
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  const original = adapter.changeFile.bind(adapter);
  vi.spyOn(adapter, 'changeFile').mockImplementationOnce(async request => {
    const result = await original(request);
    store.editDocument(suggested.fileId!, 'late input');
    return result;
  });
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('saved');
  expect(store.documents.find(doc => doc.id === suggested.fileId)).toMatchObject({ missing: true, content: 'late input' });
});

it('retains the applied receipt if directory refresh fails after the mutation', async () => {
  const suggested = proposal('rename', 'renamed.md');
  const preview = (await store.reviewAssistantProposal(scope(), suggested)).preview!;
  const original = adapter.changeFile.bind(adapter);
  const changed = vi.spyOn(adapter, 'changeFile').mockImplementationOnce(async request => {
    const result = await original(request);
    vi.spyOn(adapter, 'refresh').mockRejectedValueOnce(new Error('refresh failed'));
    return result;
  });
  await expect(store.reviewAssistantProposal(scope(), suggested, preview)).rejects.toThrow('refresh failed');
  expect(suggested.status).toBe('applied'); expect(suggested.applied?.fileId).toBe(suggested.fileId);
  expect((await store.reviewAssistantProposal(scope(), suggested, preview)).status).toBe('saved');
  expect(changed).toHaveBeenCalledTimes(1);
});
