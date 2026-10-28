import type { PluginDocument, PluginJson, TanoPluginApi } from '@tano/workbench/plugin-sdk';
import { chunkSize, createMarkdown, isDrawing, parseScene, replaceScene, sceneInMarkdown, sceneLimit, type Drawing, type Scene } from './model';

export default async function activate(tano: TanoPluginApi) {
  let sequence = 0;
  const token = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let current: PluginDocument | undefined, revision = '', scene = '', error = '';
  let request: { token: string; id?: string; create?: boolean } | null = null;
  let drawings: Drawing[] = [], pending: { revision: string; content: string; length: number; importing?: boolean } | undefined;
  let serial = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    const next = serial.then(action); serial = next.catch(() => {}); return next;
  };
  async function render(offset = 0) {
    await tano.views.renderCustom('board', { drawings, current: current ? { id: current.id, path: current.path } : null,
      revision, hash: current?.hash ?? '', chunk: scene.slice(offset, offset + chunkSize), offset, length: scene.length, error, request } as unknown as PluginJson);
  }
  async function refresh() {
    const result: Drawing[] = [];
    let cursor: string | undefined;
    do {
      const page = await tano.documents.query({ query: '.excalidraw.md', limit: 100, ...(cursor ? { cursor } : {}) });
      result.push(...page.items.filter(file => isDrawing(file.path)).map(file => ({ id: file.id, path: file.path })));
      cursor = page.nextCursor;
    } while (cursor && result.length < 200);
    drawings = result; await render();
  }
  async function open(id: string) {
    const document = await tano.documents.read(id);
    if (!isDrawing(document.path)) throw new Error('请选择 .excalidraw.md 白板文档。');
    const next = JSON.stringify(sceneInMarkdown(document.content).scene);
    current = document; scene = next; revision = token(); error = ''; pending = undefined;
    await tano.storage.set('last-drawing-id', document.id);
    await refresh();
  }
  async function create(imported?: Scene) {
    const path = `Drawing ${new Date().toISOString().replace(/[:.]/g, '-')}-${token().slice(-6)}.excalidraw.md`;
    const document = await tano.documents.create(path, createMarkdown(imported));
    await open(document.id);
  }
  tano.views.onMessage('board', message => enqueue(async () => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('白板请求无效。');
    error = '';
    try {
      if (message.type === 'refresh') await refresh();
      else if (message.type === 'create') { request = null; await create(); }
      else if (message.type === 'open' && typeof message.id === 'string') { request = null; await open(message.id); }
      else if (message.type === 'source' && current) await tano.documents.open(current.id);
      else if (message.type === 'chunk' && message.revision === revision && Number.isSafeInteger(message.offset) && Number(message.offset) >= 0 && Number(message.offset) < scene.length) await render(Number(message.offset));
      else if (message.type === 'begin-import' && typeof message.revision === 'string' && Number.isSafeInteger(message.length) && Number(message.length) > 0 && Number(message.length) <= sceneLimit) {
        pending = { revision: message.revision, content: '', length: Number(message.length), importing: true };
      }
      else if (message.type === 'begin' && current && message.revision === revision && message.baseHash === current.hash && Number.isSafeInteger(message.length) && Number(message.length) > 0 && Number(message.length) <= sceneLimit) {
        pending = { revision, content: '', length: Number(message.length) };
      } else if (message.type === 'append' && pending && message.revision === pending.revision && message.offset === pending.content.length && typeof message.chunk === 'string' && message.chunk.length <= chunkSize && pending.content.length + message.chunk.length <= pending.length) pending.content += message.chunk;
      else if (message.type === 'import' && pending?.importing && message.revision === pending.revision && pending.content.length === pending.length) {
        const imported = parseScene(pending.content); pending = undefined; request = null; await create(imported);
      }
      else if (message.type === 'save' && current && pending && !pending.importing && pending.revision === revision && message.revision === revision && pending.content.length === pending.length) {
        const next = parseScene(pending.content), content = replaceScene(current, next);
        pending = undefined;
        // Use the baseline from open/save, never silently refresh it before a write.
        await tano.documents.write(current.id, content, current.hash);
        const saved = await tano.documents.read(current.id);
        const actual = JSON.stringify(sceneInMarkdown(saved.content).scene);
        if (actual !== JSON.stringify(next)) throw new Error('文档已被外部修改；请导出当前白板，再重新打开工作区版本。');
        current = saved; scene = actual; await render();
      } else throw new Error('白板版本或传输状态已变化，请重新打开后重试。');
    } catch (cause) {
      console.warn('Excalidraw request failed', { type: message.type, received: message.revision, expected: revision, pending: pending?.revision, offset: message.offset });
      pending = undefined; error = cause instanceof Error ? cause.message : String(cause); await render(); throw cause;
    }
  }));
  await tano.commands.register('open', context => enqueue(async () => {
    // A file-menu command can open the exact Markdown drawing by stable ID.
    if (context?.fileId) {
      const document = await tano.documents.read(context.fileId);
      if (isDrawing(document.path)) request = { token: token(), id: document.id };
      await refresh();
    } else await refresh();
    await tano.views.open('board');
  }));
  await tano.commands.register('create', () => enqueue(async () => { request = { token: token(), create: true }; await refresh(); await tano.views.open('board'); }));
  const previous = await tano.storage.get('last-drawing-id');
  if (typeof previous === 'string') {
    try { await open(previous); } catch { await refresh(); }
  } else await refresh();
}
