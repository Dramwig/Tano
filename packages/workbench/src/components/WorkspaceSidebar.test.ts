// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import FileTree from './FileTree.vue';

let app: App | undefined;
let root: HTMLElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountSidebar(compact = false) {
  const open = ref(true);
  const isCompact = ref(compact);
  const entries = ref<FileEntry[]>([
    { id: 'folder', path: '项目', name: '项目', kind: 'directory', size: 0, modified: 0 },
    { id: 'file', path: '项目/计划.md', name: '计划.md', kind: 'file', size: 0, modified: 0 },
  ]);
  const content = document.createElement('main');
  const rect = vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ left: 230 } as DOMRect);
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }[] = [];
  const animate = vi.fn<typeof content.animate>(() => {
    const animation = { cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  content.animate = animate;
  root = document.createElement('div');
  document.body.append(root);
  root.append(content);
  app = createApp(() => h(WorkspaceSidebar, {
    open: open.value, compact: isCompact.value, contentElement: content,
  }, () => h('div', { class: 'sidebar-content' }, [h(FileTree, { entries: entries.value })])));
  app.mount(root);
  await nextTick();
  return { open, isCompact, entries, rect, animate, animations };
}

it('retains the tree, collapsed folders and scroll position and accepts updates while hidden', async () => {
  const { open, entries } = await mountSidebar();
  const aside = root.querySelector<HTMLElement>('aside')!;
  const tree = root.querySelector('[role="tree"]');
  const folder = root.querySelector<HTMLButtonElement>('[title="项目"]')!;
  folder.click();
  await nextTick();
  const scroll = root.querySelector<HTMLElement>('.sidebar-content')!;
  scroll.scrollTop = 180;
  open.value = false;
  await nextTick();
  expect(aside.hasAttribute('inert')).toBe(true);
  expect(aside.getAttribute('aria-hidden')).toBe('true');
  entries.value.push({ id: 'new', path: '新文档.md', name: '新文档.md', kind: 'file', size: 0, modified: 0 });
  await nextTick();
  open.value = true;
  await nextTick();
  expect(root.querySelector('aside')).toBe(aside);
  expect(root.querySelector('[role="tree"]')).toBe(tree);
  expect(root.querySelector('[title="项目"]')).toBe(folder);
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  expect(root.querySelector('[title="项目/计划.md"]')).toBeNull();
  expect(root.querySelector('[title="新文档.md"]')).not.toBeNull();
  expect(scroll.scrollTop).toBe(180);
  expect(aside.hasAttribute('inert')).toBe(false);
});

it('continues a quick reversal from its current visual position and cancels motion on unmount', async () => {
  const { open, rect, animate, animations } = await mountSidebar();
  rect.mockReturnValueOnce({ left: 230 } as DOMRect).mockReturnValueOnce({ left: 0 } as DOMRect);
  open.value = false;
  await nextTick();
  await nextTick();
  expect(animate.mock.calls[0][0]).toEqual([
    { transform: 'translateX(230px)' }, { transform: 'translateX(0)' },
  ]);
  rect.mockReturnValueOnce({ left: 95 } as DOMRect).mockReturnValueOnce({ left: 230 } as DOMRect);
  open.value = true;
  await nextTick();
  await nextTick();
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(animate.mock.calls[1][0]).toEqual([
    { transform: 'translateX(-135px)' }, { transform: 'translateX(0)' },
  ]);
  app?.unmount();
  app = undefined;
  expect(animations[1].cancel).toHaveBeenCalledOnce();
});

it.each(['compact', 'reduced-motion'] as const)('does not move the document in %s mode', async mode => {
  vi.stubGlobal('matchMedia', () => ({ matches: mode === 'reduced-motion' }));
  const { open, rect, animate } = await mountSidebar(mode === 'compact');
  rect.mockReturnValueOnce({ left: 230 } as DOMRect).mockReturnValueOnce({ left: 0 } as DOMRect);
  open.value = false;
  await nextTick();
  await nextTick();
  expect(animate).not.toHaveBeenCalled();
});

it('cancels a desktop slide when switching to the compact layout', async () => {
  const { open, isCompact, rect, animations } = await mountSidebar();
  rect.mockReturnValueOnce({ left: 230 } as DOMRect).mockReturnValueOnce({ left: 0 } as DOMRect);
  open.value = false;
  await nextTick();
  await nextTick();
  isCompact.value = true;
  await nextTick();
  expect(animations[0].cancel).toHaveBeenCalledOnce();
});
