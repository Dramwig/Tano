// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { loadFileMetadata, saveFileMetadata, markdownFileMetadata } from './file-metadata';
import { fileMetadataPath } from '@tano/protocol';
beforeEach(() => localStorage.clear());
it('projects typed document properties and aliases without inventing defaults', () => {
  expect(markdownFileMetadata('abc123', '# Plain')).toEqual({ version: 1, fileId: 'abc123', tags: [], properties: {} });
  const metadata = markdownFileMetadata('abc123', '---\nowner: Sam\n负责人: Li\n状态: Done\nenabled: false\ncount: 0\nempty: null\ntags: [one, two, one]\n---\n# Content');
  expect(metadata.properties).toMatchObject({ owner: 'Sam', status: 'Done', enabled: false, count: 0, empty: null });
  expect(metadata.tags).toEqual(['one', 'two']);
});
async function setup() {
  const adapter = new DemoAdapter({ files: { 'paper.pdf': '%PDF-1.7' }, storageKey: 'file-core' });
  const workspace = await adapter.refresh();
  const id = workspace.files.find(file => file.path === 'paper.pdf')!.id;
  const state = await loadFileMetadata(adapter, workspace, id);
  return { adapter, id, state };
}
it('keeps metadata attached across folder moves and adapter restart', async () => {
  const { adapter, id, state } = await setup();
  state.file.tags = ['paper']; state.file.properties = { owner: 'Li' };
  await saveFileMetadata(adapter, state);
  await adapter.createFolder('archive'); await adapter.move('paper.pdf', 'archive/renamed.pdf', 'file');
  const restarted = new DemoAdapter({ storageKey: 'file-core' });
  const workspace = await restarted.refresh();
  expect(workspace.files.find(file => file.id === id)?.path).toBe('archive/renamed.pdf');
  expect((await loadFileMetadata(restarted, workspace, id)).file).toEqual(state.file);
});
it('merges independent concurrent metadata edits and preserves both overlapping versions', async () => {
  const { adapter, id, state } = await setup();
  state.file.properties = { owner: 'Li', status: 'new' };
  const base = await saveFileMetadata(adapter, state);
  const other = new DemoAdapter({ storageKey: 'file-core' });
  await saveFileMetadata(other, { ...base, file: { ...base.file, properties: { ...base.file.properties, status: 'read' }, tags: ['remote'] } });
  const merged = await saveFileMetadata(adapter, { ...base, file: { ...base.file, properties: { ...base.file.properties, owner: 'Wu' }, tags: ['local'] } });
  expect(merged.file.properties).toEqual({ owner: 'Wu', status: 'read' });
  expect(merged.file.tags.sort()).toEqual(['local', 'remote']);
  await expect(saveFileMetadata(other, { ...base, file: { ...base.file, properties: { owner: 'Zhao' } } })).rejects.toThrow('冲突');
  expect(JSON.parse((await adapter.read(fileMetadataPath(id))).content).properties.owner).toBe('Wu');
  const conflict = (await other.refresh()).files.find(file => file.path.startsWith('.tano/conflicts/'))!;
  expect(JSON.parse((await other.read(conflict.path)).content).properties.owner).toBe('Zhao');
});
it('does not overwrite another browser instance before its storage event arrives', async () => {
  const { adapter } = await setup();
  const base = await adapter.read('paper.pdf');
  const other = new DemoAdapter({ storageKey: 'file-core' });
  await other.write('paper.pdf', 'external bytes', base.hash);
  expect((await adapter.write('paper.pdf', 'stale bytes', base.hash)).status).toBe('conflict');
  await adapter.create('other.txt', 'new');
  expect((await other.read('paper.pdf')).content).toBe('external bytes');
});
