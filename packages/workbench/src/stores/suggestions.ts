import { computed, reactive } from 'vue';
import { defineStore } from 'pinia';
import type { AssistantPreview, AssistantProposal, DocumentSuggestion } from '@tano/protocol';
import { suggestionReviewThread } from '@tano/protocol';
import { applyCommentChange } from '../workspace-comments';
import type { CommentChange } from '../workspace-comments';
import { useWorkspaceStore } from './workspace';
import { projectSuggestions, proposalSuggestions, suggestEdit } from '../document-suggestions';
import { mergeSuggestions } from '../workspace-suggestions';
import type { SuggestionState } from '../workspace-suggestions';

interface Session {
  scope: { id: string; path: string; epoch: number };
  fileId: string;
  state?: SuggestionState;
  records: DocumentSuggestion[];
  mode: boolean;
  loading: boolean;
  saving: boolean;
  reviewing: boolean;
  error: string;
  previews: Record<string, AssistantPreview>;
  viewVersion: number;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const useSuggestionStore = defineStore('document-suggestions', () => {
  const workspace = useWorkspaceStore();
  const sessions = reactive(new Map<string, Session>());
  const writes = new Map<Session, Promise<void>>();
  const key = (fileId: string) => `${workspace.assistantEpoch}:${workspace.workspace?.id}:${fileId}`;
  function get(fileId: string) { return sessions.get(key(fileId)); }
  function dirty(session: Session) {
    return !!session.state && JSON.stringify(session.records) !== JSON.stringify(session.state.file.suggestions);
  }
  const pending = computed(() => [...sessions.values()].some(session => dirty(session) || session.saving || session.reviewing));
  async function load(fileId: string, refresh = false) {
    let session = get(fileId);
    if (session && (!refresh || session.loading || dirty(session) || session.saving || session.reviewing)) return session;
    if (!workspace.workspace) throw new Error('请先打开工作区');
    if (!session) {
      session = reactive({ scope: { id: workspace.workspace.id, path: workspace.workspace.path, epoch: workspace.assistantEpoch },
        fileId, records: [], mode: false, loading: true, saving: false, reviewing: false, error: '', previews: {}, viewVersion: 0 });
      sessions.set(key(fileId), session);
    }
    session.loading = !session.state;
    try {
      const loaded = await workspace.readDocumentSuggestions(session.scope, fileId);
      if (dirty(session) || session.saving || session.reviewing) return session;
      session.state = loaded;
      session.records = copy(session.state.file.suggestions);
      session.error = '';
    } catch (error) { session.error = String(error); session.viewVersion++; }
    finally { session.loading = false; }
    return session;
  }
  function persist(session: Session): Promise<void> {
    const existing = writes.get(session);
    if (existing) return existing;
    const promise = (async () => {
      session.saving = true;
      try {
        while (dirty(session)) {
          const records = copy(session.records), previous = { ...session.state!.file, suggestions: records };
          const saved = await workspace.writeDocumentSuggestions(session.scope, copy(session.state!), records);
          // Input that arrived during the write remains local and is saved in the next iteration.
          session.records = mergeSuggestions(previous, { ...previous, suggestions: copy(session.records) }, saved.file).suggestions;
          session.state = saved;
        }
        session.error = '';
      } catch (error) { session.error = String(error); throw error; }
      finally { session.saving = false; }
    })();
    writes.set(session, promise);
    void promise.finally(() => { if (writes.get(session) === promise) writes.delete(session); }).catch(() => {});
    return promise;
  }
  function edit(fileId: string, content: string, author: { id: string; name: string }) {
    const session = get(fileId), doc = workspace.documents.find(doc => doc.id === fileId);
    if (!session?.mode) { workspace.editDocument(fileId, content); return; }
    if (!session.state || session.loading || session.reviewing || !doc || doc.conflict || doc.missing || workspace.workspace?.readOnly ||
        workspace.workspace?.files.find(file => file.id === fileId)?.readOnly) return;
    try {
      session.records = suggestEdit(doc.content, session.records, content, author);
      session.previews = {};
      void persist(session).catch(() => {});
    } catch (error) { session.error = String(error); session.viewVersion++; }
  }
  function projection(fileId: string) {
    const session = get(fileId), doc = workspace.documents.find(doc => doc.id === fileId);
    return projectSuggestions(doc?.content ?? '', session?.records ?? []);
  }
  async function toggle(fileId: string) {
    const session = await load(fileId);
    if (!session.state || session.reviewing) return;
    await persist(session);
    session.mode = !session.mode;
    session.viewVersion++;
  }
  async function changeReply(fileId: string, id: string, change: Extract<CommentChange, { type: 'reply' | 'edit' | 'delete' }>) {
    const session = await load(fileId);
    if (!session.state || session.loading || session.reviewing || workspace.workspace?.readOnly ||
        workspace.workspace?.files.find(file => file.id === fileId)?.readOnly) throw new Error('当前无法修改建议回复');
    const item = session.records.find(item => item.id === id);
    if (!item || !['pending', 'applying'].includes(item.status)) throw new Error('建议已被审阅或移除');
    if (change.type !== 'reply' && change.messageId === item.id) throw new Error('请通过建议操作审阅此修改');
    const changed = applyCommentChange({ version: 1, kind: 'discussion', fileId,
      threads: [suggestionReviewThread(copy(item))] }, { ...change, threadId: id });
    session.records = session.records.map(record => record.id === id
      ? { ...record, replies: changed.threads[0]!.messages.slice(1) } : record);
    await persist(session);
  }
  async function reject(fileId: string, id: string) {
    const session = get(fileId);
    if (!session || session.reviewing) return;
    await persist(session);
    session.records = session.records.map(item => item.id === id && item.status === 'pending'
      ? { ...item, status: 'rejected', revision: item.revision + 1, updatedAt: Date.now() } : item);
    delete session.previews[id];
    await persist(session);
    session.viewVersion++;
  }
  async function accept(fileId: string, id: string) {
    const session = get(fileId);
    if (!session?.state || session.reviewing) return;
    session.reviewing = true;
    try {
      await persist(session);
      const visibleBefore = workspace.documents.find(doc => doc.id === fileId)?.content;
      const previousPreview = session.previews[id];
      let result = await workspace.acceptDocumentSuggestion(session.scope, copy(session.state), id, previousPreview);
      if (!previousPreview && result.status === 'preview' && result.preview?.before === visibleBefore)
        result = await workspace.acceptDocumentSuggestion(session.scope, result.state, id, result.preview);
      session.state = result.state;
      session.records = copy(result.state.file.suggestions);
      if (result.status === 'preview') session.previews[id] = result.preview!;
      else { delete session.previews[id]; session.viewVersion++; }
      session.error = '';
    } catch (error) {
      session.error = String(error);
      // Reload durable intent after an uncertain commit; never offer a blind retry.
      if (!dirty(session)) {
        try {
          session.state = await workspace.readDocumentSuggestions(session.scope, fileId);
          session.records = copy(session.state.file.suggestions);
        } catch { /* Keep last verified state and error. */ }
      }
    } finally { session.reviewing = false; }
  }
  async function publish(proposal: AssistantProposal) {
    if (proposal.kind !== 'edit' || !proposal.fileId || proposal.workspaceId !== workspace.workspace?.id)
      throw new Error('只有当前工作区的文档修改可以转为逐项建议');
    const session = await load(proposal.fileId);
    if (!session.state) throw new Error(session.error);
    await persist(session);
    const records = proposalSuggestions(proposal.base, proposal.content, { id: 'agent', name: '助手' }, proposal.id, proposal.reason);
    const ids = new Set(session.records.map(item => item.id));
    session.records.push(...records.filter(item => !ids.has(item.id)));
    await persist(session);
    session.mode = true;
    const file = workspace.workspace?.files.find(file => file.id === proposal.fileId);
    if (file) await workspace.openFileInNewTab(file);
  }
  async function flush() {
    for (const session of sessions.values()) if (dirty(session) || session.saving) await persist(session);
  }
  async function preserveLocalCopy(fileId: string) {
    const session = get(fileId);
    if (!session?.state || session.saving || session.reviewing) return;
    const original = session.state.file.suggestions;
    const changes = copy(session.records.filter(item => JSON.stringify(item) !== JSON.stringify(original.find(row => row.id === item.id))));
    if (!changes.length) return load(fileId, true);
    session.reviewing = true;
    try {
      const latest = await workspace.readDocumentSuggestions(session.scope, fileId);
      const copies = changes.map(item => ({ ...item, id: crypto.randomUUID(), revision: 1, updatedAt: Date.now(),
        reason: `${item.reason ? item.reason.slice(0, 3900) + '；' : ''}并发修改后保留的本机副本` }));
      const saved = await workspace.writeDocumentSuggestions(session.scope, latest, [...latest.file.suggestions, ...copies]);
      session.state = saved;
      session.records = copy(saved.file.suggestions);
      session.error = '';
      session.viewVersion++;
    } finally { session.reviewing = false; }
  }
  workspace.setSuggestionPersistence({ flush, pending: () => pending.value });
  return { get, load, edit, projection, toggle, reject, accept, changeReply, publish, persist, preserveLocalCopy, pending, flush };
});
