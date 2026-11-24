import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { isElement, isHTMLElement, ownerWindow } from '@tano/editor/dom-realm';
import { headings } from '@tano/markdown';
import { HeadingViewport } from '../documents/heading-viewport';
import { recordHelpCompleted } from '../help/help-checklist';
import { focusedOutlineIndices } from '../documents/outline-tree';
import type { OpenDocument } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { SourceEditor } from '../shell/workbench-async-components';
import { readPreference, savePreference } from './use-workbench-preferences';

export interface WorkbenchOutlineDeps {
  active: Ref<OpenDocument | undefined>;
  activeId: Ref<string>;
  source: Ref<boolean>;
  documentScroll: Ref<HTMLElement | undefined>;
  editorScroll: Ref<HTMLElement | undefined>;
  sourceEditor: Ref<InstanceType<typeof SourceEditor> | undefined>;
  showPageTitle: Ref<boolean>;
  activeWindow: Ref<WindowContext>;
  touchLayout: Ref<boolean>;
  closeOtherContextMenus: () => void;
}

export function useWorkbenchOutline(deps: WorkbenchOutlineDeps) {
  const {
    active,
    activeId,
    source,
    documentScroll,
    editorScroll,
    sourceEditor,
    showPageTitle,
    activeWindow,
    touchLayout,
    closeOtherContextMenus,
  } = deps;

  const hoverOutline = window.matchMedia('(hover: hover)').matches;
  const panel = ref<'outline' | 'activity'>('outline');
  const showOutline = ref(readPreference('showOutline', true));
  const touchOutlineOpen = ref(false);
  watch(activeId, () => {
    touchOutlineOpen.value = false;
  });
  const outlineOnLeft = ref(readPreference('outlineOnLeft', false));
  const outlinePinned = ref(readPreference('outlinePinned', false));
  const outlineSearchOpen = ref(false);
  const outlineAutoCollapse = ref(readPreference('outlineAutoCollapse', false));
  watch(outlineAutoCollapse, (enabled) => savePreference('outlineAutoCollapse', enabled));
  const outlineSearch = ref('');
  const outlineSearchInput = ref<HTMLInputElement>();
  const outlineContextMenu = ref<{ x: number; y: number } | null>(null);
  const outlineContextMenuElement = ref<HTMLElement>();

  const activeHeading = ref(0);
  const outlineCoverBottom = ref(0);
  const outlinePosition = computed(() => {
    if (!outlineCoverBottom.value) return undefined;
    const top = `max(var(--inspector-top), ${outlineCoverBottom.value}px)`;
    return { top, maxHeight: `calc(100% - ${top} - var(--inspector-bottom, 12px))` };
  });
  let headingFrame: number | undefined;
  let headingWindow: Window | undefined;

  const outline = computed(() => headings(active.value?.content ?? ''));
  const visibleOutline = computed(() => {
    const query = outlineSearch.value.trim().toLocaleLowerCase();
    const focused =
      outlineAutoCollapse.value && !query
        ? focusedOutlineIndices(outline.value, activeHeading.value)
        : undefined;
    return outline.value.flatMap((heading, index) =>
      (!focused || focused.has(index)) &&
      (!query || heading.text.toLocaleLowerCase().includes(query))
        ? [{ heading, index }]
        : [],
    );
  });

  const headingViewport = new HeadingViewport();
  let pendingHeadingScroll: { top: number; coverBottom: number } | undefined;

  function updateActiveHeading(snapshot?: typeof pendingHeadingScroll) {
    const container = documentScroll.value;
    const cover = container?.querySelector<HTMLElement>('.document-cover');
    const pane = container?.closest<HTMLElement>('.workspace-pane');
    // Measure in the inspector's containing pane, including partially scrolled covers.
    outlineCoverBottom.value =
      snapshot?.coverBottom ??
      (cover && pane
        ? Math.max(0, cover.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 16)
        : 0);
    const root = editorScroll.value;
    if (!container || !root || source.value || !outline.value.length) return;
    activeHeading.value = Math.min(
      headingViewport.active(root, container, 100, snapshot?.top),
      outline.value.length - 1,
    );
  }

  function scheduleActiveHeading(event?: Event) {
    const container = documentScroll.value;
    if (event?.type === 'scroll' && event.target !== container) return;
    if (event?.type === 'scroll' && container) {
      // Read before animation-frame callbacks move floating controls. Even a
      // scrollTop getter after those writes can force pending layout to finish.
      const cover = container.querySelector<HTMLElement>('.document-cover');
      const pane = container.closest<HTMLElement>('.workspace-pane');
      pendingHeadingScroll = {
        top: container.scrollTop,
        coverBottom:
          cover && pane
            ? Math.max(
                0,
                cover.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 16,
              )
            : 0,
      };
    } else pendingHeadingScroll = undefined;
    const targetWindow = container ? ownerWindow(container) : activeWindow.value.window;
    if (headingFrame !== undefined && headingWindow === targetWindow) return;
    if (headingFrame !== undefined) headingWindow?.cancelAnimationFrame(headingFrame);
    headingWindow = targetWindow;
    headingFrame = targetWindow.requestAnimationFrame(() => {
      headingFrame = undefined;
      const snapshot = pendingHeadingScroll;
      pendingHeadingScroll = undefined;
      updateActiveHeading(snapshot);
    });
  }

  watch(showOutline, (visible) => {
    savePreference('showOutline', visible);
    if (!visible) {
      outlineSearchOpen.value = false;
      outlineSearch.value = '';
    } else void nextTick(scheduleActiveHeading);
  });
  watch(outlineOnLeft, (left) => savePreference('outlineOnLeft', left));
  watch(outlinePinned, (pinned) => savePreference('outlinePinned', pinned));

  async function toggleOutlineSearch(event?: Event) {
    if (outlineSearchOpen.value) {
      outlineSearchOpen.value = false;
      outlineSearch.value = '';
      (event?.currentTarget as HTMLElement | undefined)?.blur();
      return;
    }
    outlineSearchOpen.value = true;
    await nextTick();
    outlineSearchInput.value?.focus();
  }

  function releaseOutlinePointerFocus(event: PointerEvent) {
    const { document } = activeWindow.value;
    if (
      panel.value !== 'outline' ||
      touchLayout.value ||
      !hoverOutline ||
      outlinePinned.value ||
      event.pointerType === 'touch'
    )
      return;
    const surface = event.currentTarget as HTMLElement;
    const focused = document.activeElement;
    // Mouse-opened search must not act as a pin. Keyboard focus still expands
    // the outline until the pointer leaves it, and the search state is retained.
    if (isHTMLElement(focused) && surface.contains(focused)) focused.blur();
  }

  function toggleOutlinePin(event: MouseEvent) {
    outlinePinned.value = !outlinePinned.value;
    if (!outlinePinned.value) (event.currentTarget as HTMLButtonElement).blur();
  }

  function closeOutlineContextMenu() {
    outlineContextMenu.value = null;
  }

  function openOutlineContextMenu(event: MouseEvent) {
    const { window: activeWin } = activeWindow.value;
    if (panel.value !== 'outline') return;
    event.preventDefault();
    closeOtherContextMenus();
    if (hoverOutline && !outlinePinned.value) toggleOutlinePin(event);
    const x = Math.max(8, event.clientX);
    const y = Math.max(8, event.clientY);
    outlineContextMenu.value = { x, y };
    void nextTick(() => {
      const element = outlineContextMenuElement.value;
      if (!element || !outlineContextMenu.value) return;
      outlineContextMenu.value = {
        x: Math.min(x, Math.max(8, activeWin.innerWidth - element.offsetWidth - 8)),
        y: Math.min(y, Math.max(8, activeWin.innerHeight - element.offsetHeight - 8)),
      };
      element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
  }

  function toggleOutlineSide() {
    outlineOnLeft.value = !outlineOnLeft.value;
    closeOutlineContextMenu();
  }

  function outlineContextKeydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOutlineContextMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(outlineContextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  function jumpToHeading(index: number, userInitiated = false) {
    if (!outline.value[index]) return;
    if (userInitiated && touchLayout.value) touchOutlineOpen.value = false;
    activeHeading.value = index;
    if (source.value) {
      if (!sourceEditor.value) return;
      const toolbarHeight = documentScroll.value?.querySelector('.editor-toolbar')?.clientHeight ?? 0;
      sourceEditor.value.jumpToLine(outline.value[index].line, toolbarHeight);
    } else {
      const heading = editorScroll.value?.querySelectorAll(
        '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
      )[index];
      if (!heading) return;
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (userInitiated) recordHelpCompleted('reading');
  }

  watch(
    [() => active.value?.content, source],
    () => {
      headingViewport.invalidate();
      void nextTick(scheduleActiveHeading);
    },
    {
      flush: 'post',
    },
  );

  watch(
    [documentScroll, editorScroll, showPageTitle],
    ([container, root], _, cleanup) => {
      const invalidate = () => {
        headingViewport.invalidate();
        scheduleActiveHeading();
      };
      invalidate();
      scheduleActiveHeading();
      if (!container) return;
      // A cover can be added or removed without changing the outline. Also follow
      // window/sidebar/split resizing and title or toolbar layout changes.
      const observer = new (ownerWindow(container).ResizeObserver)(invalidate);
      observer.observe(container);
      for (const element of container.querySelectorAll('.document-main, .document-title'))
        observer.observe(element);
      // Font/image loading and folded/expanded node views can move headings without
      // changing Markdown. Gutter button updates are deliberately excluded.
      const mutations = new (ownerWindow(container).MutationObserver)((records) => {
        if (
          records.some((record) => {
            const element = isElement(record.target) ? record.target : record.target.parentElement;
            return (
              element?.closest('.tano-prose') ||
              [...record.addedNodes, ...record.removedNodes].some(
                (node) =>
                  isElement(node) &&
                  (node.matches('.tano-prose') || node.querySelector('.tano-prose')),
              )
            );
          })
        )
          invalidate();
      });
      if (root) {
        observer.observe(root);
        mutations.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        root.addEventListener('load', invalidate, true);
      }
      cleanup(() => {
        observer.disconnect();
        mutations.disconnect();
        root?.removeEventListener('load', invalidate, true);
      });
    },
    { flush: 'post' },
  );

  onBeforeUnmount(() => {
    if (headingFrame !== undefined) headingWindow?.cancelAnimationFrame(headingFrame);
  });

  function resetOnActiveChange() {
    closeOutlineContextMenu();
    panel.value = 'outline';
    outlineSearchOpen.value = false;
    outlineSearch.value = '';
    activeHeading.value = 0;
    void nextTick(scheduleActiveHeading);
  }

  return {
    hoverOutline,
    panel,
    showOutline,
    touchOutlineOpen,
    outlineOnLeft,
    outlinePinned,
    outlineAutoCollapse,
    outlineSearchOpen,
    outlineSearch,
    outlineSearchInput,
    outlineContextMenu,
    outlineContextMenuElement,
    outline,
    visibleOutline,
    activeHeading,
    outlinePosition,
    toggleOutlineSearch,
    releaseOutlinePointerFocus,
    toggleOutlinePin,
    closeOutlineContextMenu,
    openOutlineContextMenu,
    toggleOutlineSide,
    outlineContextKeydown,
    scheduleActiveHeading,
    jumpToHeading,
    resetOnActiveChange,
  };
}
