import { isAgentPerson, objectDirectory, parseObject } from '@tano/protocol';
import type { AgentBinding, AssistantTransport, WorkspaceAdapter } from '@tano/protocol';
import { AgentTaskQueue } from './inbox';

/** Reserve the binding before creating its portable identity, allowing crash-safe repair. */
export async function ensureAgentIdentities(
  workspaceId: string,
  adapter: Pick<WorkspaceAdapter, 'refresh' | 'read' | 'write' | 'create' | 'reserveObjectId'>,
  transport: Pick<AssistantTransport, 'inbox' | 'connections' | 'models' | 'hostedInbox'>,
  signal?: AbortSignal,
) {
  const errors: string[] = [];
  if (!transport.inbox || !adapter.reserveObjectId) return errors;
  const queue = new AgentTaskQueue(transport.inbox);
  const connections = await transport.connections();
  for (const connection of connections) {
    if (connection.managed && transport.hostedInbox) continue;
    try {
      signal?.throwIfAborted();
      const inbox = await transport.inbox.load(workspaceId);
      let binding = inbox.bindings.find((item) => item.connectionId === connection.id);
      if (!binding) {
        let models: string[] = [];
        try { models = await transport.models(connection.id, signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)); }
        catch (reason) { errors.push(`${connection.name} · ${String(reason)}`); }
        signal?.throwIfAborted();
        const workspace = await adapter.refresh();
        if (workspace.id !== workspaceId || workspace.readOnly) return errors;
        const personId = await adapter.reserveObjectId(inbox.bindings.map((item) => item.personId));
        const candidate: AgentBinding = {
          personId,
          connectionId: connection.id,
          model: models[0] ?? '',
          enabled: true,
        };
        binding = await queue.update(workspaceId, (current) => {
          const existing = current.bindings.find((item) => item.connectionId === connection.id);
          if (existing) return { ...existing };
          current.bindings.push(candidate);
          return candidate;
        });
      }
      const workspace = await adapter.refresh();
      signal?.throwIfAborted();
      if (workspace.id !== workspaceId || workspace.readOnly) return errors;
      const path = `${objectDirectory}/${binding.personId}.tano.json`;
      if (workspace.files.some((file) => file.path === path)) {
        const object = parseObject((await adapter.read(path)).content);
        if (object.id !== binding.personId || !isAgentPerson(object))
          throw new Error('机器人身份与已有对象冲突');
        if (!binding.provisioned) await queue.update(workspaceId, current => {
          const saved = current.bindings.find(item => item.personId === binding!.personId);
          if (saved) saved.provisioned = true;
        });
        continue;
      }
      if (binding.provisioned) {
        await queue.update(workspaceId, current => {
          const saved = current.bindings.find(item => item.personId === binding!.personId);
          if (saved) saved.enabled = false;
        });
        errors.push(`${connection.name} · 机器人身份文件已移除，请从文件历史恢复后重新启用`);
        continue;
      }
      const object = {
        version: 1,
        id: binding.personId,
        type: 'person',
        name: connection.name,
        description: '',
        archived: false,
        properties: { memberKind: 'agent' },
      };
      try {
        await adapter.create(path, JSON.stringify(object, null, 2) + '\n');
      } catch (error) {
        const current = await adapter.refresh();
        if (!current.files.some((file) => file.path === path)) throw error;
        const saved = parseObject((await adapter.read(path)).content);
        if (saved.id !== binding.personId || !isAgentPerson(saved)) throw error;
      }
      await queue.update(workspaceId, current => {
        const saved = current.bindings.find(item => item.personId === binding!.personId);
        if (saved) saved.provisioned = true;
      });
    } catch (reason) {
      errors.push(`${connection.name} · ${String(reason)}`);
    }
  }
  await queue.update(workspaceId, (inbox) => {
    for (const binding of inbox.bindings)
      if (!connections.some((connection) => connection.id === binding.connectionId) ||
          transport.hostedInbox && connections.some(connection => connection.id === binding.connectionId && connection.managed))
        binding.enabled = false;
  });
  return errors;
}
