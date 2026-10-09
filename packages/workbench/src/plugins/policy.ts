import { canonicalPluginJson, parsePluginPolicy, workspacePluginPath } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter, WorkspacePluginPolicy, WorkspacePluginRule } from '@tano/protocol';

export interface PluginPolicySnapshot { snapshot: FileSnapshot | null; policy: WorkspacePluginPolicy }
export function canManageWorkspacePlugins(adapter: WorkspaceAdapter, workspace: Workspace) {
  return !workspace.readOnly && (workspace.canManagePlugins ?? (adapter.mode !== 'web'));
}
export async function loadPluginPolicy(adapter: WorkspaceAdapter, workspace: Workspace): Promise<PluginPolicySnapshot> {
  if (!workspace.files.some(file => file.path === workspacePluginPath)) return { snapshot: null, policy: { version: 1, plugins: [] } };
  const snapshot = await adapter.read(workspacePluginPath);
  return { snapshot, policy: parsePluginPolicy(snapshot.content) };
}
const equal = (a: unknown, b: unknown) => canonicalPluginJson(a ?? null) === canonicalPluginJson(b ?? null);

/** Compare-and-write merges independent plugin/field edits; conflicting proposals are preserved. */
export async function savePluginRule(adapter: WorkspaceAdapter, base: PluginPolicySnapshot, id: string,
  desired: WorkspacePluginRule | null, assertCurrent: () => void): Promise<PluginPolicySnapshot> {
  const original = base.policy.plugins.find(row => row.manifest.id === id);
  let current = base;
  for (let attempt = 0; attempt < 4; attempt++) {
    assertCurrent();
    const latest = current.policy.plugins.find(row => row.manifest.id === id);
    let merged: WorkspacePluginRule | null = desired;
    let conflict = false;
    if (!original || !latest || !desired) conflict = !equal(original, latest) && !equal(latest, desired);
    else {
      merged = structuredClone(latest);
      for (const field of ['manifest', 'mode', 'integrity', 'sourceUrl', 'settings', 'history'] as const) {
        if (equal(original[field], desired[field])) continue;
        if (!equal(original[field], latest[field]) && !equal(desired[field], latest[field])) { conflict = true; break; }
        Object.assign(merged, { [field]: desired[field] });
      }
    }
    if (conflict) {
      const path = `.tano/conflicts/plugins-${crypto.randomUUID()}.json`;
      const proposed = { ...base.policy, plugins: [...base.policy.plugins.filter(row => row.manifest.id !== id), ...(desired ? [desired] : [])] };
      assertCurrent();
      await adapter.create(path, JSON.stringify(proposed, null, 2) + '\n');
      throw new Error(`插件规则已被其他人修改；你的版本已保存在 ${path}，请刷新后比较。`);
    }
    const policy = parsePluginPolicy(JSON.stringify({ version: 1, plugins: [...current.policy.plugins.filter(row => row.manifest.id !== id), ...(merged ? [merged] : [])] }));
    const content = JSON.stringify(policy, null, 2) + '\n';
    assertCurrent();
    if (current.snapshot) {
      const result = await adapter.write(workspacePluginPath, content, current.snapshot.hash);
      if (result.status === 'saved') return { policy, snapshot: result.snapshot };
      if (result.status === 'missing') throw new Error('工作区插件规则已被移除，请刷新后重试');
      current = { snapshot: result.snapshot, policy: parsePluginPolicy(result.snapshot.content) };
    } else {
      try { await adapter.create(workspacePluginPath, content); }
      catch (error) {
        assertCurrent();
        let snapshot: FileSnapshot;
        try { snapshot = await adapter.read(workspacePluginPath); } catch { throw error; }
        current = { snapshot, policy: parsePluginPolicy(snapshot.content) };
        continue;
      }
      const snapshot = await adapter.read(workspacePluginPath);
      return { snapshot, policy: parsePluginPolicy(snapshot.content) };
    }
  }
  throw new Error('插件规则正在持续变化，请刷新后重试');
}
