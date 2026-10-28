import { expect, it, vi } from 'vitest';
import activate from '../examples/plugins/excalidraw/main';
import { chunkSize, createMarkdown, emptyScene, sceneInMarkdown, type BoardState } from '../examples/plugins/excalidraw/model';
import type { PluginDocument, PluginJson, TanoPluginApi } from '@tano/workbench/plugin-sdk';

async function fixture() {
  const documents = new Map<string, PluginDocument>();
  const commands = new Map<string, (context?: { workspaceId: string; fileId?: string }) => Promise<void>>();
  let receive!: (message: PluginJson) => Promise<void>, state!: BoardState, sequence = 0;
  const api = {
    views: { renderCustom: vi.fn(async (_id: string, value: BoardState) => { state = structuredClone(value); }), open: vi.fn(), onMessage: vi.fn((_id: string, handler: typeof receive) => { receive = handler; }) },
    commands: { register: vi.fn(async (id: string, handler: (context?: { workspaceId: string; fileId?: string }) => Promise<void>) => { commands.set(id, handler); }) },
    storage: { get: vi.fn(), set: vi.fn() },
    documents: {
      query: vi.fn(async () => ({ items: [...documents.values()].map(({ id, path }) => ({ id, path })) })),
      read: vi.fn(async (id: string) => { if (!documents.has(id)) throw new Error('missing'); return structuredClone(documents.get(id)); }),
      create: vi.fn(async (path: string, content: string) => { const id = `file${++sequence}`; documents.set(id, { id, path, content, hash: `hash${sequence}` }); return { id, path }; }),
      write: vi.fn(async (id: string, content: string, hash: string) => {
        const document = documents.get(id)!;
        if (document.hash !== hash) throw new Error('文档有重叠修改，插件版本已保存在 conflict.md');
        documents.set(id, { ...document, content, hash: `hash${++sequence}` });
      }),
    },
  };
  await activate(api as unknown as TanoPluginApi);
  const create = async () => { await receive({ type: 'create' }); return state.current!; };
  async function transfer(content: string, revision = state.revision) {
    await receive({ type: 'begin', revision, baseHash: state.hash ?? '', length: content.length });
    for (let offset = 0; offset < content.length; offset += chunkSize) await receive({ type: 'append', revision, offset, chunk: content.slice(offset, offset + chunkSize) });
    return receive({ type: 'save', revision });
  }
  return { api, documents, commands, receive, state: () => state, create, transfer };
}

it('creates a Markdown drawing without requiring a pre-existing folder, then saves chunked official scene data', async () => {
  const f = await fixture(), drawing = await f.create();
  expect(drawing.path).toMatch(/^Drawing .*\.excalidraw\.md$/);
  const scene = { ...emptyScene(), elements: [{ id: 'text', type: 'text', text: '同页'.repeat(2000) }] };
  await f.transfer(JSON.stringify(scene));
  expect(sceneInMarkdown(f.documents.get(drawing.id)!.content).scene).toEqual(scene);
  expect(f.api.storage.set).toHaveBeenCalledWith('last-drawing-id', drawing.id);
});

it('keeps the opened baseline when another editor changes the file, leaving the local scene exportable', async () => {
  const f = await fixture(), drawing = await f.create(), document = f.documents.get(drawing.id)!;
  f.documents.set(drawing.id, { ...document, content: createMarkdown({ ...emptyScene(), elements: [{ id: 'remote' }] }), hash: 'external' });
  const reads = f.api.documents.read.mock.calls.length;
  await expect(f.transfer(JSON.stringify({ ...emptyScene(), elements: [{ id: 'local' }] }))).rejects.toThrow('重叠修改');
  expect(f.api.documents.write).toHaveBeenCalledWith(drawing.id, expect.any(String), document.hash);
  expect(f.api.documents.read.mock.calls).toHaveLength(reads);
  expect(sceneInMarkdown(f.documents.get(drawing.id)!.content).scene.elements).toEqual([{ id: 'remote' }]);
  expect(f.state().error).toContain('conflict.md');
});

it('rejects stale scenes and incomplete transfers without writing either file', async () => {
  const f = await fixture(); await f.create(); const revision = f.state().revision;
  await f.create();
  await expect(f.transfer(JSON.stringify(emptyScene()), revision)).rejects.toThrow('版本');
  await f.receive({ type: 'begin', revision: f.state().revision, baseHash: f.state().hash ?? '', length: 100 });
  await expect(f.receive({ type: 'save', revision: f.state().revision })).rejects.toThrow('版本');
  expect(f.api.documents.write).not.toHaveBeenCalled();
});

it('routes file and create commands through the UI so current edits can be flushed before switching', async () => {
  const f = await fixture(), drawing = await f.create();
  await f.commands.get('open')!({ workspaceId: 'workspace', fileId: drawing.id });
  expect(f.state().request).toMatchObject({ id: drawing.id });
  const count = f.documents.size;
  await f.commands.get('create')!();
  expect(f.state().request).toMatchObject({ create: true });
  expect(f.documents.size).toBe(count);
});

it('rejects an older canvas baseline after another view saves, instead of overwriting its scene', async () => {
  const f = await fixture(); await f.create(); const old = f.state().hash!;
  const first = { ...emptyScene(), elements: [{ id: 'first-view' }] };
  await f.transfer(JSON.stringify(first));
  const writes = f.api.documents.write.mock.calls.length;
  await expect(f.receive({ type: 'begin', revision: f.state().revision, baseHash: old, length: 100 })).rejects.toThrow('版本');
  expect(f.api.documents.write.mock.calls).toHaveLength(writes);
  expect(sceneInMarkdown(f.documents.get(f.state().current!.id)!.content).scene).toEqual(first);
});

it('imports a standard Excalidraw file directly into a new Markdown document', async () => {
  const f = await fixture(), scene = { ...emptyScene(), elements: [{ id: 'imported-rectangle', type: 'rectangle' }] };
  const content = JSON.stringify(scene), revision = 'import-transfer';
  await f.receive({ type: 'begin-import', revision, length: content.length });
  await f.receive({ type: 'append', revision, offset: 0, chunk: content });
  await f.receive({ type: 'import', revision });
  expect(sceneInMarkdown(f.documents.get(f.state().current!.id)!.content).scene).toEqual(scene);
});
