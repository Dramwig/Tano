import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createHash } from 'node:crypto';
import type { FileSnapshot, Workspace, WorkspaceAdapter, WriteResult } from '@tano/protocol';
import { parseSuggestionFile, suggestionDataPath } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { useSuggestionStore } from './suggestions';

class MemoryAdapter implements WorkspaceAdapter {
  readonly mode = 'demo' as const;
  files = new Map([['note.md', { id: 'a00001', content: 'One\nTwo\nThree\n' }]]);
  fail?: (path: string, content: string) => void | Promise<void>;
  markdownWrites = 0;
  readOnly = false;
  async open() { return this.refresh(); }
  async refresh(): Promise<Workspace> { return { id: 'test', path: 'test', name: 'test', readOnly: this.readOnly,
    files: [...this.files].map(([path, row]) => ({ id: row.id, path, name: path, kind: 'file', size: row.content.length, modified: 0 })) }; }
  async read(path: string): Promise<FileSnapshot> {
    const row = this.files.get(path);
    if (!row) throw new Error('missing');
    return { content: row.content, hash: createHash('sha256').update(row.content).digest('hex'), modified: 0 };
  }
  async write(path: string, content: string, expected: string): Promise<WriteResult> {
    await this.fail?.(path, content);
    if (!this.files.has(path)) return { status: 'missing' };
    const snapshot = await this.read(path);
    if (snapshot.hash !== expected) return { status: 'conflict', snapshot };
    this.files.get(path)!.content = content;
    if (path.endsWith('.md')) this.markdownWrites++;
    return { status: 'saved', snapshot: await this.read(path) };
  }
  async create(path: string, content: string) {
    await this.fail?.(path, content);
    if (this.files.has(path)) throw new Error('exists');
    this.files.set(path, { id: crypto.randomUUID(), content });
  }
  async createFolder() {}
  async rename(from: string, to: string) { this.files.set(to, this.files.get(from)!); this.files.delete(from); }
  async move(from: string, to: string) { await this.rename(from, to); }
  async remove(path: string) { this.files.delete(path); }
  async reveal() {}
  async watch() { return () => {}; }
}
let adapter: MemoryAdapter;
let workspace: ReturnType<typeof useWorkspaceStore>;
let suggestions: ReturnType<typeof useSuggestionStore>;
const fileId = 'a00001';
const author = { id: 'local', name: '本机用户' };
const original = 'One\nTwo\nThree\n';
const sidecar = suggestionDataPath(fileId);
async function boot() {
  setActivePinia(configureWorkbench(createPinia(), { adapter, native: false, mobile: false }));
  workspace = useWorkspaceStore();
  await workspace.initialize();
  await workspace.openFileInNewTab(workspace.workspace!.files.find(file => file.id === fileId)!);
  suggestions = useSuggestionStore();
  await suggestions.load(fileId);
}
beforeEach(async () => { adapter = new MemoryAdapter(); await boot(); });
afterEach(() => workspace.dispose());
async function edit(content: string) {
  if (!suggestions.get(fileId)!.mode) await suggestions.toggle(fileId);
  suggestions.edit(fileId, content, author);
  await suggestions.flush();
}
const savedRecords = () => parseSuggestionFile(adapter.files.get(sidecar)!.content, 'test', fileId).suggestions;

describe('suggestion persistence and acceptance', () => {
  it('persists replies through shared comment edits and deletions without modifying Markdown', async () => {
    await edit('First\nTwo\nThree\n');
    const id = suggestions.get(fileId)!.records[0]!.id;
    await suggestions.toggle(fileId);
    await suggestions.changeReply(fileId, id, { type: 'reply', threadId: id, id: 'reply-one', body: '请核对', author });
    await suggestions.load(fileId, true);
    expect(savedRecords()[0]!.replies?.[0]?.body).toBe('请核对');
    await expect(suggestions.changeReply(fileId, id, { type: 'edit', threadId: id, messageId: 'reply-one',
      authorId: 'other', expectedBody: '请核对', body: '覆盖' })).rejects.toThrow('自己');
    await suggestions.changeReply(fileId, id, { type: 'edit', threadId: id, messageId: 'reply-one',
      authorId: author.id, expectedBody: '请核对', body: '已核对' });
    expect(savedRecords()[0]!.replies?.[0]?.body).toBe('已核对');
    await suggestions.changeReply(fileId, id, { type: 'delete', threadId: id, messageId: 'reply-one',
      authorId: author.id, expectedBody: '已核对' });
    expect(savedRecords()[0]!.replies).toEqual([]);
    expect(adapter.files.get('note.md')!.content).toBe(original);
    expect(adapter.markdownWrites).toBe(0);
  });
  it('saves and restores suggestions without changing Markdown; accepts only one and rejects the other', async () => {
    await edit('First\nTwo\nThree\n');
    await edit('First\nTwo\nLast\n');
    expect(adapter.files.get('note.md')!.content).toBe(original);
    expect(workspace.active!.content).toBe(original);
    expect(savedRecords().filter(item => item.status === 'pending')).toHaveLength(2);
    workspace.dispose(); await boot();
    expect(suggestions.projection(fileId).content).toBe('First\nTwo\nLast\n');
    const [first, last] = suggestions.get(fileId)!.records;
    await suggestions.accept(fileId, first!.id);
    expect(suggestions.get(fileId)!.error).toBe('');
    expect(adapter.files.get('note.md')!.content).toBe('First\nTwo\nThree\n');
    expect(savedRecords()[0]!.status).toBe('accepted');
    await suggestions.reject(fileId, last!.id);
    expect(adapter.files.get('note.md')!.content).toBe('First\nTwo\nThree\n');
    expect(savedRecords()[1]!.status).toBe('rejected');
    expect(adapter.markdownWrites).toBe(1);
  });
  it('preserves external edits and requires an updated preview before accepting', async () => {
    await edit('One\nTwo\nLast\n');
    adapter.files.get('note.md')!.content = 'External\nTwo\nThree\n';
    const id = suggestions.get(fileId)!.records[0]!.id;
    await suggestions.accept(fileId, id);
    expect(adapter.markdownWrites).toBe(0);
    expect(suggestions.get(fileId)!.previews[id]!.after).toBe('External\nTwo\nLast\n');
    await suggestions.accept(fileId, id);
    expect(adapter.files.get('note.md')!.content).toBe('External\nTwo\nLast\n');
  });
  it('refuses overlapping external changes and retains both versions', async () => {
    await edit('One\nTwo\nLast\n');
    adapter.files.get('note.md')!.content = 'One\nTwo\nExternal\n';
    await suggestions.accept(fileId, suggestions.get(fileId)!.records[0]!.id);
    expect(suggestions.get(fileId)!.error).toContain('原文已变化');
    expect(adapter.markdownWrites).toBe(0);
    expect(savedRecords()[0]!.status).toBe('pending');
  });
  it('resolves document identity after a rename', async () => {
    await edit('First\nTwo\nThree\n');
    await adapter.rename('note.md', 'renamed.md');
    await workspace.refresh();
    await suggestions.accept(fileId, suggestions.get(fileId)!.records[0]!.id);
    expect(adapter.files.get('renamed.md')!.content).toBe('First\nTwo\nThree\n');
    expect(adapter.files.has('note.md')).toBe(false);
  });
  it('keeps input that arrives while a suggestion write is in flight', async () => {
    await edit('First\nTwo\nThree\n');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.fail = async path => { if (path === sidecar) { adapter.fail = undefined; entered(); await gate; } };
    suggestions.edit(fileId, 'First!\nTwo\nThree\n', author);
    await started;
    suggestions.edit(fileId, 'First!!\nTwo\nThree\n', author);
    release(); await suggestions.flush();
    expect(suggestions.projection(fileId).content).toBe('First!!\nTwo\nThree\n');
    workspace.dispose(); await boot();
    expect(suggestions.projection(fileId).content).toBe('First!!\nTwo\nThree\n');
  });
  it('recovers an interrupted receipt update without applying the edit twice', async () => {
    await edit('First\nTwo\nThree\n');
    const id = suggestions.get(fileId)!.records[0]!.id;
    adapter.fail = (path, content) => { if (path === sidecar && content.includes('"status": "accepted"')) throw new Error('receipt disk full'); };
    await suggestions.accept(fileId, id);
    expect(adapter.files.get('note.md')!.content).toBe('First\nTwo\nThree\n');
    expect(savedRecords()[0]!.status).toBe('applying');
    adapter.fail = undefined;
    workspace.dispose(); await boot();
    await suggestions.accept(fileId, id);
    expect(savedRecords()[0]!.status).toBe('accepted');
    expect(adapter.markdownWrites).toBe(1);
  });
  it('does not replay an uncertain write when the disk differs from the intended result', async () => {
    await edit('First\nTwo\nThree\n');
    const id = suggestions.get(fileId)!.records[0]!.id;
    adapter.fail = path => { if (path === 'note.md') throw new Error('write failed'); };
    await suggestions.accept(fileId, id);
    expect(savedRecords()[0]!.status).toBe('applying');
    adapter.fail = undefined;
    await suggestions.accept(fileId, id);
    expect(adapter.markdownWrites).toBe(0);
    expect(suggestions.get(fileId)!.error).toContain('待核对');
  });
  it('rejects stale review records after another reviewer has rejected the suggestion', async () => {
    await edit('First\nTwo\nThree\n');
    const file = JSON.parse(adapter.files.get(sidecar)!.content);
    file.suggestions[0].status = 'rejected'; file.suggestions[0].revision++;
    adapter.files.get(sidecar)!.content = JSON.stringify(file);
    await suggestions.accept(fileId, file.suggestions[0].id);
    expect(adapter.markdownWrites).toBe(0);
    expect(suggestions.get(fileId)!.records[0]!.status).toBe('rejected');
  });
  it('blocks leaving the workspace when suggestions cannot be saved', async () => {
    await suggestions.toggle(fileId);
    adapter.fail = path => { if (path === sidecar) throw new Error('disk full'); };
    suggestions.edit(fileId, 'First\nTwo\nThree\n', author);
    expect(await workspace.flush()).toBe(false);
    expect(workspace.pending).toBe(true);
    expect(suggestions.projection(fileId).content).toBe('First\nTwo\nThree\n');
    expect(adapter.files.get('note.md')!.content).toBe(original);
    await workspace.close(fileId);
    expect(workspace.documents.some(doc => doc.id === fileId)).toBe(true);
  });
  it('does not change Markdown when publishing an agent proposal twice', async () => {
    const proposal = { id: crypto.randomUUID(), runId: 'run', workspaceId: 'test', kind: 'edit' as const,
      fileId, path: 'note.md', base: original, content: 'First\nTwo\nLast\n', reason: '更新', status: 'ready' as const };
    await suggestions.publish(proposal);
    const count = savedRecords().length;
    await suggestions.publish(proposal);
    expect(savedRecords()).toHaveLength(count);
    expect(adapter.markdownWrites).toBe(0);
    expect(suggestions.projection(fileId).content).toBe(proposal.content);
    await expect(workspace.reviewAssistantProposal({ id: 'test', path: 'test' }, proposal)).rejects.toThrow('逐项审阅');
  });
  it('preserves typing started during a periodic reload', async () => {
    await suggestions.toggle(fileId);
    const reload = suggestions.load(fileId, true);
    suggestions.edit(fileId, 'First\nTwo\nThree\n', author);
    await reload; await suggestions.flush();
    expect(suggestions.projection(fileId).content).toBe('First\nTwo\nThree\n');
    expect(savedRecords().filter(item => item.status === 'pending')).toHaveLength(1);
  });
  it('merges independently added suggestions from a second client', async () => {
    await edit('First\nTwo\nThree\n');
    const state = await workspace.readDocumentSuggestions({ id: 'test', path: 'test' }, fileId);
    const external = { ...state.file.suggestions[0]!, id: crypto.randomUUID(), from: 8, to: 13, text: 'Last' };
    await workspace.writeDocumentSuggestions({ id: 'test', path: 'test' }, state, [...state.file.suggestions, external]);
    suggestions.edit(fileId, 'First!\nTwo\nThree\n', author);
    await suggestions.flush();
    expect(suggestions.projection(fileId).content).toBe('First!\nTwo\nLast\n');
    expect(savedRecords()).toHaveLength(2);
  });
  it('keeps a competing local edit when a second client rejects that same record', async () => {
    await edit('First\nTwo\nThree\n');
    const state = await workspace.readDocumentSuggestions({ id: 'test', path: 'test' }, fileId);
    await workspace.writeDocumentSuggestions({ id: 'test', path: 'test' }, state,
      state.file.suggestions.map(item => ({ ...item, status: 'rejected', revision: item.revision + 1 })));
    suggestions.edit(fileId, 'First!\nTwo\nThree\n', author);
    await expect(suggestions.flush()).rejects.toThrow('其他编辑');
    expect(savedRecords()[0]!.status).toBe('rejected');
    expect(suggestions.projection(fileId).content).toBe('First!\nTwo\nThree\n');
    expect(workspace.pending).toBe(true);
    await suggestions.preserveLocalCopy(fileId);
    expect(savedRecords()).toHaveLength(2);
    expect(savedRecords()[0]!.status).toBe('rejected');
    expect(savedRecords()[1]!.status).toBe('pending');
    expect(savedRecords()[1]!.id).not.toBe(savedRecords()[0]!.id);
    expect(workspace.pending).toBe(false);
  });
});
