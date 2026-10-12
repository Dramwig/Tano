import { parseDataTable } from '@tano/protocol';
import type { AssistantPreview, AssistantProposal, DataTable, FileSnapshot, WorkspaceAdapter } from '@tano/protocol';
import type { DataTableState } from '../data-table-controller';
import { mergeDataTable } from '../workspace-data-tables';

const serialize = (table: DataTable) => JSON.stringify(table, null, 2) + '\n';

/** Include unsaved cells and independent external changes without mutating either version. */
export function assistantTableContent(disk: FileSnapshot, state?: DataTableState) {
  const table = parseDataTable(disk.content, state?.table.id);
  if (!state) return disk.content;
  if (state.error || state.unavailable) throw new Error('请先处理数据表的冲突或缺失');
  if (JSON.stringify(state.draft) === JSON.stringify(state.table)) return disk.content;
  const merged = mergeDataTable(state.table, state.draft, table);
  if (!merged) throw new Error('数据表草稿与外部修改冲突，两个版本均已保留');
  return serialize(merged);
}

/** Called within the workspace queue shared with table autosave. */
export async function reviewAssistantTable(options: {
  adapter: WorkspaceAdapter; proposal: AssistantProposal; path: string; disk: FileSnapshot;
  state?: DataTableState; accepted?: AssistantPreview; writable: () => void; signal?: AbortSignal;
}) {
  const { adapter, proposal, path, disk, state, accepted, signal } = options;
  const base = parseDataTable(proposal.base);
  const proposed = parseDataTable(proposal.content, base.id);
  const previewAt = (snapshot: FileSnapshot) => {
    // An invalid external file must never be repaired by overwriting it implicitly.
    parseDataTable(snapshot.content, base.id);
    let current: string;
    try { current = assistantTableContent(snapshot, state); }
    catch {
      return { clean: false, preview: { path, diskHash: snapshot.hash,
        before: state ? serialize(state.draft) : snapshot.content, after: proposal.content } };
    }
    const merged = mergeDataTable(base, proposed, parseDataTable(current, base.id));
    return { clean: !!merged, preview: { path, diskHash: snapshot.hash, before: current,
      after: merged ? serialize(merged) : proposal.content } };
  };
  const reviewed = previewAt(disk);
  if (!reviewed.clean) return { status: 'conflict' as const, preview: reviewed.preview };
  if (!accepted) return { status: 'preview' as const, preview: reviewed.preview };
  if (JSON.stringify(reviewed.preview) !== JSON.stringify(accepted))
    return { status: 'stale' as const, preview: reviewed.preview };
  options.writable();
  signal?.throwIfAborted();
  const draftBefore = state ? parseDataTable(JSON.stringify(state.draft), base.id) : undefined;
  if (state) state.saving = true;
  try {
    const result = await adapter.write(path, reviewed.preview.after, disk.hash);
    if (result.status === 'missing') throw new Error('目标数据表已在保存前删除');
    if (result.status === 'conflict') {
      const latest = previewAt(result.snapshot);
      return { status: latest.clean ? 'stale' as const : 'conflict' as const, preview: latest.preview };
    }
    const saved = parseDataTable(result.snapshot.content, base.id);
    if (state) {
      const remaining = mergeDataTable(draftBefore!, state.draft, saved);
      state.table = saved;
      state.snapshot = result.snapshot;
      state.path = path;
      state.undo = []; state.redo = [];
      if (remaining) { state.draft = remaining; state.error = ''; }
      else {
        // Keep input that arrived during IO both in the session and in a portable recovery file.
        state.error = '助手保存期间有重叠修改，当前草稿已保留，请另存副本后重新载入';
        const copyPath = `.tano/conflicts/table-${base.id}-${crypto.randomUUID()}.tano.json`;
        try {
          await adapter.create(copyPath, serialize(state.draft));
          state.error += `；恢复文件：${copyPath}`;
        } catch (error) { state.error += `；恢复文件写入失败：${String(error)}`; }
      }
    }
    return { status: 'saved' as const, applied: { before: reviewed.preview.before,
      after: result.snapshot.content, hash: result.snapshot.hash, fileId: proposal.fileId! } };
  } finally { if (state) state.saving = false; }
}
