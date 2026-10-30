// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import { selectTreeEntry } from '../file-selection';
import FileTree from './FileTree.vue';

const entries: FileEntry[] = [
  { id: 'folder', path: '项目', name: '项目', kind: 'directory', size: 0, modified: 0 },
  { id: 'document', path: '项目/计划.md', name: '计划.md', kind: 'file', size: 1, modified: 0 },
];

it('opens folder homes separately from expansion, preserves folder actions, and reacts to external removal', async () => {
  const home: FileEntry = { id: 'home', path: '项目/README.md', name: 'README.md', kind: 'file', size: 1, modified: 0 };
  const files = ref([...entries, home]);
  const open = vi.fn(), context = vi.fn(), prefetch = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FileTree, { entries: files.value, selectedIds: new Set(['home']), documentIcons: { home: '🚀' }, onOpen: open, onContext: context, onPrefetch: prefetch }) });
  app.mount(root); await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  expect(root.querySelector('[title="项目/README.md"]')).toBeNull();
  expect(folder.classList.contains('selected')).toBe(true);
  expect(folder.outerHTML).toContain('data-emoji="🚀"');
  folder.click(); await nextTick();
  expect(open).toHaveBeenCalledWith(home);
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  open.mockClear();
  folder.querySelector<HTMLElement>('.tree-icon')!.click(); await nextTick();
  expect(open).not.toHaveBeenCalled();
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  folder.dispatchEvent(new Event('pointerenter'));
  expect(prefetch).toHaveBeenCalledWith(home);
  folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(context.mock.calls[0][0]).toEqual(entries[0]);
  folder.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(open).not.toHaveBeenCalled();
  files.value = entries; await nextTick();
  folder.click(); await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  expect(open).not.toHaveBeenCalled();
});

it.each([false, true])('reveals hidden home files and switches filename rules in virtual=%s trees', async virtual => {
  const home: FileEntry = { id: 'home', path: '项目/README.md', name: 'README.md', kind: 'file', size: 1, modified: 0 };
  const index: FileEntry = { ...home, id: 'index', path: '项目/_index.md', name: '_index.md' };
  const files = [...entries, home, index, ...(virtual ? Array.from({ length: 510 }, (_, i) => ({ ...home, id: `f${i}`, path: `file${i}.md`, name: `file${i}.md` })) : [])];
  const filename = ref<'README.md' | '_index.md' | ''>('README.md'), revealed = ref('');
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FileTree, { entries: files, folderHomeFileName: filename.value, revealedHomeId: revealed.value }) });
  app.mount(root); await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  if (virtual) { folder.querySelector<HTMLElement>('.tree-icon')!.click(); await nextTick(); }
  expect(root.querySelector('[title="项目/README.md"]')).toBeNull();
  expect(root.querySelector('[title="项目/_index.md"]')).not.toBeNull();
  folder.querySelector<HTMLElement>('.tree-icon')!.click(); await nextTick();
  revealed.value = 'home'; await nextTick(); await nextTick();
  expect(root.querySelector('[title="项目/README.md"]')).not.toBeNull();
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  filename.value = '_index.md'; revealed.value = ''; await nextTick();
  expect(root.querySelector('[title="项目/_index.md"]')).toBeNull();
  expect(root.querySelector('[title="项目/README.md"]')).not.toBeNull();
  filename.value = ''; await nextTick();
  expect(root.querySelector('[title="项目/_index.md"]')).not.toBeNull();
});

it('expands an ordinary collapsed folder when a newly created child enters rename mode', async () => {
  const renaming = ref('');
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FileTree, { entries, renamingId: renaming.value, renameEntry: async () => {} }) });
  app.mount(root); await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  folder.click(); await nextTick();
  expect(root.querySelector('[title="项目/计划.md"]')).toBeNull();
  renaming.value = 'document'; await nextTick(); await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  expect(root.querySelector('.tree-rename-input')).not.toBeNull();
});

it('keeps platform data out of the document tree', async () => {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, { entries: [...entries,
    { id: 'internal', path: '.tano', name: '.tano', kind: 'directory', size: 0, modified: 0 },
    { id: 'policy', path: '.tano/capabilities.json', name: 'capabilities.json', kind: 'file', size: 10, modified: 0 },
  ] });
  app.mount(root);
  await nextTick();
  expect(root.querySelector('[title="项目/计划.md"]')).not.toBeNull();
  expect(root.textContent).not.toContain('.tano');
  expect(root.textContent).not.toContain('capabilities.json');
});
let app: App | undefined;
let root: HTMLDivElement | undefined;
afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.useRealTimers();
});

it('shows and updates document icons in nested folders without replacing folder icons', async () => {
  const documentIcons = ref<Record<string, string>>({ document: '🚀' });
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FileTree, { entries, documentIcons: documentIcons.value }) });
  app.mount(root); await nextTick();
  const row = root.querySelector('[title="项目/计划.md"]')!;
  expect(row.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🚀');
  expect(root.querySelector('[title="项目"] [class*="lucide-folder-open"]')).not.toBeNull();
  documentIcons.value.document = 'icon:book'; await nextTick();
  expect(row.querySelector('[class*="lucide-book"]')).not.toBeNull();
  documentIcons.value.document = ''; await nextTick();
  expect(row.querySelector('[class*="lucide-file-text"]')).not.toBeNull();
  expect(row.querySelector('.workspace-emoji-icon, .workspace-default-icon')).toBeNull();
});

it('updates nested data table icons and restores the table fallback without reading them as Markdown', async () => {
  const table: FileEntry = { id: 'table', path: '项目/计划.table.json', name: '计划.table.json', kind: 'file', size: 1, modified: 0 };
  const documentIcons = ref<Record<string, string>>({ document: '' });
  const loadDocumentIcon = vi.fn(async () => '🌿');
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FileTree, { entries: [...entries, table], documentIcons: documentIcons.value, loadDocumentIcon }) });
  app.mount(root); await nextTick();
  const row = root.querySelector('[title="项目/计划.table.json"]')!;
  expect(row.querySelector('[class*="lucide-table"]')).not.toBeNull();
  documentIcons.value.table = '😄'; await nextTick();
  expect(row.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('😄');
  documentIcons.value.table = 'icon:book'; await nextTick();
  expect(row.querySelector('[class*="lucide-book"]')).not.toBeNull();
  documentIcons.value.table = 'data:image/png;base64,aGVsbG8='; await nextTick();
  expect(row.querySelector('img')?.getAttribute('src')).toBe(documentIcons.value.table);
  documentIcons.value.table = ''; await nextTick();
  expect(row.querySelector('[class*="lucide-table"]')).not.toBeNull();
  expect(row.querySelector('.workspace-emoji-icon, img')).toBeNull();
  expect(loadDocumentIcon).not.toHaveBeenCalled();
});

it('requests read ahead for nested documents on pointer entry and keyboard focus without opening them', async () => {
  root = document.createElement('div');
  document.body.append(root);
  const prefetch = vi.fn(), open = vi.fn();
  app = createApp(FileTree, { entries, onPrefetch: prefetch, onOpen: open });
  app.mount(root);
  await nextTick();
  const row = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  row.dispatchEvent(new Event('pointerenter'));
  row.focus();
  expect(prefetch).toHaveBeenCalledTimes(2);
  expect(prefetch).toHaveBeenCalledWith(entries[1]);
  expect(open).not.toHaveBeenCalled();
});

it('emits the exact folder or nested file on right click and keyboard context menu', async () => {
  const context = vi.fn();
  const open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, { entries, onContext: context, onOpen: open });
  app.mount(root);
  await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;

  const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  file.dispatchEvent(rightClick);
  expect(rightClick.defaultPrevented).toBe(true);
  expect(context).toHaveBeenCalledTimes(1);
  expect(context.mock.calls[0][0]).toEqual(entries[1]);
  expect(open).not.toHaveBeenCalled();

  const keyboard = new KeyboardEvent('keydown', {
    key: 'F10',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  folder.dispatchEvent(keyboard);
  expect(keyboard.defaultPrevented).toBe(true);
  expect(context.mock.calls[1][0]).toEqual(entries[0]);
  expect(folder.getAttribute('aria-expanded')).toBe('true');
});

it('emits the containing directory when a tree gap is right clicked', async () => {
  const contextBlank = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, { entries, onContextBlank: contextBlank });
  app.mount(root);
  await nextTick();

  const tree = root.querySelector<HTMLElement>('ul[role="tree"]')!;
  tree.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(contextBlank).toHaveBeenCalledWith('', expect.any(MouseEvent));

  const nestedTree = root.querySelector<HTMLElement>('ul[role="group"]')!;
  nestedTree.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(contextBlank).toHaveBeenLastCalledWith('项目', expect.any(MouseEvent));
});

it('opens a nested file menu on long press once and consumes the release click', async () => {
  vi.useFakeTimers();
  const context = vi.fn(), open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, { entries, onContext: context, onOpen: open });
  app.mount(root);
  await nextTick();
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  const press = () => file.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 60,
  }));
  press();
  vi.advanceTimersByTime(550);
  expect(context).toHaveBeenCalledWith(entries[1], expect.any(MouseEvent));
  expect(context.mock.calls[0][1]).toMatchObject({ clientX: 40, clientY: 60 });
  file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  file.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
  file.dispatchEvent(mouseDown);
  expect(mouseDown.defaultPrevented).toBe(true);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  file.dispatchEvent(click);
  expect(context).toHaveBeenCalledTimes(1);
  expect(click.defaultPrevented).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(root.querySelector('.tree-entry-menu')).toBeNull();
  // A later ordinary tap still opens the file.
  press();
  file.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  file.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(open).toHaveBeenCalledWith(entries[1]);
});

it.each(['move', 'scroll', 'release', 'cancel', 'unmount', 'mouse'])('does not open a long-press menu after %s', async reason => {
  vi.useFakeTimers();
  const context = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(FileTree, { entries, onContext: context });
  app.mount(root); await nextTick();
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  file.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerType: reason === 'mouse' ? 'mouse' : 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 60,
  }));
  if (reason === 'move') file.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 40, clientY: 80 }));
  if (reason === 'scroll') root.dispatchEvent(new Event('scroll'));
  if (reason === 'release') file.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  if (reason === 'cancel') file.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
  if (reason === 'unmount') { app.unmount(); app = undefined; }
  vi.advanceTimersByTime(600);
  expect(context).not.toHaveBeenCalled();
});

it('exposes draggable rows and forwards a nested file drop to its folder', async () => {
  const dragStart = vi.fn();
  const dragOver = vi.fn();
  const drop = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries,
    canDrag: () => true,
    onDragStart: dragStart,
    onDragOver: dragOver,
    onDrop: drop,
  });
  app.mount(root);
  await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  expect(file.draggable).toBe(true);
  file.dispatchEvent(new Event('dragstart', { bubbles: true }));
  folder.dispatchEvent(new Event('dragover', { bubbles: true }));
  folder.dispatchEvent(new Event('drop', { bubbles: true }));
  expect(dragStart.mock.calls[0][0]).toEqual(entries[1]);
  expect(dragOver.mock.calls[0][0]).toBe('项目');
  expect(drop.mock.calls[0][0]).toBe('项目');
});

it('lets a nested document move to the root through a root file or tree gap', async () => {
  const dragOver = vi.fn();
  const drop = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries: [
      ...entries,
      { id: 'root-document', path: '首页.md', name: '首页.md', kind: 'file', size: 1, modified: 0 },
    ],
    canDrag: () => true,
    onDragOver: (folder: string, event: Event) => {
      dragOver(folder);
      event.stopPropagation();
    },
    onDrop: (folder: string, event: Event) => {
      drop(folder);
      event.stopPropagation();
    },
  });
  app.mount(root);
  await nextTick();

  const rootFile = root.querySelector<HTMLButtonElement>('[title="首页.md"]')!;
  rootFile.dispatchEvent(new Event('dragover', { bubbles: true }));
  rootFile.dispatchEvent(new Event('drop', { bubbles: true }));
  expect(dragOver).toHaveBeenLastCalledWith('');
  expect(drop).toHaveBeenLastCalledWith('');
  expect(dragOver).toHaveBeenCalledTimes(1);
  expect(drop).toHaveBeenCalledTimes(1);

  const rootTree = root.querySelector<HTMLElement>('ul[role="tree"]')!;
  rootTree.dispatchEvent(new Event('dragover', { bubbles: true }));
  rootTree.dispatchEvent(new Event('drop', { bubbles: true }));
  expect(dragOver).toHaveBeenLastCalledWith('');
  expect(drop).toHaveBeenLastCalledWith('');
  expect(dragOver).toHaveBeenCalledTimes(2);
  expect(drop).toHaveBeenCalledTimes(2);

  const nestedFile = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  nestedFile.dispatchEvent(new Event('dragover', { bubbles: true }));
  nestedFile.dispatchEvent(new Event('drop', { bubbles: true }));
  expect(dragOver).toHaveBeenLastCalledWith('项目');
  expect(drop).toHaveBeenLastCalledWith('项目');
  expect(dragOver).toHaveBeenCalledTimes(3);
  expect(drop).toHaveBeenCalledTimes(3);
});

it('expands a collapsed folder after a valid drag hovers over it', async () => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries,
    draggedId: 'another-document',
    dropTarget: '项目',
    onDragOver: (_folder: string, event: Event) => event.stopPropagation(),
  });
  app.mount(root);
  await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  folder.click();
  await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('false');

  folder.dispatchEvent(new Event('dragover', { bubbles: true }));
  vi.advanceTimersByTime(300);
  folder.dispatchEvent(new Event('dragover', { bubbles: true }));
  vi.advanceTimersByTime(349);
  await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  vi.advanceTimersByTime(1);
  await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  expect(root.querySelector('[title="项目/计划.md"]')).not.toBeNull();
});

it('cancels hover expansion on leave or drop and can open a folder that cannot accept the file', async () => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries,
    draggedId: 'another-document',
    dropTarget: '项目',
    onDragOver: (_folder: string, event: Event) => event.stopPropagation(),
    onDrop: (_folder: string, event: Event) => event.stopPropagation(),
  });
  app.mount(root);
  await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  folder.click();
  await nextTick();

  folder.dispatchEvent(new Event('dragover', { bubbles: true }));
  folder.dispatchEvent(new Event('dragleave', { bubbles: true }));
  vi.advanceTimersByTime(700);
  await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('false');

  folder.dispatchEvent(new Event('dragover', { bubbles: true }));
  folder.dispatchEvent(new Event('drop', { bubbles: true }));
  vi.advanceTimersByTime(700);
  await nextTick();
  expect(folder.getAttribute('aria-expanded')).toBe('false');

  app.unmount();
  app = createApp(FileTree, {
    entries,
    draggedId: 'another-document',
    dropTarget: null,
    onDragOver: (_folder: string, event: Event) => event.stopPropagation(),
  });
  app.mount(root);
  await nextTick();
  const invalidFolder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  invalidFolder.click();
  await nextTick();
  invalidFolder.dispatchEvent(new Event('dragover', { bubbles: true }));
  vi.advanceTimersByTime(700);
  await nextTick();
  expect(invalidFolder.getAttribute('aria-expanded')).toBe('true');
});

it('sends modifier clicks to selection without opening files or collapsing folders', async () => {
  const select = vi.fn();
  const open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries,
    selectedIds: new Set(['folder', 'document']),
    onSelect: select,
    onOpen: open,
  });
  app.mount(root);
  await nextTick();
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;
  expect(folder.getAttribute('aria-selected')).toBe('true');
  expect(file.getAttribute('aria-selected')).toBe('true');

  folder.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  file.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(select).toHaveBeenCalledTimes(2);
  expect(select.mock.calls[1][0]).toEqual(entries[1]);
  expect(open).not.toHaveBeenCalled();
});

it('selects a document before opening it on a plain click', async () => {
  const select = vi.fn();
  const open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(FileTree, {
    entries,
    onSelect: select,
    onOpen: open,
  });
  app.mount(root);
  await nextTick();
  const file = root.querySelector<HTMLButtonElement>('[title="项目/计划.md"]')!;

  file.click();
  expect(select).toHaveBeenCalledWith(entries[1], expect.any(MouseEvent));
  expect(open).toHaveBeenCalledWith(entries[1]);
  expect(select.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
});

it('selects the entire range after a plain click followed by Shift click', async () => {
  const files: FileEntry[] = ['A', 'B', 'C'].map((name) => ({
    id: name,
    path: `${name}.md`,
    name: `${name}.md`,
    kind: 'file',
    size: 1,
    modified: 0,
  }));
  const selected = ref(new Set<string>());
  let anchor: string | null = null;
  const open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    setup() {
      return () =>
        h(FileTree, {
          entries: files,
          selectedIds: selected.value,
          onOpen: open,
          onSelect: (file: FileEntry, event: MouseEvent) => {
            const visibleIds = [
              ...root!.querySelectorAll<HTMLElement>('.tree-row[data-entry-id]'),
            ].map((row) => row.dataset.entryId!);
            const next = selectTreeEntry({ ids: selected.value, anchor }, file.id, visibleIds, event);
            selected.value = next.ids;
            anchor = next.anchor;
          },
        });
    },
  });
  app.mount(root);
  await nextTick();

  root.querySelector<HTMLButtonElement>('[data-entry-id="A"]')!.click();
  await nextTick();
  expect(selected.value).toEqual(new Set(['A']));
  expect(root.querySelector('[data-entry-id="A"]')?.classList.contains('multi-selected')).toBe(false);

  root.querySelector<HTMLButtonElement>('[data-entry-id="C"]')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, shiftKey: true }),
  );
  await nextTick();
  expect(selected.value).toEqual(new Set(['A', 'B', 'C']));
  expect(
    [...root.querySelectorAll<HTMLElement>('.tree-row[aria-selected="true"]')].map(
      (row) => row.dataset.entryId,
    ),
  ).toEqual(['A', 'B', 'C']);
  expect(root.querySelectorAll('.tree-row.multi-selected')).toHaveLength(3);
  expect(open).toHaveBeenCalledTimes(1);
});

async function mountRename(renameEntry: (file: FileEntry, name: string) => Promise<void>) {
  const renamingId = ref<string | undefined>('document');
  const open = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    setup: () => () => h(FileTree, {
      entries,
      renamingId: renamingId.value,
      renameEntry,
      canDrag: () => true,
      onOpen: open,
      onRenameFinished: () => { renamingId.value = undefined; },
    }),
  });
  app.mount(root);
  await nextTick();
  return { input: root.querySelector<HTMLInputElement>('.tree-rename-input')!, open };
}

it('edits a nested filename in place and cancels without opening or renaming it', async () => {
  const rename = vi.fn(async () => {});
  const { input, open } = await mountRename(rename);
  expect(document.activeElement).toBe(input);
  expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe('计划');
  expect(input.closest('button')).toBeNull();
  expect(input.closest('.tree-row')?.getAttribute('draggable')).toBe('false');
  input.click();
  input.value = '取消的名称.md';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(root!.querySelector('.tree-rename-input')).toBeNull();
  expect(document.activeElement?.getAttribute('data-entry-id')).toBe('document');
  expect(rename).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('waits for Chinese composition and submits only once across Enter and blur', async () => {
  let resolve!: () => void;
  const rename = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const { input } = await mountRename(rename);
  input.value = '新的计划.md';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(rename).not.toHaveBeenCalled();
  input.dispatchEvent(new Event('compositionend', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  await nextTick();
  expect(rename).toHaveBeenCalledExactlyOnceWith(entries[1], '新的计划.md');
  expect(input.readOnly).toBe(true);
  resolve();
  await vi.waitFor(() => expect(root!.querySelector('.tree-rename-input')).toBeNull());
  expect(document.activeElement?.getAttribute('data-entry-id')).toBe('document');
});

it('keeps a failed rename editable in place and retries on blur', async () => {
  const rename = vi.fn()
    .mockRejectedValueOnce(new Error('已经存在一个同名文件'))
    .mockResolvedValueOnce(undefined);
  const { input } = await mountRename(rename);
  input.value = '已有名称.md';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
  await vi.waitFor(() => expect(root!.querySelector('[role="alert"]')?.textContent).toBe('已经存在一个同名文件'));
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('已有名称.md');
  input.value = '可用名称.md';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
  await vi.waitFor(() => expect(root!.querySelector('.tree-rename-input')).toBeNull());
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenLastCalledWith(entries[1], '可用名称.md');
});
