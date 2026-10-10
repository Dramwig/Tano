import { parseSuggestionFile, suggestionDataPath } from '@tano/protocol';
import { refreshWorkspace } from './background-refresh';
import type { CommentMessage, DocumentSuggestion, FileSnapshot, SuggestionFile, WorkspaceAdapter } from '@tano/protocol';

export interface SuggestionState { file: SuggestionFile; base: FileSnapshot | null }

export async function loadSuggestions(adapter: WorkspaceAdapter, workspaceId: string, fileId: string): Promise<SuggestionState> {
  const workspace = await refreshWorkspace(adapter);
  if (workspace.id !== workspaceId) throw new Error('工作区已切换');
  const path = suggestionDataPath(fileId);
  if (!workspace.files.some(file => file.path === path))
    return { file: { version: 1, workspaceId, fileId, suggestions: [] }, base: null };
  const base = await adapter.read(path);
  return { file: parseSuggestionFile(base.content, workspaceId, fileId), base };
}

/** Independent IDs merge; competing review/edit of the same suggestion must fail. */
export function mergeSuggestions(original: SuggestionFile, local: SuggestionFile, remote: SuggestionFile): SuggestionFile {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const core = (item: DocumentSuggestion | undefined) => {
    if (!item) return item;
    const { replies: _replies, ...value } = item;
    return value;
  };
  const mergeReplies = (before: CommentMessage[], local: CommentMessage[], remote: CommentMessage[]) => {
    const old = new Map(before.map(message => [message.id, message]));
    const result = new Map(remote.map(message => [message.id, message]));
    const localIds = new Set(local.map(message => message.id));
    for (const message of local) {
      if (equal(old.get(message.id), message)) continue;
      if (!equal(old.get(message.id), result.get(message.id)) && !equal(message, result.get(message.id)))
        throw new Error('此回复已被其他编辑修改；本机回复仍保留，请重新载入后核对');
      result.set(message.id, message);
    }
    for (const message of before) if (!localIds.has(message.id)) {
      if (result.has(message.id) && !equal(message, result.get(message.id)))
        throw new Error('此回复已被其他编辑修改，无法删除；本机回复仍保留');
      result.delete(message.id);
    }
    return [...result.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  };
  const records = new Map(remote.suggestions.map(item => [item.id, item]));
  const old = new Map(original.suggestions.map(item => [item.id, item]));
  for (const item of local.suggestions) {
    const before = old.get(item.id), disk = records.get(item.id);
    if (equal(before, item)) continue;
    if (!equal(core(before), core(disk)) && !equal(core(item), core(disk)) && !equal(core(before), core(item)))
      throw new Error('此建议已被其他编辑修改或审阅；本机建议仍保留，请重新载入后核对');
    if (!disk && before) throw new Error('此建议已被外部移除；本机建议仍保留');
    const merged = equal(core(before), core(item)) && disk ? { ...disk } : { ...item };
    if (item.replies || disk?.replies || before?.replies)
      merged.replies = mergeReplies(before?.replies ?? [], item.replies ?? [], disk?.replies ?? []);
    if (merged.replies) {
      const ids = new Set([merged.id, ...merged.replies.map(message => message.id)]);
      merged.replies = merged.replies.map(message => {
        if (!message.replyTo || ids.has(message.replyTo)) return message;
        const { replyTo: _replyTo, ...reply } = message;
        return reply;
      });
    }
    records.set(item.id, merged);
  }
  return { ...remote, suggestions: [...records.values()] };
}

export async function saveSuggestions(adapter: WorkspaceAdapter, state: SuggestionState, records: DocumentSuggestion[]): Promise<SuggestionState> {
  const { workspaceId, fileId } = state.file;
  const original = state.base ? parseSuggestionFile(state.base.content, workspaceId, fileId)
    : { ...state.file, suggestions: [] };
  const local = parseSuggestionFile(JSON.stringify({ ...state.file, suggestions: records }), workspaceId, fileId);
  const path = suggestionDataPath(fileId);
  let current = state;
  for (let attempt = 0; attempt < 4; attempt++) {
    const workspace = await adapter.refresh();
    if (workspace.id !== workspaceId || workspace.readOnly) throw new Error('工作区已切换或只读');
    const target = workspace.files.find(file => file.id === fileId && file.kind === 'file');
    if (!target || target.readOnly) throw new Error('目标文档已移除或只读');
    const file = mergeSuggestions(original, local, current.file);
    const content = JSON.stringify(file, null, 2) + '\n';
    if (current.base) {
      const result = await adapter.write(path, content, current.base.hash);
      if (result.status === 'saved') return { file, base: result.snapshot };
      if (result.status === 'missing') throw new Error('建议文件已被外部移除；本机建议仍保留');
      current = { file: parseSuggestionFile(result.snapshot.content, workspaceId, fileId), base: result.snapshot };
    } else {
      try { await adapter.create(path, content); }
      catch (error) {
        const loaded = await loadSuggestions(adapter, workspaceId, fileId);
        if (!loaded.base) throw error;
        current = loaded;
        continue;
      }
      const saved = await adapter.read(path);
      if (saved.content !== content) {
        current = { file: parseSuggestionFile(saved.content, workspaceId, fileId), base: saved };
        continue;
      }
      return { file, base: saved };
    }
  }
  throw new Error('建议正在被其他程序修改；本机建议仍保留，请重试');
}
