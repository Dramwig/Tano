// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyAgentInbox, parseAgentInbox } from '@tano/protocol';
import type { AssistantTransport } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { ensureAgentIdentities } from './agent-identities';

afterEach(() => localStorage.clear());
it('shares a reserved identity across concurrent scans and isolates unavailable connections', async () => {
  const adapter = new DemoAdapter();
  const workspace = await adapter.open();
  let inbox = emptyAgentInbox(workspace.id);
  const transport: AssistantTransport = {
    connections: async () => ['broken', 'working'].map(id => ({ id, name: id, endpoint: '', tools: true, hasKey: false, maxOutputTokens: 2048 })),
    models: async id => { if (id === 'broken') throw new Error('offline'); return ['model']; },
    saveConnection: vi.fn(), removeConnection: vi.fn(), request: vi.fn(), loadSessions: async () => [], saveSession: vi.fn(), deleteSession: vi.fn(),
    inbox: {
      load: async () => structuredClone(inbox),
      compareExchange: async (next, revision) => {
        if (inbox.revision !== revision) return false;
        inbox = parseAgentInbox(structuredClone(next), workspace.id); return true;
      },
    },
  };
  const results = await Promise.all([
    ensureAgentIdentities(workspace.id, adapter, transport),
    ensureAgentIdentities(workspace.id, adapter, transport),
  ]);
  expect(results.every(errors => errors.length === 1 && errors[0].includes('offline'))).toBe(true);
  expect(inbox.bindings).toHaveLength(2);
  expect(inbox.bindings.find(binding => binding.connectionId === 'broken')?.model).toBe('');
  const path = `.tano/objects/${inbox.bindings.find(binding => binding.connectionId === 'working')!.personId}.tano.json`;
  expect(JSON.parse((await adapter.read(path)).content)).toMatchObject({ type: 'person', name: 'working', properties: { memberKind: 'agent' } });
  await ensureAgentIdentities(workspace.id, adapter, transport);
  expect(inbox.bindings).toHaveLength(2);
  await adapter.remove(path);
  const errors = await ensureAgentIdentities(workspace.id, adapter, transport);
  expect(errors.some(error => error.includes('身份文件已移除'))).toBe(true);
  expect((await adapter.refresh()).files.some(file => file.path === path)).toBe(false);
  expect(inbox.bindings.find(binding => binding.connectionId === 'working')?.enabled).toBe(false);
});
