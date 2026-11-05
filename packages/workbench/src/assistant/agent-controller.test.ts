// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { createHash } from 'node:crypto';
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

async function pollingFixture(files: Record<string, string>, withBinding = true, desktopSnapshots = false) {
  // Keep real content hashes without putting work on a native crypto thread
  // whose completion is independent of the fake polling clock.
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (_algorithm, data) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
  });
  const adapter = new DemoAdapter({ files: { 'README.md': 'home', ...files } });
  let inbox = emptyAgentInbox('pending');
  const transport: AssistantTransport = {
    connections: async () => [], models: async () => [],
    saveConnection: vi.fn(), removeConnection: vi.fn(), request: vi.fn(), loadSessions: async () => [],
    saveSession: vi.fn(), deleteSession: vi.fn(),
    inbox: { load: async () => structuredClone(inbox), compareExchange: async (next, revision) => {
      if (revision !== inbox.revision) return false; inbox = structuredClone(next); return true;
    } },
  };
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false, assistant: transport });
  setActivePinia(pinia); workspace = useWorkspaceStore(); await workspace.openWorkspace();
  if (desktopSnapshots) Object.defineProperty(adapter, 'mode', { value: 'desktop' });
  inbox = emptyAgentInbox(workspace.workspace!.id);
  if (withBinding) inbox.bindings.push({ personId: 'a00001', connectionId: 'connection', model: 'model', enabled: false });
  vi.useFakeTimers(); scope = effectScope();
  const controller = scope.run(useAgentInboxController)!;
  return { adapter, controller, inbox: () => inbox,
    read: vi.spyOn(adapter, 'read'), refresh: vi.spyOn(adapter, 'refresh') };
}

const mention = '[@robot](object://person/a00001 "tano:mention:mention-0001")';

it('does no workspace scan or document reads when no robot is connected', async () => {
  const f = await pollingFixture(Object.fromEntries(Array.from({ length: 471 }, (_, index) => [`notes/${index}.md`, 'text'])), false);
  await vi.advanceTimersByTimeAsync(34_000);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.refresh).not.toHaveBeenCalled();
  await f.controller.settle();
});

it('shares desktop watcher snapshots instead of starting a competing full scan each tick', async () => {
  const f = await pollingFixture({ 'note.md': `${mention} request` }, true, true);
  await vi.advanceTimersByTimeAsync(2000);
  f.refresh.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.refresh).not.toHaveBeenCalled();
  expect(f.inbox().tasks).toHaveLength(1);
  await f.adapter.write('note.md', 'removed', (await f.adapter.read('note.md')).hash);
  await workspace!.refresh(); // The existing filesystem lifecycle publishes this snapshot.
  f.refresh.mockClear();
  await vi.advanceTimersByTimeAsync(4000);
  expect(f.refresh).not.toHaveBeenCalled();
  expect(f.inbox().tasks[0].status).toBe('cancelled');
  await f.controller.settle();
});

it('reads stable documents once and reconciles same-size edits, removed mentions and deletion', async () => {
  const f = await pollingFixture({ 'note.md': `${mention} first`, 'other.md': 'other' });
  await vi.advanceTimersByTimeAsync(10_000);
  const reads = (path: string) => f.read.mock.calls.filter(([value]) => value === path).length;
  expect(reads('note.md')).toBe(1);
  expect(reads('other.md')).toBe(1);
  expect(f.inbox().tasks).toHaveLength(1);
  const before = await f.adapter.read('note.md');
  await f.adapter.write('note.md', `${mention} other`, before.hash);
  f.read.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  expect(reads('note.md')).toBe(0); // Wait for a committed revision to settle.
  await vi.advanceTimersByTimeAsync(4000);
  expect(reads('note.md')).toBe(1);
  expect(reads('other.md')).toBe(0);
  expect(f.inbox().tasks[0].event.body).toContain('other');
  await f.adapter.write('note.md', 'removed', (await f.adapter.read('note.md')).hash);
  await vi.advanceTimersByTimeAsync(4000);
  await vi.waitFor(() => expect(f.inbox().tasks[0].status).toBe('cancelled'), { timeout: 6000 });
  await f.adapter.remove('other.md');
  await vi.advanceTimersByTimeAsync(2000);
  await f.controller.settle();
});

it('revisits an unchanged document when a new robot binding is added', async () => {
  const f = await pollingFixture({ 'note.md': '[@second](object://person/a00002 "tano:mention:mention-0002") request' });
  await vi.advanceTimersByTimeAsync(4000);
  await vi.waitFor(() => expect(f.read.mock.calls.some(([path]) => path === 'note.md')).toBe(true), { timeout: 6000 });
  expect(f.inbox().tasks).toHaveLength(0);
  f.inbox().bindings.push({ personId: 'a00002', connectionId: 'second', model: 'model', enabled: false });
  f.read.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(f.inbox().tasks).toHaveLength(1), { timeout: 6000 });
  expect(f.read.mock.calls.filter(([path]) => path === 'note.md')).toHaveLength(1);
  await f.controller.settle();
});

it('cancels queued work when its unchanged source is deleted', async () => {
  const f = await pollingFixture({ 'note.md': `${mention} request` });
  await vi.advanceTimersByTimeAsync(4000);
  expect(f.inbox().tasks[0].status).toBe('queued');
  await f.adapter.remove('note.md');
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.inbox().tasks[0].status).toBe('cancelled');
  await f.controller.settle();
});

it('falls back to reading adapters without a content hash and still notices edits', async () => {
  const f = await pollingFixture({ 'note.md': `${mention} request` });
  f.refresh.mockImplementation(async () => {
    const snapshot = await DemoAdapter.prototype.refresh.call(f.adapter);
    for (const file of snapshot.files) delete file.contentHash;
    return snapshot;
  });
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.inbox().tasks).toHaveLength(1);
  await f.adapter.write('note.md', 'removed', (await f.adapter.read('note.md')).hash);
  await vi.advanceTimersByTimeAsync(4000);
  expect(f.inbox().tasks[0].status).toBe('cancelled');
  await f.controller.settle();
});

it('stops scheduling document reads as soon as workspace switching begins', async () => {
  const f = await pollingFixture({ 'a.md': 'first', 'b.md': 'second' });
  await vi.advanceTimersByTimeAsync(2000);
  const read = DemoAdapter.prototype.read;
  let finish!: () => void;
  let blocked = false;
  f.read.mockImplementation(async path => {
    if (path === 'a.md' && !blocked) {
      blocked = true;
      await new Promise<void>(resolve => { finish = resolve; });
    }
    return read.call(f.adapter, path);
  });
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'), { timeout: 6000 });
  workspace!.openingWorkspace = true;
  const settling = f.controller.settle();
  finish(); await settling;
  expect(f.read.mock.calls.some(([path]) => path === 'b.md')).toBe(false);
  workspace!.openingWorkspace = false; await nextTick();
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(f.read.mock.calls.some(([path]) => path === 'b.md')).toBe(true), { timeout: 6000 });
  await f.controller.settle();
});
