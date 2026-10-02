// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
const fixture = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
import ReferenceConnections from './ReferenceConnections.vue';
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.useRealTimers(); });

it('does not requery when a loading-state render recreates an equivalent identity prop', async () => {
  vi.useFakeTimers();
  const store = reactive({ busy: false, referenceRevision: 'revision', workspace: { id: 'ws', path: 'demo' }, referenceTargets: [{ type: 'event', id: 'b00001' }],
    getReferenceContext: vi.fn(async () => {
      store.busy = true; await nextTick(); store.busy = false;
      return { outgoing: [{ source: { workspace: 'ws', type: 'event', id: 'b00001', name: 'Todo', path: '.tano/objects/b00001.tano.json' }, target: { type: 'document', id: 'a00001' }, name: 'Context', excerpt: 'Task context', missing: false, archived: false }], incoming: [], errors: [] };
    }),
  });
  fixture.store = store;
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h('main', { 'aria-busy': store.busy }, [h(ReferenceConnections, { identity: { type: 'event', id: 'b00001' } })]));
  app.mount(root);
  await vi.advanceTimersByTimeAsync(500);
  expect(root.textContent).toContain('Context');
  expect(store.getReferenceContext).toHaveBeenCalledTimes(1);
  expect(root.querySelector('.reference-connections')?.getAttribute('aria-busy')).toBe('false');
});

it('keeps a personal task query isolated from workspace documents with matching IDs', async () => {
  vi.useFakeTimers();
  const query = vi.fn();
  fixture.store = reactive({ workspace: { id: 'ws', path: 'workspace' }, referenceRevision: '', getReferenceContext: query });
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(ReferenceConnections, { identity: { type: 'event', id: 'b00001' }, localTargets: [
    { workspace: 'personal', type: 'event', id: 'b00001', name: 'Private task', path: '.tano/objects/b00001.tano.json', description: '[Foreign document](object://document/a00001)' },
  ] }));
  app.mount(root);
  await vi.advanceTimersByTimeAsync(200);
  expect(root.textContent).toContain('已失效');
  expect(root.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  expect(query).not.toHaveBeenCalled();
});
