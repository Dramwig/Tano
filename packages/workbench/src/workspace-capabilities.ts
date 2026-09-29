import { isShortId } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { capabilityPath, defaultCapabilities, parseCapabilities } from '@tano/editor/runtime';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';

export type CapabilityPatch =
  | { feature: keyof WorkspaceCapabilities['features']; enabled: boolean }
  | { markdownDialect: WorkspaceCapabilities['markdownDialect'] }
  | { mathSyntax: WorkspaceCapabilities['mathSyntax'] }
  | { pageWidth: { documentId: string; limited: boolean } };

export async function loadCapabilities(adapter: WorkspaceAdapter, workspace: Workspace) {
  if (!workspace.files.some((file) => file.kind === 'file' && file.path === capabilityPath))
    return { snapshot: null, capabilities: structuredClone(defaultCapabilities) };
  const snapshot = await adapter.read(capabilityPath);
  return { snapshot, capabilities: parseCapabilities(snapshot.content) };
}

/** Merge independent policy edits and reject conflicting edits without overwriting either. */
export async function saveCapabilityPatch(
  adapter: WorkspaceAdapter,
  base: FileSnapshot | null,
  patch: CapabilityPatch,
) {
  if ('pageWidth' in patch && !isShortId(patch.pageWidth.documentId))
    throw new Error('无效的文档 ID');
  const original = base ? parseCapabilities(base.content) : defaultCapabilities;
  const field = (policy: WorkspaceCapabilities) => {
    if ('feature' in patch) return policy.features[patch.feature];
    if ('pageWidth' in patch) return policy.pageWidthLimits[patch.pageWidth.documentId] ?? true;
    if ('mathSyntax' in patch) return policy.mathSyntax;
    return policy.markdownDialect;
  };
  const desired = 'feature' in patch ? patch.enabled
    : 'pageWidth' in patch ? patch.pageWidth.limited
    : 'mathSyntax' in patch ? patch.mathSyntax
    : patch.markdownDialect;
  let current = base;
  // Each retry has a fresh hash. A racing creator is handled by the same merge path.
  for (let attempt = 0; attempt < 3; attempt++) {
    const policy = current ? parseCapabilities(current.content) : defaultCapabilities;
    if (field(policy) !== field(original) && field(policy) !== desired)
      throw new Error('此项工作区规则已被外部修改；你的选择尚未写入。请检查最新规则后重试。');
    const raw = current ? JSON.parse(current.content) : {};
    const next = {
      ...raw,
      ...policy,
      features: { ...raw.features, ...policy.features },
      pageWidthLimits: { ...raw.pageWidthLimits, ...policy.pageWidthLimits },
    };
    if ('feature' in patch) next.features[patch.feature] = patch.enabled;
    else if ('pageWidth' in patch) {
      if (patch.pageWidth.limited) delete next.pageWidthLimits[patch.pageWidth.documentId];
      else next.pageWidthLimits[patch.pageWidth.documentId] = false;
    } else Object.assign(next, patch);
    const content = JSON.stringify(next, null, 2) + '\n';
    if (current) {
      const result = await adapter.write(capabilityPath, content, current.hash);
      if (result.status === 'saved')
        return { snapshot: result.snapshot, capabilities: parseCapabilities(content) };
      if (result.status === 'missing') throw new Error('工作区规则已被移除，请刷新后重试');
      current = result.snapshot;
    } else {
      try {
        await adapter.create(capabilityPath, content);
      } catch (error) {
        // Only recover a genuine concurrent creation, not an unrelated I/O failure.
        try {
          current = await adapter.read(capabilityPath);
        } catch {
          throw error;
        }
        continue;
      }
      const snapshot = await adapter.read(capabilityPath);
      return { snapshot, capabilities: parseCapabilities(snapshot.content) };
    }
  }
  throw new Error('工作区规则正在被其他程序修改，请稍后重试');
}
