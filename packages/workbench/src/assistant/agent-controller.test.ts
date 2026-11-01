// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { emptyAgentInbox } from '@tano/protocol';
import type { AssistantTransport } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { useAgentInboxController } from './agent-controller';

let pinia: ReturnType<typeof createPinia> | undefined;
let scope: ReturnType<typeof effectScope> | undefined;
let workspace: ReturnType<typeof useWorkspaceStore> | undefined;
afterEach(() => { scope?.stop(); workspace?.dispose(); if (pinia) disposePinia(pinia); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

it('drains an identity scan before workspace handoff and resumes if the handoff is cancelled', async () => {
  const adapter = new DemoAdapter({ files: { 'note.md': '文档' } });
  let inbox = emptyAgentInbox('pending');
  const models = vi.fn<AssistantTransport['models']>((_id, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const transport: AssistantTransport = {
    connections: async () => [{ id: 'connection', name: 'AI', endpoint: '', tools: true, hasKey: false, maxOutputTokens: 2048 }], models,
    saveConnection: vi.fn(), removeConnection: vi.fn(), request: vi.fn(), loadSessions: async () => [], saveSession: vi.fn(), deleteSession: vi.fn(),
    inbox: { load: async () => structuredClone(inbox), compareExchange: async (next, revision) => {
      if (revision !== inbox.revision) return false; inbox = structuredClone(next); return true;
    } },
  };
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false, assistant: transport });
  setActivePinia(pinia); workspace = useWorkspaceStore(); await workspace.openWorkspace();
  inbox = emptyAgentInbox(workspace.workspace!.id);
  vi.useFakeTimers(); scope = effectScope();
  const controller = scope.run(useAgentInboxController)!;
  await vi.advanceTimersByTimeAsync(2000);
  expect(models).toHaveBeenCalledOnce();
  workspace.openingWorkspace = true;
  await controller.settle();
  await vi.advanceTimersByTimeAsync(4000);
  expect(inbox.bindings).toHaveLength(0);
  expect(models).toHaveBeenCalledOnce();
  models.mockResolvedValue(['model']);
  workspace.openingWorkspace = false; await nextTick();
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(inbox.bindings).toHaveLength(1));
  await controller.settle();
  expect(inbox.bindings[0].provisioned).toBe(true);
});
