import { afterEach, expect, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import type { EditorView } from '@milkdown/kit/prose/view';
import { BlockRangeSelection } from '../plugins/block-selection';
import MarkdownEditor from './MarkdownEditor.vue';
import { defaultCapabilities, defaultEditorPreferences } from '../core/runtime';

let app: App | undefined;
export let root: HTMLDivElement;

export function registerEditorCleanup() {
  afterEach(async () => {
    app?.unmount();
    app = undefined;
    root?.remove();
    await nextTick();
  });
}

export function copyMarkdown(view: EditorView, type = 'copy') {
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => data.clear(),
      setData: (format: string, value: string) => data.set(format, value),
    },
  });
  view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return data;
}

export async function expandCopyMenu() {
  const trigger = document.querySelector<HTMLButtonElement>(
    '.block-context-menu button[aria-haspopup="menu"]',
  )!;
  expect(trigger.textContent).toBe('复制为');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click();
  await nextTick();
}

export async function mount(
  content: string,
  importer?: (
    file: File,
    requireImage: boolean,
  ) => Promise<{ url: string; name: string; image: boolean }>,
  initialCapabilities = defaultCapabilities,
  initialPreferences = defaultEditorPreferences,
  initialShowDocumentProperties?: boolean,
) {
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const readonly = ref(false);
  const revealMarkdown = ref(true);
  const showDocumentProperties = ref(initialShowDocumentProperties);
  const capabilities = ref(structuredClone(initialCapabilities));
  const preferences = ref({ ...initialPreferences });
  const errors: string[] = [];
  const openedWikiLinks: string[] = [];
  const openedLinks: string[] = [];
  const openedNewTabLinks: string[] = [];
  let selectionChanges = 0;
  let blankBlockAi = 0;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(
    defineComponent(
      () => () =>
        h(
          MarkdownEditor,
          {
            ref: editor,
            modelValue: value.value,
            documentId: 'document',
            readonly: readonly.value,
            revealMarkdown: revealMarkdown.value,
            showDocumentProperties: showDocumentProperties.value,
            capabilities: capabilities.value,
            preferences: preferences.value,
            resolveImage: (reference) =>
              reference.startsWith('assets/') ? `https://example.test/${reference}` : null,
            importFile: importer,
            'onUpdate:modelValue': (next: string) => {
              value.value = next;
            },
            onError: (error: string) => errors.push(error),
            onOpenWikiLink: (target: string) => openedWikiLinks.push(target),
            onOpenLink: (href: string, newTab?: boolean) => {
              openedLinks.push(href);
              if (newTab) openedNewTabLinks.push(href);
            },
            onSelectionChange: () => {
              selectionChanges++;
            },
            onBlankBlockAi: () => {
              blankBlockAi++;
            },
          },
          { 'empty-document': () => h('div', { class: 'test-document-starter' }, '开始使用') },
        ),
    ),
  );
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return {
    value,
    editor,
    errors,
    openedWikiLinks,
    openedLinks,
    openedNewTabLinks,
    readonly,
    revealMarkdown,
    showDocumentProperties,
    capabilities,
    preferences,
    selectionChangeCount: () => selectionChanges,
    blankBlockAiCount: () => blankBlockAi,
  };
}

export async function mountPanel(content: string) {
  const result = await mount(content);
  result.revealMarkdown.value = false;
  await nextTick();
  return result;
}

export function placeCaret(element: Element, offset: number) {
  const range = document.createRange();
  range.setStart(element.firstChild!, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

export function wrapInput(view: EditorView, key: string) {
  const { from, to } = view.state.selection;
  return view.someProp('handleTextInput', (handler) =>
    handler(view, from, to, key, () => view.state.tr.insertText(key, from, to)),
  );
}

export async function openSelectedBlockSources(view: EditorView, positions: number[]) {
  view.dispatch(
    view.state.tr.setSelection(BlockRangeSelection.fromBlocks(view.state.doc, positions)!),
  );
  root
    .querySelector<HTMLButtonElement>(`.tano-block-handle[data-block-pos="${positions[0]}"]`)!
    .click();
  await nextTick();
  const button = [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')].find(
    (btn) => btn.textContent === '编辑源码',
  )!;
  expect(button.disabled).toBe(false);
  button.click();
  await nextTick();
}
