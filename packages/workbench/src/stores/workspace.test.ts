import { configureWorkbench } from '../runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw } from 'vue';
import type {
  WorkspaceAdapter,
  FileSnapshot,
  Workspace,
  WriteResult,
  WorkspaceSession,
} from '@tano/protocol';

const fixture = vi.hoisted(() => ({ adapter: null as WorkspaceAdapter | null }));
import { useWorkspaceStore } from './workspace';
import { GRAPH_TAB_ID } from '../document-graph';
import { PLUGINS_TAB_ID } from '../workspace-plugins';
import { CALENDAR_TAB_ID } from '../calendar';

const extensionView = { id: 'view:sample', label: '扩展', icon: markRaw({ render: () => null }) };

class MemoryWorkspace implements WorkspaceAdapter {
  readonly mode = 'demo' as const;
  files = new Map([['note.md', { id: 'note-id', content: 'A\nB\nC\n' }]]);
  folders = new Set<string>();
  failWrites = false;
  failCopies = false;
  beforeWrite?: () => Promise<void>;
  session: WorkspaceSession | null = null;
  failJournal = false;
  corruptJournal = false;
  watchCallback?: () => void;
  async loadSession() {
    if (this.corruptJournal) throw new Error('corrupt journal retained');
    return structuredClone(this.session);
  }
  async saveSession(_id: string, session: WorkspaceSession) {
    if (this.failJournal) throw new Error('journal disk full');
    this.session = structuredClone(session);
  }
  async open() {
    return this.refresh();
  }
  async close(_workspaceId: string) {}
  async refresh(): Promise<Workspace> {
    return {
      id: 'test',
      name: 'test',
      path: 'test',
      files: [
        ...[...this.files].map(([path, f]) => ({
          id: f.id,
          path,
          name: path,
          kind: 'file' as const,
          size: f.content.length,
          modified: 0,
        })),
        ...[...this.folders].map((path) => ({
          id: `folder:${path}`,
          path,
          name: path,
          kind: 'directory' as const,
          size: 0,
          modified: 0,
        })),
      ],
    };
  }
  async read(path: string): Promise<FileSnapshot> {
    const file = this.files.get(path);
    if (!file) throw new Error('missing');
    return { content: file.content, hash: file.content, modified: 0 };
  }
  async write(path: string, content: string, expectedHash: string): Promise<WriteResult> {
    await this.beforeWrite?.();
    if (this.failWrites) throw new Error('disk full');
    if (!this.files.has(path)) return { status: 'missing' };
    const snapshot = await this.read(path);
    if (snapshot.hash !== expectedHash) return { status: 'conflict', snapshot };
    this.files.get(path)!.content = content;
    return { status: 'saved', snapshot: await this.read(path) };
  }
  async create(path: string, content: string) {
    if (this.failCopies) throw new Error('cannot create conflict copy');
    if (this.files.has(path)) throw new Error('exists');
    this.files.set(path, { id: crypto.randomUUID(), content });
  }
  async createFolder(path: string) {
    this.folders.add(path);
  }
  async rename(from: string, to: string) {
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
  }
  async move(from: string, to: string, kind: 'file' | 'directory') {
    const directory = kind === 'directory';
    const moved = (path: string) => path === from || (directory && path.startsWith(`${from}/`));
    this.files = new Map(
      [...this.files].map(([path, file]) => [
        moved(path) ? `${to}${path.slice(from.length)}` : path,
        file,
      ]),
    );
    this.folders = new Set(
      [...this.folders].map((path) => (moved(path) ? `${to}${path.slice(from.length)}` : path)),
    );
  }
  async duplicate(_workspaceId: string, path: string) {
    const source = this.files.get(path);
    if (!source) throw new Error('missing');
    const destination = path.replace(/\.md$/, ' 副本.md');
    this.files.set(destination, { id: crypto.randomUUID(), content: source.content });
    return destination;
  }
  async remove(path: string) {
    const directory = this.folders.has(path);
    const removing = (entry: string) => entry === path || (directory && entry.startsWith(`${path}/`));
    for (const entry of this.files.keys()) if (removing(entry)) this.files.delete(entry);
    for (const entry of this.folders) if (removing(entry)) this.folders.delete(entry);
  }
  async reveal() {}
  async watch(callback: () => void) {
    this.watchCallback = callback;
    return () => { this.watchCallback = undefined; };
  }
}

let backend: MemoryWorkspace;
let store: ReturnType<typeof useWorkspaceStore>;
beforeEach(async () => {
  backend = new MemoryWorkspace();
  fixture.adapter = backend;
  setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
  store = useWorkspaceStore();
  await store.initialize();
});
afterEach(() => store.dispose());

describe('assistant proposal coordination', () => {
  const scope = { id: 'test', path: 'test' };
  async function proposal(content = 'A\nB\nAI\n') {
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'note-id')!);
    return { id: crypto.randomUUID(), runId: 'run', workspaceId: 'test', kind: 'edit' as const,
      fileId: 'note-id', path: 'note.md', base: 'A\nB\nC\n', content, reason: 'test', status: 'ready' as const };
  }
  it('reviews workspace events and applies them only after acceptance and capability checks', async () => {
    store.capabilities.features.objectReferences = true;
    const object = { version: 1, id: 'e00001', type: 'event', name: '审阅', description: '', archived: false, properties: { checkable: true, completed: false } };
    const suggested = { id: crypto.randomUUID(), runId: 'run', workspaceId: 'test', kind: 'object' as const,
      path: '.tano/objects/e00001.tano.json', base: '', content: JSON.stringify(object, null, 2) + '\n', reason: '后续任务', status: 'ready' as const };
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    expect(backend.files.has(suggested.path)).toBe(false);
    expect((await store.reviewAssistantProposal(scope, suggested, reviewed.preview)).status).toBe('saved');
    expect(store.objects.some(record => record.object.id === 'e00001')).toBe(true);
    expect((await store.reviewAssistantProposal(scope, suggested, reviewed.preview)).status).toBe('saved');
    store.capabilities.features.objectReferences = false;
    await expect(store.reviewAssistantProposal(scope, { ...suggested, id: crypto.randomUUID() })).rejects.toThrow('未启用');
  });
  it('rejects stale scopes after reopening the same workspace and reads only supported rules', async () => {
    const oldScope = { ...scope, epoch: store.assistantEpoch };
    backend.files.set('.tano/rules/assistant.md', { id: 'rule-id', content: '保留引用' });
    expect(await store.assistantRules(oldScope)).toEqual([{ path: '.tano/rules/assistant.md', content: '保留引用' }]);
    await expect(store.assistantSnapshot(oldScope, 'rule-id')).rejects.toThrow('移除');
    await store.openWorkspace('test');
    await expect(store.assistantRules(oldScope)).rejects.toThrow('打开会话已变化');
  });
  it('preserves concurrent relations and requires reviewing the combined file before acceptance', async () => {
    store.capabilities.features.objectReferences = true;
    for (const id of ['a00001', 'b00001', 'c00001']) backend.files.set(`${id}.md`, { id, content: id });
    const row = { id: 'e00001', type: 'related', source: { type: 'document', id: 'a00001' }, target: { type: 'document', id: 'b00001' } };
    const suggested = { id: crypto.randomUUID(), runId: 'run', workspaceId: 'test', kind: 'relation' as const,
      path: '.tano/relations.tano-relations.json', base: '', content: JSON.stringify({ version: 1, relations: [row] }), reason: '关联', status: 'ready' as const };
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    const independent = { ...row, id: 'e00002', target: { type: 'document', id: 'c00001' } };
    backend.files.set(suggested.path, { id: 'relation-file', content: JSON.stringify({ version: 1, relations: [independent] }) });
    const stale = await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    expect(stale.status).toBe('stale');
    expect(JSON.parse(stale.preview!.after).relations).toEqual([independent, row]);
    const applied = await store.reviewAssistantProposal(scope, suggested, stale.preview);
    expect(applied.status).toBe('saved');
    expect(JSON.parse(backend.files.get(suggested.path)!.content).relations).toEqual([independent, row]);
  });
  it('refreshes the diff after a conditional write detects an external change', async () => {
    const suggested = await proposal();
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    backend.beforeWrite = async () => { backend.files.get('note.md')!.content = 'External\nB\nC\n'; };
    const stale = await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    expect(stale.status).toBe('stale');
    expect(stale.preview!.before).toBe('External\nB\nC\n');
    expect(stale.preview!.after).toBe('External\nB\nAI\n');
    expect(backend.files.get('note.md')!.content).toBe('External\nB\nC\n');
  });
  it('captures unsaved input and merges independent human, disk, and model edits', async () => {
    const suggested = await proposal();
    store.editDocument('note-id', 'Human\nB\nC\n');
    expect((await store.assistantSnapshot(scope, 'note-id')).content).toBe('Human\nB\nC\n');
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    expect(reviewed.status).toBe('preview');
    expect(reviewed.preview!.after).toBe('Human\nB\nAI\n');
    const saved = await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    if (saved.status !== 'saved') throw new Error('expected assistant write receipt');
    expect(saved.status).toBe('saved');
    expect(backend.files.get('note.md')!.content).toBe('Human\nB\nAI\n');
    expect(store.active!.content).toBe('Human\nB\nAI\n');
  });
  it('requires review again when a human types after the preview and preserves overlapping versions', async () => {
    const suggested = await proposal();
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    store.editDocument('note-id', 'Human\nB\nC\n');
    const stale = await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    expect(stale.status).toBe('stale');
    expect(backend.files.get('note.md')!.content).toBe('A\nB\nC\n');
    store.editDocument('note-id', 'A\nB\nHuman\n');
    const conflict = await store.reviewAssistantProposal(scope, suggested);
    expect(conflict.status).toBe('conflict');
    expect(store.active!.content).toBe('A\nB\nHuman\n');
    expect(suggested.content).toBe('A\nB\nAI\n');
  });
  it('keeps input entered while the write acknowledgement is pending', async () => {
    const suggested = await proposal();
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    backend.beforeWrite = async () => { store.editDocument('note-id', 'Human\nB\nC\n'); };
    expect((await store.reviewAssistantProposal(scope, suggested, reviewed.preview)).status).toBe('saved');
    expect(store.active!.content).toBe('Human\nB\nAI\n');
    expect(backend.files.get('note.md')!.content).toBe('A\nB\nAI\n');
    backend.beforeWrite = undefined;
    await store.flush();
    expect(backend.files.get('note.md')!.content).toBe('Human\nB\nAI\n');
  });
  it('preserves both versions when typing during publication overlaps the AI change', async () => {
    const suggested = await proposal();
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    backend.beforeWrite = async () => { store.editDocument('note-id', 'A\nB\nHuman\n'); };
    await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    expect(backend.files.get('note.md')!.content).toBe('A\nB\nAI\n');
    expect(store.active!.conflict).toBeTruthy();
    expect(backend.files.get(store.active!.conflict!.copyPath)!.content).toBe('A\nB\nHuman\n');
  });
  it('follows stable identity on rename and refuses same-path replacement', async () => {
    const suggested = await proposal();
    await backend.rename('note.md', 'moved.md');
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    expect(reviewed.preview!.path).toBe('moved.md');
    backend.files.delete('moved.md');
    backend.files.set('note.md', { id: 'other-id', content: 'A\nB\nC\n' });
    await expect(store.reviewAssistantProposal(scope, suggested, reviewed.preview)).rejects.toThrow('身份变化');
    expect(backend.files.get('note.md')!.content).toBe('A\nB\nC\n');
  });
  it('does not repeat an applied operation or overwrite new edits during undo', async () => {
    const suggested = await proposal();
    const reviewed = await store.reviewAssistantProposal(scope, suggested);
    const saved = await store.reviewAssistantProposal(scope, suggested, reviewed.preview);
    expect((await store.reviewAssistantProposal(scope, suggested, reviewed.preview)).status).toBe('saved');
    await expect(store.reviewAssistantProposal(scope, { ...suggested, content: 'different' }, reviewed.preview)).rejects.toThrow('操作标识');
    if (saved.status !== 'saved') throw new Error('expected assistant write receipt');
    store.editDocument('note-id', 'Later\nB\nAI\n');
    const reverse = { ...suggested, id: crypto.randomUUID(), base: saved.applied!.after, content: saved.applied!.before };
    const undoPreview = await store.reviewAssistantProposal(scope, reverse);
    expect(undoPreview.preview!.after).toBe('Later\nB\nC\n');
    await expect(store.reviewAssistantProposal({ id: 'other', path: 'other' }, reverse)).rejects.toThrow('已切换');
  });
});

describe('workspace file reconciliation', () => {
  it('persists pixel layouts separately from Markdown and restores them after rename and reopen', async () => {
    backend.files.set('table.md', { id: 'a12345', content: '| A | B |\n| --- | --- |\n| 1 | 2 |\n' });
    await store.refresh();
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'a12345')!);
    const source = store.active!.content;
    const tables = [{ id: 'table-one', widths: [90, 1000], anchor: { content: 'table', before: '', after: '' } }];
    store.editTableLayout('a12345', tables);
    expect(store.pending).toBe(true);
    expect(await store.flush()).toBe(true);
    expect(backend.files.get('table.md')!.content).toBe(source);
    expect(JSON.parse(backend.files.get('.tano/document-layout/a12345.tano.json')!.content).tables).toEqual(tables);
    await backend.rename('table.md', 'renamed.md');
    await store.refresh();
    expect(store.active!.path).toBe('renamed.md');
    await store.close('a12345');
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'a12345')!);
    expect(store.active!.tableLayout!.file.tables).toEqual(tables);
  });

  it('keeps a table layout draft open when its write fails and retries it on flush', async () => {
    backend.files.set('table.md', { id: 'a12345', content: 'table' });
    await store.refresh();
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'a12345')!);
    store.editTableLayout('a12345', [{ id: 'table-one', widths: [90, 1000], anchor: { content: 'table', before: '', after: '' } }]);
    backend.failCopies = true;
    expect(await store.flush()).toBe(false);
    await store.close('a12345');
    expect(store.documents.some(doc => doc.id === 'a12345')).toBe(true);
    backend.failCopies = false;
    expect(await store.flush()).toBe(true);
    expect(store.pending).toBe(false);
  });

  it('preserves conflicting layouts once and allows closing after both versions are on disk', async () => {
    backend.files.set('table.md', { id: 'a12345', content: 'table' });
    await store.refresh();
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'a12345')!);
    const tables = [{ id: 'table-one', widths: [90, 160], anchor: { content: 'table', before: '', after: '' } }];
    store.editTableLayout('a12345', tables);
    await store.flush();
    const path = '.tano/document-layout/a12345.tano.json';
    const external = JSON.parse(backend.files.get(path)!.content);
    external.tables[0].widths = [200, 160];
    backend.files.get(path)!.content = JSON.stringify(external);
    store.editTableLayout('a12345', [{ ...tables[0], widths: [300, 160] }]);
    expect(await store.flush()).toBe(true);
    expect(store.active!.tableLayout!.conflict?.path).toContain('.tano/conflicts/');
    expect(JSON.parse(backend.files.get(path)!.content).tables[0].widths).toEqual([200, 160]);
    await store.flush();
    expect([...backend.files.keys()].filter(path => path.startsWith('.tano/conflicts/'))).toHaveLength(1);
    await store.close('a12345');
    expect(store.documents.some(doc => doc.id === 'a12345')).toBe(false);
  });

  it('leaves the workspace, keeps its session, and releases its watcher', async () => {
    const close = vi.spyOn(backend, 'close');
    const beforeSwitch = vi.fn(async () => {});
    const afterSwitch = vi.fn(async () => {});
    store.setDocumentLifecycle({ beforeSwitch, afterSwitch, beforeCloseDocument: async () => {} });
    store.edit('saved before leaving');

    expect(await store.leaveWorkspace()).toBe(true);
    expect(backend.files.get('note.md')?.content).toBe('saved before leaving');
    expect(backend.session?.tabs).toEqual(['note-id']);
    expect(close).toHaveBeenCalledWith('test');
    expect(backend.watchCallback).toBeUndefined();
    expect(beforeSwitch).toHaveBeenCalledOnce();
    expect(afterSwitch).toHaveBeenCalledOnce();
    expect(store.workspace).toBeNull();
    expect(store.tabs).toEqual([]);

    await store.openWorkspace();
    expect(store.workspace?.id).toBe('test');
    expect(store.active?.content).toBe('saved before leaving');
  });

  it('keeps the workspace open if its changes cannot be saved', async () => {
    const close = vi.spyOn(backend, 'close');
    store.edit('unsaved');
    backend.failWrites = true;

    expect(await store.leaveWorkspace()).toBe(false);
    expect(store.workspace?.id).toBe('test');
    expect(store.active?.content).toBe('unsaved');
    expect(backend.watchCallback).toBeDefined();
    expect(close).not.toHaveBeenCalled();
  });

  it('opens one graph tab, keeps it when opening documents, and restores it from the session', async () => {
    backend.files.set('other.md', { id: 'other-id', content: 'Other' });
    await store.refresh();
    store.openGraphTab(); store.openGraphTab();
    expect(store.tabs.filter(tab => tab.graph)).toHaveLength(1);
    expect(store.active).toBeUndefined();
    await store.openFile(store.workspace!.files.find(file => file.id === 'other-id')!);
    expect(store.tabs.map(tab => tab.id)).toEqual(['note-id', GRAPH_TAB_ID, 'other-id']);
    store.openGraphTab();
    await vi.waitFor(() => expect(backend.session?.activeId).toBe(GRAPH_TAB_ID));
    await store.dispose();
    setActivePinia(configureWorkbench(createPinia(), { adapter: backend, native: false, mobile: false }));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.activeId).toBe(GRAPH_TAB_ID);
    expect(store.tabs.find(tab => tab.graph)?.blank).toBe(false);
    await store.removeEntry(store.workspace!.files.find(file => file.id === 'other-id')!);
    expect(store.tabs.some(tab => tab.graph)).toBe(true);
    const closeHook = vi.fn(async () => {});
    store.setDocumentLifecycle({ beforeSwitch: async () => {}, beforeCloseDocument: closeHook });
    await store.close(GRAPH_TAB_ID);
    expect(closeHook).not.toHaveBeenCalled();
    expect(store.tabs.some(tab => tab.graph)).toBe(false);
  });
  it('opens the plugin page as one restorable tab without replacing it when a file opens', async () => {
    backend.files.set('other.md', { id: 'other-id', content: 'Other' });
    await store.refresh();
    store.openPluginsTab(); store.openPluginsTab();
    expect(store.tabs.filter(tab => tab.plugins)).toHaveLength(1);
    expect(store.activeId).toBe(PLUGINS_TAB_ID);
    await store.openFile(store.workspace!.files.find(file => file.id === 'other-id')!);
    expect(store.tabs.map(tab => tab.id)).toEqual(['note-id', PLUGINS_TAB_ID, 'other-id']);
    store.openPluginsTab();
    await vi.waitFor(() => expect(backend.session?.activeId).toBe(PLUGINS_TAB_ID));
    await store.dispose();
    setActivePinia(configureWorkbench(createPinia(), { adapter: backend, native: false, mobile: false }));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.activeId).toBe(PLUGINS_TAB_ID);
    const closeHook = vi.fn(async () => {});
    store.setDocumentLifecycle({ beforeSwitch: async () => {}, beforeCloseDocument: closeHook });
    await store.close(PLUGINS_TAB_ID);
    expect(closeHook).not.toHaveBeenCalled();
    expect(store.tabs.some(tab => tab.plugins)).toBe(false);
  });
  it('opens the calendar as one restorable tab and keeps it when documents open', async () => {
    backend.files.set('other.md', { id: 'other-id', content: 'Other' });
    await store.refresh();
    store.openCalendarTab();
    store.openCalendarTab();
    expect(store.tabs.filter(tab => tab.calendar)).toHaveLength(1);
    expect(store.activeId).toBe(CALENDAR_TAB_ID);
    await store.openFile(store.workspace!.files.find(file => file.id === 'other-id')!);
    expect(store.tabs.map(tab => tab.id)).toEqual(['note-id', CALENDAR_TAB_ID, 'other-id']);
    store.openCalendarTab();
    await vi.waitFor(() => expect(backend.session?.activeId).toBe(CALENDAR_TAB_ID));
    await store.dispose();
    setActivePinia(configureWorkbench(createPinia(), { adapter: backend, native: false, mobile: false }));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.activeId).toBe(CALENDAR_TAB_ID);
    await store.close(CALENDAR_TAB_ID);
    expect(store.tabs.some(tab => tab.calendar)).toBe(false);
  });
  it('keeps extension views separate from file contents and restores registered singleton tabs', async () => {
    const filesBefore = structuredClone([...backend.files]);
    store.registerViews([extensionView]);
    store.openViewTab(extensionView.id); store.openViewTab(extensionView.id);
    expect(store.tabs.filter(tab => tab.view)).toHaveLength(1);
    expect(store.tabs.find(tab => tab.view)?.view?.label).toBe('扩展');
    expect(store.active).toBeUndefined();
    await store.openFile(store.workspace!.files[0]!);
    expect(store.tabs.some(tab => tab.view)).toBe(true);
    store.openViewTab(extensionView.id);
    await vi.waitFor(() => expect(backend.session?.activeId).toBe(extensionView.id));
    expect(backend.session?.documents.some(doc => doc.id === extensionView.id)).toBe(false);
    await store.dispose();
    setActivePinia(configureWorkbench(createPinia(), { adapter: backend, native: false, mobile: false }));
    store = useWorkspaceStore();
    store.registerViews([extensionView]);
    await store.initialize();
    expect(store.activeId).toBe(extensionView.id);
    const closeHook = vi.fn(async () => {});
    store.setDocumentLifecycle({ beforeSwitch: async () => {}, beforeCloseDocument: closeHook });
    await store.close(extensionView.id);
    expect(closeHook).not.toHaveBeenCalled();
    expect([...backend.files]).toEqual(filesBefore);
  });
  it('drops unavailable extension tabs on restore and keeps documents usable in the local product', async () => {
    store.registerViews([extensionView]);
    store.openViewTab(extensionView.id);
    await vi.waitFor(() => expect(backend.session?.activeId).toBe(extensionView.id));
    await store.dispose();
    setActivePinia(configureWorkbench(createPinia(), { adapter: backend, native: false, mobile: false }));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.tabs.map(tab => tab.id)).toEqual(['note-id']);
    expect(store.active?.id).toBe('note-id');
    expect(() => store.openViewTab(extensionView.id)).toThrow('未注册');
  });
  it('rejects invalid or reserved view identities and does not strand open views', async () => {
    expect(() => store.registerViews([{ ...extensionView, id: 'note-id' }])).toThrow('无效或重复');
    expect(() => store.registerViews([{ ...extensionView, id: GRAPH_TAB_ID }])).toThrow('无效或重复');
    expect(() => store.registerViews([extensionView, extensionView])).toThrow('无效或重复');
    store.registerViews([extensionView]);
    store.openViewTab(extensionView.id);
    expect(() => store.registerViews([])).toThrow('请先关闭');
    await store.close(extensionView.id);
    store.registerViews([]);
    expect(() => store.openViewTab(extensionView.id)).toThrow('未注册');
  });
  it('reads graph content without writing drafts and rejects stale workspace or file identities', async () => {
    store.edit('[[draft link]]');
    const file = store.workspace!.files.find(file => file.id === 'note-id')!;
    const write = vi.spyOn(backend, 'write');
    expect(await store.readGraphDocument(store.workspace!, file)).toBe('[[draft link]]');
    expect(write).not.toHaveBeenCalled();
    await expect(store.readGraphDocument({ id: 'other', path: 'other' }, file)).rejects.toThrow('工作区已切换');
    await expect(store.readGraphDocument(store.workspace!, { ...file, path: 'moved.md' })).rejects.toThrow('文档已移动或删除');
  });
  it('reports metadata loss while retaining the unsaved draft in application data', async () => {
    store.edit('unsaved draft');
    await vi.waitFor(() => expect(backend.session?.documents[0]?.draft?.content).toBe('unsaved draft'));
    vi.spyOn(backend, 'refresh').mockRejectedValue(new Error('.tano 已丢失'));

    await store.refresh();

    expect(store.fatal).toBe('.tano 已丢失');
    expect(store.active?.content).toBe('unsaved draft');
    expect(backend.session?.documents[0]?.draft?.content).toBe('unsaved draft');
  });
  it('reports the original workspace open error', async () => {
    const originalError = '此文件夹已有 .tano/config.json，但缺少 .tano/identities.json';
    vi.spyOn(backend, 'open').mockRejectedValue(new Error(originalError));

    await store.openWorkspace('legacy-folder');

    expect(store.fatal).toBe(originalError);
  });

  it('reports a deleted workspace folder without creating or writing files', async () => {
    const create = vi.spyOn(backend, 'create');
    const createFolder = vi.spyOn(backend, 'createFolder');
    const write = vi.spyOn(backend, 'write');
    vi.spyOn(backend, 'open').mockRejectedValue(new Error('工作文件夹已不存在'));

    await store.openWorkspace('deleted-folder');

    expect(store.fatal).toBe('工作文件夹已不存在');
    expect(create).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('updates the file tree from external filesystem events without a manual refresh', async () => {
    await backend.createFolder('外部目录');
    await backend.create('外部目录/新文档.md', 'external');
    backend.watchCallback?.();
    await vi.waitFor(() =>
      expect(store.workspace?.files.map((file) => file.path)).toContain('外部目录/新文档.md'),
    );
    await backend.rename('外部目录/新文档.md', '外部目录/已改名.md');
    backend.watchCallback?.();
    await vi.waitFor(() =>
      expect(store.workspace?.files.map((file) => file.path)).toContain('外部目录/已改名.md'),
    );
    expect(store.workspace?.files.map((file) => file.path)).not.toContain('外部目录/新文档.md');
  });
  it('refreshes while filesystem events keep arriving', async () => {
    const refresh = vi.spyOn(backend, 'refresh');
    const signaling = setInterval(() => backend.watchCallback?.(), 35);
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(refresh).toHaveBeenCalled();
    } finally {
      clearInterval(signaling);
    }
  });
  it('reuses the focused tab when opening a file and restores the replacement', async () => {
    await backend.create('other.md', 'other');
    await store.refresh();
    const file = store.workspace!.files.find((entry) => entry.path === 'other.md')!;
    await store.openFile(file);
    expect(store.tabs.map((tab) => tab.id)).toEqual([file.id]);
    expect(store.documents.map((doc) => doc.path)).toEqual(['other.md']);
    await store.flush();
    store.dispose();
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.tabs.map((tab) => tab.id)).toEqual([file.id]);
    expect(store.active?.path).toBe('other.md');
  });
  it('creates a blank tab, fills it with a file, and restores an unused blank tab', async () => {
    await backend.create('other.md', 'other');
    await store.refresh();
    store.createBlankTab();
    const blankId = store.activeId;
    expect(store.tabs.map((tab) => tab.blank)).toEqual([false, true]);
    expect(store.active).toBeUndefined();
    await store.openFile(store.workspace!.files.find((entry) => entry.path === 'other.md')!);
    expect(store.tabs.map((tab) => tab.path)).toEqual(['note.md', 'other.md']);
    store.createBlankTab();
    expect(store.activeId).not.toBe(blankId);
    const remainingBlank = store.activeId;
    await store.flush();
    store.dispose();
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.activeId).toBe(remainingBlank);
    expect(store.tabs.map((tab) => tab.blank)).toEqual([false, false, true]);
    await store.close(remainingBlank);
    expect(store.tabs).toHaveLength(2);
  });
  it('keeps the current tab and draft when a save fails during replacement', async () => {
    await backend.create('other.md', 'other');
    await store.refresh();
    store.edit('unsaved');
    backend.failWrites = true;
    await store.openFile(store.workspace!.files.find((entry) => entry.path === 'other.md')!);
    expect(store.active?.path).toBe('note.md');
    expect(store.active?.content).toBe('unsaved');
    expect(store.tabs).toHaveLength(1);
  });
  it('keeps edits made while the next file is loading', async () => {
    await backend.create('other.md', 'other');
    await store.refresh();
    const file = store.workspace!.files.find((entry) => entry.path === 'other.md')!;
    const read = backend.read.bind(backend);
    let release!: () => void;
    const loading = new Promise<void>((resolve) => { release = resolve; });
    const started = vi.fn();
    vi.spyOn(backend, 'read').mockImplementation(async (path) => {
      if (path === 'other.md') {
        started();
        await loading;
      }
      return read(path);
    });
    const opening = store.openFile(file);
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    store.edit('edited while loading');
    release();
    await opening;
    expect(store.active?.path).toBe('note.md');
    expect(store.active?.content).toBe('edited while loading');
    expect(store.tabs).toHaveLength(1);
  });
  it('opens a file in an additional tab when requested explicitly', async () => {
    await backend.create('other.md', 'other');
    await store.refresh();
    await store.openFileInNewTab(store.workspace!.files.find((entry) => entry.path === 'other.md')!);
    expect(store.tabs.map((tab) => tab.path)).toEqual(['note.md', 'other.md']);
  });
  it('opens dropped files at the requested slot without replacing tabs or writing files', async () => {
    await backend.create('second.md', 'second');
    await backend.create('third.md', 'third');
    await store.refresh();
    store.openGraphTab();
    store.createBlankTab();
    const blankId = store.activeId;
    const write = vi.spyOn(backend, 'write');
    const move = vi.spyOn(backend, 'move');
    const files = store.workspace!.files.filter((file) => file.path !== 'note.md');
    await store.openFilesInNewTabsAt(files.map((file) => file.id), 1, 'test');
    expect(store.tabs.map((tab) => tab.id)).toEqual(['note-id', ...files.map((file) => file.id), GRAPH_TAB_ID, blankId]);
    expect(store.activeId).toBe(files[1].id);
    expect(write).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(backend.session?.tabs).toEqual(store.tabs.map((tab) => tab.id)));
  });
  it.each([0, 1, 3])('reuses an open draft when dropped into slot %s', async (index) => {
    await store.create('second.md', false, 'second');
    await store.create('third.md', false, 'third');
    store.activeId = 'note-id';
    store.edit('unsaved draft');
    const draft = store.active;
    const read = vi.spyOn(backend, 'read');
    const original = store.tabs.map((tab) => tab.id);
    await store.openFilesInNewTabsAt(['note-id'], index, 'test');
    const expected = original.slice(1);
    expected.splice(Math.max(0, index - 1), 0, 'note-id');
    expect(store.tabs.map((tab) => tab.id)).toEqual(expected);
    expect(store.active).toBe(draft);
    expect(store.active?.content).toBe('unsaved draft');
    expect(read).not.toHaveBeenCalled();
  });
  it('preserves selection order when dropping a mix of open and closed files', async () => {
    await store.create('second.md', false, 'second');
    await store.create('third.md', false, 'third');
    await backend.create('fourth.md', 'fourth');
    await store.refresh();
    const id = (path: string) => store.workspace!.files.find((file) => file.path === path)!.id;
    const ids = [id('third.md'), id('fourth.md'), 'note-id'];
    await store.openFilesInNewTabsAt([...ids, ids[0]], 1, 'test');
    expect(store.tabs.map((tab) => tab.id)).toEqual([...ids, id('second.md')]);
  });
  it('opens into an empty strip and resolves a dragged file by its current identity', async () => {
    await store.close('note-id');
    await backend.rename('note.md', 'renamed.md');
    await store.refresh();
    await store.openFilesInNewTabsAt(['note-id'], 0, 'test');
    expect(store.tabs.map((tab) => tab.path)).toEqual(['renamed.md']);
    expect(store.activeId).toBe('note-id');
  });
  it('ignores foreign, missing, folder and unsupported file drops', async () => {
    await backend.create('image.png', 'image');
    await backend.createFolder('folder');
    await store.refresh();
    const original = store.tabs.map((tab) => tab.id);
    const read = vi.spyOn(backend, 'read');
    await store.openFilesInNewTabsAt(['note-id'], 0, 'another-workspace');
    await store.openFilesInNewTabsAt(['missing'], 0, 'test');
    await store.openFilesInNewTabsAt(['folder:folder'], 0, 'test');
    await store.openFilesInNewTabsAt(store.workspace!.files.map((file) => file.id), 0, 'test');
    expect(store.tabs.map((tab) => tab.id)).toEqual(original);
    expect(read).not.toHaveBeenCalled();
  });
  it('moves backward and forward through visits, reopening replaced documents', async () => {
    const firstId = store.activeId;
    await backend.create('second.md', 'second');
    await backend.create('third.md', 'third');
    await backend.create('fourth.md', 'fourth');
    await store.refresh();
    const file = (path: string) => store.workspace!.files.find((entry) => entry.path === path)!;
    expect(store.canGoBack).toBe(false);
    await store.openFile(file('second.md'));
    const secondId = store.activeId;
    await store.openFile(file('third.md'));
    const thirdId = store.activeId;
    expect(store.tabs.map((tab) => tab.id)).toEqual([thirdId]);
    await store.navigateHistory(-1);
    expect(store.activeId).toBe(secondId);
    expect(store.tabs.map((tab) => tab.id)).toEqual([secondId]);
    await store.navigateHistory(-1);
    expect(store.activeId).toBe(firstId);
    expect(store.canGoBack).toBe(false);
    await store.navigateHistory(1);
    expect(store.activeId).toBe(secondId);
    await store.navigateHistory(1);
    expect(store.activeId).toBe(thirdId);
    expect(store.canGoForward).toBe(false);
    await store.navigateHistory(-1);
    await store.openFile(file('fourth.md'));
    expect(store.canGoForward).toBe(false);
    await store.navigateHistory(-1);
    expect(store.activeId).toBe(secondId);
  });
  it('keeps navigation history separate for each tab', async () => {
    const firstId = store.activeId;
    await backend.create('second.md', 'second');
    await backend.create('third.md', 'third');
    await store.refresh();
    const file = (path: string) => store.workspace!.files.find((entry) => entry.path === path)!;
    await store.openFileInNewTab(file('second.md'));
    const secondId = store.activeId;
    await store.openFile(file('third.md'));
    const thirdId = store.activeId;
    store.activeId = firstId;
    expect(store.canGoBack).toBe(false);
    store.activeId = thirdId;
    expect(store.canGoBack).toBe(true);
    await store.navigateHistory(-1);
    expect(store.activeId).toBe(secondId);
    expect(store.tabs.map((tab) => tab.id)).toEqual([firstId, secondId]);
    store.activeId = firstId;
    expect(store.canGoBack).toBe(false);
  });
  it('skips deleted documents in navigation history', async () => {
    await backend.create('second.md', 'second');
    await store.refresh();
    await store.openFile(store.workspace!.files.find((entry) => entry.path === 'second.md')!);
    expect(store.canGoBack).toBe(true);
    await backend.remove('note.md');
    await store.refresh();
    expect(store.canGoBack).toBe(false);
  });
  it('saves pending edits before creating an independent copy', async () => {
    const file = store.workspace!.files.find((entry) => entry.path === 'note.md')!;
    await store.openFile(file);
    store.edit('修改后的正文');
    const destination = await store.duplicateEntry(file, store.workspace!.id);
    expect(destination).toBe('note 副本.md');
    expect(backend.files.get('note.md')?.content).toBe('修改后的正文');
    expect(backend.files.get(destination)?.content).toBe('修改后的正文');
    expect(backend.files.get(destination)?.id).not.toBe(file.id);
  });
  it('reorders tabs atomically and restores the order without changing the active document', async () => {
    await store.create('second.md', false, 'second');
    await store.create('third.md', false, 'third');
    await store.flush();
    const [first, second, third] = store.documents;
    const save = vi.spyOn(backend, 'saveSession');
    const write = vi.spyOn(backend, 'write');
    store.moveDocument(first.id, third.id, 'after');
    expect(store.documents.map((doc) => doc.id)).toEqual([second.id, third.id, first.id]);
    expect(store.activeId).toBe(third.id);
    expect(store.documents[2]).toBe(first);
    await vi.waitFor(() =>
      expect(backend.session?.documents.map((doc) => doc.id)).toEqual([
        second.id,
        third.id,
        first.id,
      ]),
    );
    expect(save.mock.calls.every(([, session]) => session.documents.length === 3)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    store.dispose();
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.documents.map((doc) => doc.id)).toEqual([second.id, third.id, first.id]);
    expect(store.activeId).toBe(third.id);
    store.moveDocument(first.id, second.id, 'before');
    expect(store.documents.map((doc) => doc.id)).toEqual([first.id, second.id, third.id]);
  });
  it('ignores reorder requests for closed tabs, identical targets and unchanged positions', async () => {
    await store.create('second.md', false, 'second');
    const original = store.documents;
    const [first, second] = original;
    store.moveDocument('closed', first.id, 'before');
    store.moveDocument(first.id, 'closed', 'after');
    store.moveDocument(first.id, first.id, 'after');
    store.moveDocument(first.id, second.id, 'before');
    expect(store.documents).toBe(original);
  });
  it('places an arriving tab at a cross-window insertion index without changing file content', async () => {
    await store.create('second.md', false, 'second');
    await store.create('third.md', false, 'third');
    await store.flush();
    const [first, second, third] = store.tabs;
    store.placeTab(third.id, 1);
    expect(store.tabs.map((tab) => tab.id)).toEqual([first.id, third.id, second.id]);
    expect(store.documents.map((doc) => doc.id)).toEqual([first.id, third.id, second.id]);
    store.placeTab('closed', 0);
    expect(store.tabs.map((tab) => tab.id)).toEqual([first.id, third.id, second.id]);
    expect(backend.files.get('third.md')?.content).toBe('third');
  });
  it('moves an already open file into the focused slot and restores that order', async () => {
    await store.create('second.md', false, 'second');
    await store.openFile(store.workspace!.files.find((file) => file.path === 'note.md')!);
    expect(store.tabs.map((tab) => tab.path)).toEqual(['second.md', 'note.md']);
    expect(store.activeId).toBe('note-id');
    await store.flush();
    store.dispose();
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.documents.map((doc) => doc.path)).toEqual(['second.md', 'note.md']);
    expect(store.active!.path).toBe('note.md');
  });
  it('journals before autosave and merges recovered input with a newer external edit', async () => {
    store.edit('A\nB\nC\nhuman\n');
    await vi.waitFor(() => expect(backend.session?.documents[0].draft?.content).toContain('human'));
    expect(backend.files.get('note.md')!.content).toBe('A\nB\nC\n');
    store.dispose();
    backend.files.get('note.md')!.content = 'agent\nB\nC\n';
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(backend.files.get('note.md')!.content).toBe('agent\nB\nC\nhuman\n');
    expect(store.active!.content).toBe('agent\nB\nC\nhuman\n');
  });
  it('preserves a recovered draft as a conflict copy when the disk edit overlaps', async () => {
    store.edit('human\n');
    await vi.waitFor(() => expect(backend.session?.documents[0].draft?.content).toBe('human\n'));
    store.dispose();
    backend.files.get('note.md')!.content = 'agent\n';
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(backend.files.get('note.md')!.content).toBe('agent\n');
    expect(backend.files.get(store.active!.conflict!.copyPath)!.content).toBe('human\n');
  });
  it('retains a missing-file draft without resurrecting the deleted path', async () => {
    store.edit('unsaved after crash');
    await vi.waitFor(() => expect(backend.session?.documents[0].draft).toBeDefined());
    store.dispose();
    backend.files.delete('note.md');
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    expect(store.active!.content).toBe('unsaved after crash');
    expect(store.active!.missing).toBe(true);
    expect(backend.files.has('note.md')).toBe(false);
  });
  it('keeps normal document saves working when the recovery journal fails', async () => {
    backend.failJournal = true;
    store.edit('saved despite journal failure');
    expect(await store.flush()).toBe(true);
    expect(backend.files.get('note.md')!.content).toBe('saved despite journal failure');
    expect(store.sessionError).toContain('journal disk full');
  });
  it('does not overwrite a corrupt journal after opening the workspace', async () => {
    await store.flush();
    const before = structuredClone(backend.session);
    store.dispose();
    backend.corruptJournal = true;
    setActivePinia(configureWorkbench(createPinia(), {adapter: fixture.adapter!, native: false, mobile: false}));
    store = useWorkspaceStore();
    await store.initialize();
    store.edit('new saved content');
    await store.flush();
    expect(backend.session).toEqual(before);
    expect(store.sessionError).toContain('corrupt journal');
  });
  it('does not restore a historical copy into a different workspace', async () => {
    await expect(
      store.create('restored.md', false, 'historical', 'previous-workspace'),
    ).rejects.toThrow('工作空间已切换');
    expect(backend.files.has('restored.md')).toBe(false);
  });
  it('opens documents without rewriting their Markdown', async () => {
    expect(store.active?.content).toBe('A\nB\nC\n');
    expect(store.pending).toBe(false);
    await store.flush();
    expect(backend.files.get('note.md')?.content).toBe('A\nB\nC\n');
  });
  it('loads an agent edit into a clean open document', async () => {
    backend.files.get('note.md')!.content = 'agent\n';
    await store.refresh();
    expect(store.active?.content).toBe('agent\n');
    expect(store.pending).toBe(false);
  });
  it('merges independent external and unsaved local changes before saving', async () => {
    store.edit('A\nB\nC\nD\n');
    backend.files.get('note.md')!.content = 'A\nX\nC\n';
    expect(await store.flush()).toBe(true);
    expect(backend.files.get('note.md')!.content).toBe('A\nX\nC\nD\n');
  });
  it('preserves both versions when the same paragraph changes', async () => {
    store.edit('human\n');
    backend.files.get('note.md')!.content = 'agent\n';
    await store.flush();
    const copyPath = store.active!.conflict!.copyPath;
    expect(backend.files.get('note.md')!.content).toBe('agent\n');
    expect(backend.files.get(copyPath)!.content).toBe('human\n');
    store.edit('must not edit a frozen conflict');
    expect(store.active!.content).toBe('human\n');
    await store.resolveConflict(store.active!, true);
    expect(store.active!.path).toBe(copyPath);
  });
  it('does not claim a failed conflict copy was preserved', async () => {
    store.edit('human\n');
    backend.files.get('note.md')!.content = 'agent\n';
    backend.failCopies = true;
    expect(await store.flush()).toBe(false);
    expect(store.active!.conflict).toBeUndefined();
    expect(store.active!.content).toBe('human\n');
    expect(store.active!.error).toContain('cannot create');
  });
  it('clears a previous save error after resolving a conflict from disk', async () => {
    backend.failWrites = true;
    store.edit('human\n');
    expect(await store.flush()).toBe(false);
    expect(store.active!.error).toContain('disk full');
    backend.failWrites = false;
    backend.files.get('note.md')!.content = 'agent\n';
    await store.refresh();
    expect(store.active!.conflict).toBeDefined();
    await store.resolveConflict(store.active!, false);
    expect(store.active!.content).toBe('agent\n');
    expect(store.active!.error).toBeUndefined();
    expect(store.pending).toBe(false);
  });
  it('keeps dirty tabs open after a failed save', async () => {
    backend.failWrites = true;
    store.edit('unsaved\n');
    await store.close('note-id');
    expect(store.documents).toHaveLength(1);
    expect(store.active!.content).toBe('unsaved\n');
    expect(store.pending).toBe(true);
  });
  it('keeps edits typed while a write is in flight', async () => {
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      started = resolve;
    });
    backend.beforeWrite = () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    store.edit('first\n');
    const save = store.flush();
    await inFlight;
    store.edit('second\n');
    release();
    await save;
    expect(store.active!.content).toBe('second\n');
    expect(store.pending).toBe(true);
    backend.beforeWrite = undefined;
    await store.flush();
    expect(backend.files.get('note.md')!.content).toBe('second\n');
  });
  it('tracks external rename by file identity', async () => {
    await backend.rename('note.md', 'renamed.md');
    await store.refresh();
    expect(store.active!.id).toBe('note-id');
    expect(store.active!.path).toBe('renamed.md');
  });

  it('creates blank documents without duplicating the filename as a body heading', async () => {
    await store.createUntitledDocument();
    expect(store.active!.path).toBe('新建文档.md');
    expect(store.active!.content).toBe('');
    await store.createUntitledDocument();
    expect(store.active!.path).toBe('新建文档 2.md');
  });

  it('creates untitled entries in the selected folder and rejects a missing parent', async () => {
    await backend.createFolder('资料');
    await store.createUntitledDocument('资料');
    expect(store.active!.path).toBe('资料/新建文档.md');
    expect(store.active!.content).toBe('');
    await store.createUntitledFolder('资料');
    expect(backend.folders.has('资料/新建文件夹')).toBe(true);
    expect(store.active!.path).toBe('资料/新建文档.md');
    await store.createUntitledFolder();
    expect(backend.folders.has('新建文件夹')).toBe(true);
    await expect(store.createUntitledDocument('已删除')).rejects.toThrow('目标文件夹不存在');
    await expect(store.createUntitledFolder('已删除')).rejects.toThrow('目标文件夹不存在');
    expect(backend.files.has('已删除/新建文档.md')).toBe(false);
    expect(backend.folders.has('已删除/新建文件夹')).toBe(false);
  });

  it('avoids fresh file and folder collisions when untitled entries are created repeatedly', async () => {
    await backend.create('新建文档.MD', 'existing document');
    await backend.createFolder('新建文档 2.md');
    await backend.create('新建文件夹', 'existing attachment');
    await backend.createFolder('新建文件夹 2');
    await Promise.all([
      store.createUntitledDocument(),
      store.createUntitledDocument(),
      store.createUntitledFolder(),
      store.createUntitledFolder(),
    ]);
    expect(backend.files.has('新建文档 3.md')).toBe(true);
    expect(backend.files.has('新建文档 4.md')).toBe(true);
    expect(backend.folders.has('新建文件夹 3')).toBe(true);
    expect(backend.folders.has('新建文件夹 4')).toBe(true);
    expect((await backend.read('新建文档.MD')).content).toBe('existing document');
    expect((await backend.read('新建文件夹')).content).toBe('existing attachment');
  });

  it('refreshes filename conflicts before rename and preserves both files', async () => {
    await backend.create('TAKEN.md', 'other content');
    await expect(store.rename(store.active!, 'taken.md')).rejects.toThrow('已经存在一个同名文件');
    expect(store.active!.path).toBe('note.md');
    expect((await backend.read('note.md')).content).toBe('A\nB\nC\n');
    expect((await backend.read('TAKEN.md')).content).toBe('other content');
  });
  it('renames and removes a file selected in the tree without changing the active document', async () => {
    await backend.create('other.md', 'other\n');
    await store.refresh();
    const target = store.workspace!.files.find((file) => file.path === 'other.md')!;
    await store.renameEntry(target, 'renamed.md');
    expect(backend.files.has('other.md')).toBe(false);
    expect(backend.files.has('renamed.md')).toBe(true);
    expect(store.active!.path).toBe('note.md');
    await expect(store.removeEntry(target)).rejects.toThrow('文件位置已变化');
    const renamed = store.workspace!.files.find((file) => file.id === target.id)!;
    await store.removeEntry(renamed);
    expect(backend.files.has('renamed.md')).toBe(false);
    expect(store.active!.path).toBe('note.md');
  });
  it('renames a folder and attachment while updating open document paths', async () => {
    await backend.createFolder('资料');
    await backend.create('资料/笔记.md', 'nested');
    await backend.create('资料/图片.png', 'image');
    await store.refresh();
    const folder = store.workspace!.files.find((entry) => entry.path === '资料')!;
    const nested = store.workspace!.files.find((entry) => entry.path === '资料/笔记.md')!;
    await store.openFile(nested);

    await store.renameEntry(folder, '新资料');
    expect(store.active?.path).toBe('新资料/笔记.md');
    const attachment = store.workspace!.files.find((entry) => entry.path === '新资料/图片.png')!;
    await store.renameEntry(attachment, '新资料/照片.png');
    expect(backend.files.has('新资料/照片.png')).toBe(true);
    expect(backend.files.has('资料/图片.png')).toBe(false);
  });
  it('removes a mixed selection once per top-level entry and closes documents inside folders', async () => {
    await backend.createFolder('资料');
    await backend.create('资料/笔记.md', 'nested');
    await backend.create('图片.png', 'attachment');
    await store.refresh();
    const snapshot = [...store.workspace!.files];
    const folder = snapshot.find((entry) => entry.path === '资料')!;
    const nested = snapshot.find((entry) => entry.path === '资料/笔记.md')!;
    const attachment = snapshot.find((entry) => entry.path === '图片.png')!;
    await store.openFileInNewTab(nested);

    await store.removeEntries([folder, nested, attachment], store.workspace!.id, snapshot);
    expect(backend.files.has('资料/笔记.md')).toBe(false);
    expect(backend.files.has('图片.png')).toBe(false);
    expect(backend.folders.has('资料')).toBe(false);
    expect(store.documents.some((doc) => doc.id === nested.id)).toBe(false);
    expect(store.activeId).toBe('note-id');
  });
  it('refuses to delete a folder when a new child appeared after selection', async () => {
    await backend.createFolder('资料');
    await store.refresh();
    const snapshot = [...store.workspace!.files];
    const folder = snapshot.find((entry) => entry.path === '资料')!;
    await backend.create('资料/外部.md', 'external');

    await expect(store.removeEntries([folder], store.workspace!.id, snapshot)).rejects.toThrow(
      '内容已变化',
    );
    expect(backend.files.has('资料/外部.md')).toBe(true);
    expect(backend.folders.has('资料')).toBe(true);
  });
  it('refuses to delete a selected file changed outside the editor', async () => {
    const snapshot = [...store.workspace!.files];
    const file = snapshot.find((entry) => entry.path === 'note.md')!;
    backend.files.get('note.md')!.content = 'external change';

    await expect(store.removeEntries([file], store.workspace!.id, snapshot)).rejects.toThrow(
      '内容已变化',
    );
    expect(backend.files.has('note.md')).toBe(true);
  });
  it('moves a folder with open documents and attachments while keeping the active tab identity', async () => {
    await backend.createFolder('来源');
    await backend.createFolder('归档');
    await backend.create('来源/笔记.md', 'text');
    await backend.create('来源/图片.png', 'image');
    await store.refresh();
    const folder = store.workspace!.files.find((entry) => entry.path === '来源')!;
    const document = store.workspace!.files.find((entry) => entry.path === '来源/笔记.md')!;
    await store.openFile(document);
    const activeId = store.activeId;

    await store.moveEntry(folder, '归档', store.workspace!.id);
    expect(store.activeId).toBe(activeId);
    expect(store.active!.path).toBe('归档/来源/笔记.md');
    expect(backend.files.has('归档/来源/图片.png')).toBe(true);
    expect(store.workspace!.files.some((entry) => entry.path === '来源/笔记.md')).toBe(false);
    await expect(store.moveEntry(folder, '', store.workspace!.id)).rejects.toThrow(
      '文件位置已变化',
    );
  });
  it('does not move a file when an open document cannot be saved', async () => {
    await backend.createFolder('归档');
    await store.refresh();
    backend.failWrites = true;
    store.edit('unsaved');
    const source = store.workspace!.files.find((entry) => entry.path === 'note.md')!;
    await expect(store.moveEntry(source, '归档')).rejects.toThrow('未保存');
    expect(backend.files.has('note.md')).toBe(true);
    expect(backend.files.has('归档/note.md')).toBe(false);
  });
  it.each(['cancel', 'failure'] as const)(
    'resumes lifecycle after folder picker %s',
    async (outcome) => {
      const original = store.active;
      const events: string[] = [];
      store.setDocumentLifecycle({
        beforeSwitch: async () => {
          events.push('suspend');
        },
        afterSwitch: async () => {
          expect(store.busy).toBe(false);
          expect(store.active).toBe(original);
          events.push('resume');
        },
        beforeCloseDocument: async () => {},
      });
      fixture.adapter!.open = async () => {
        events.push('picker');
        if (outcome === 'failure') throw new Error('folder unavailable');
        return null;
      };
      await store.openWorkspace();
      expect(events).toEqual(['suspend', 'picker', 'resume']);
      expect(store.documents).toHaveLength(1);
      expect(store.fatal).toBe(outcome === 'failure' ? 'folder unavailable' : '');
    },
  );
  it('does not resurrect a deleted file on automatic save', async () => {
    store.edit('unsaved\n');
    await backend.remove('note.md');
    expect(await store.flush()).toBe(false);
    expect(store.active!.missing).toBe(true);
    expect(backend.files.has('note.md')).toBe(false);
    expect(store.active!.content).toBe('unsaved\n');
    await store.saveCopy(store.active!, 'recovered.md');
    expect(store.active!.path).toBe('recovered.md');
    expect(store.documents).toHaveLength(1);
    expect(await store.flush()).toBe(true);
  });
});


describe('workspace panes', () => {
  it('keeps a pending detached tab and its pane in the recovery session until it actually closes', async () => {
    store.createBlankTab();
    const blank = store.activeId;
    store.dockTab(blank, { paneId: store.panes[0].id, side: 'bottom' });
    const layout = JSON.parse(JSON.stringify(store.layout));
    store.detachingTabId = blank;
    await store.flush();
    expect(store.tabs.map(tab => tab.id)).toContain(blank);
    expect(backend.session?.layout).toEqual(layout);
    expect(backend.session?.tabs).toContain(blank);
    await store.close(blank);
    store.detachingTabId = '';
    await store.flush();
    expect(store.panes).toHaveLength(1);
    expect(backend.session?.tabs).not.toContain(blank);
  });

  it('undoes a transferred tab move including a collapsed source pane without touching its draft', async () => {
    store.createBlankTab();
    const blank = store.activeId, left = store.panes[0].id;
    store.dockTab(blank, { paneId: left, side: 'right' });
    const before = JSON.parse(JSON.stringify(store.layout));
    store.editDocument('note-id', 'Keep this draft');
    const undo = store.dockTab(blank, { paneId: left, side: 'center', index: 0 });
    expect(store.panes).toHaveLength(1);
    undo?.();
    expect(store.layout).toEqual(before);
    expect(store.tabs.map(tab => tab.id)).toEqual(['note-id', blank]);
    expect(store.documents.find(doc => doc.id === 'note-id')?.content).toBe('Keep this draft');
  });

  it('does not roll back other tabs opened while a transfer acknowledgement is pending', () => {
    store.createBlankTab();
    const moved = store.activeId, left = store.panes[0].id;
    const undo = store.dockTab(moved, { paneId: left, side: 'right' });
    store.createBlankTab();
    const later = store.activeId;
    undo?.();
    expect(store.tabs.map(tab => tab.id)).toContain(later);
    expect(store.panes.find(pane => pane.id === left)?.tabs).toContain(moved);
    expect(store.panes).toHaveLength(2);
  });

  it('reads and navigates the history of a specific pane without replacing its neighbor', async () => {
    await backend.create('left-next.md', 'Left next');
    await backend.create('right.md', 'Right');
    await backend.create('right-next.md', 'Right next');
    await store.refresh();
    const file = (path: string) => store.workspace!.files.find(entry => entry.path === path)!;
    const left = store.activePaneId;
    await store.openFile(file('left-next.md'));
    const leftId = store.activeId;
    await store.openFileInNewTab(file('right.md'));
    const rightId = store.activeId;
    store.dockTab(rightId, { paneId: left, side: 'right' });
    const right = store.activePaneId;
    expect(store.canNavigateHistory(-1, leftId)).toBe(true);
    expect(store.canNavigateHistory(-1, rightId)).toBe(false);
    expect(store.activePaneId).toBe(right);
    await store.openFile(file('right-next.md'));
    const rightNextId = store.activeId;
    await store.navigateHistory(-1, left);
    expect(store.panes.find(pane => pane.id === left)?.activeId).toBe('note-id');
    expect(store.panes.find(pane => pane.id === right)?.activeId).toBe(rightNextId);
    expect(store.canNavigateHistory(1, 'note-id')).toBe(true);
    await store.navigateHistory(-1, right);
    expect(store.activeId).toBe(rightId);
    expect(store.panes.find(pane => pane.id === left)?.activeId).toBe('note-id');
    await store.navigateHistory(1, left);
    expect(store.activeId).toBe(leftId);
    expect(store.panes.find(pane => pane.id === right)?.activeId).toBe(rightId);
  });

  it('persists nested splits, selection, proportions and drafts together and restores them', async () => {
    store.createBlankTab();
    const blank = store.activeId;
    const original = store.panes[0].id;
    store.dockTab(blank, { paneId: original, side: 'right' });
    store.focusPane(original);
    store.createBlankTab();
    store.dockTab(store.activeId, { paneId: original, side: 'bottom' });
    store.resizeSplit(store.layout.id, .6);
    store.editDocument('note-id', 'pane draft');
    await store.flush();
    const layout = JSON.parse(JSON.stringify(store.layout));
    const selected = store.activeId;
    expect(store.panes).toHaveLength(3);
    expect(backend.session?.layout).toEqual(layout);
    await store.openWorkspace();
    expect(store.layout).toEqual(layout);
    expect(store.activeId).toBe(selected);
    expect(store.documents.find(doc => doc.id === 'note-id')?.content).toBe('pane draft');
  });

  it('keeps edits bound to their documents and does not swap documents across panes when opening', async () => {
    backend.files.set('other.md', { id: 'other-id', content: 'Other' });
    await store.refresh();
    await store.openFileInNewTab(store.workspace!.files.find(file => file.id === 'other-id')!);
    store.dockTab('other-id', { paneId: store.panes[0].id, side: 'right' });
    const before = store.panes.map(pane => [...pane.tabs]);
    store.editDocument('note-id', 'Left draft');
    store.editDocument('other-id', 'Right draft');
    await store.openFile(store.workspace!.files.find(file => file.id === 'note-id')!);
    expect(store.panes.map(pane => pane.tabs)).toEqual(before);
    expect(store.activeId).toBe('note-id');
    await store.flush();
    expect(backend.files.get('note.md')?.content).toBe('Left draft');
    expect(backend.files.get('other.md')?.content).toBe('Right draft');
  });

  it('replaces within the focused group and collapses only after a tab can safely close', async () => {
    backend.files.set('other.md', { id: 'other-id', content: 'Other' });
    await store.refresh();
    store.createBlankTab();
    const blank = store.activeId;
    store.dockTab(blank, { paneId: store.panes[0].id, side: 'right' });
    const right = store.activePaneId;
    await store.openFile(store.workspace!.files.find(file => file.id === 'other-id')!);
    expect(store.panes.find(pane => pane.id === right)?.tabs).toEqual(['other-id']);
    store.edit('Draft');
    backend.failWrites = true;
    await store.close('other-id');
    expect(store.panes).toHaveLength(2);
    backend.failWrites = false;
    await store.close('other-id');
    expect(store.panes).toHaveLength(1);
    expect(store.activeId).toBe('note-id');
  });
});
