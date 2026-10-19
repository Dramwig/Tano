// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, reactive } from 'vue';
import type { App } from 'vue';
import WorkspaceViewPage from './WorkspaceViewPage.vue';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
});

it('resolves stable view sources and emits navigation to the original file or object', async () => {
  const openFile = vi.fn();
  const openObject = vi.fn();
  fixture.store = reactive({
    workspace: {
      id: 'workspace',
      files: [{ id: 'a1b2c3', path: 'papers/note.md', name: 'note.md', kind: 'file', size: 4, modified: 1 }],
    },
    referenceTargets: [{ workspace: 'workspace', type: 'event', id: 'd4e5f6', name: 'Experiment', path: '.tano/objects/d4e5f6.tano.json' }],
    objects: [],
  });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(defineComponent(() => () => h(WorkspaceViewPage, {
    view: {
      version: 1,
      layer: 'view',
      workspaceId: 'workspace',
      id: 'research',
      name: 'Research',
      kind: 'graph',
      sources: [
        { layer: 'file', fileId: 'a1b2c3' },
        { layer: 'object', type: 'event', id: 'd4e5f6' },
      ],
    },
    onOpenFile: openFile,
    onOpenObject: openObject,
  })));
  app.mount(root);
  const buttons = root.querySelectorAll<HTMLButtonElement>('.workspace-view-source');
  expect(buttons).toHaveLength(2);
  buttons[0]!.click();
  buttons[1]!.click();
  expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1b2c3', path: 'papers/note.md' }));
  expect(openObject).toHaveBeenCalledWith({ type: 'event', id: 'd4e5f6' });
});
