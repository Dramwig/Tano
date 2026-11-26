// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import MarkdownEditor from './MarkdownEditor.vue';
import type {
  ExternalCodeBlockRenderer,
  ExternalEditorDecoration,
} from '../plugins/external-decorations';

let app: App | undefined;
let root: HTMLDivElement | undefined;

afterEach(async () => {
  app?.unmount();
  app = undefined;
  root?.remove();
  root = undefined;
  await nextTick();
});

async function waitForReady(ready: { value: boolean }) {
  for (let i = 0; i < 60 && !ready.value; i++) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  await nextTick();
}

describe('MarkdownEditor external codeBlockRenderers and decorations', () => {
  it('mounts sandboxed code block renderer, toggles source editing, and writes back source', async () => {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    root = document.createElement('div');
    document.body.append(root);
    const content = ref('```chart\nseries: 1,2,3\n```\n');
    const ready = ref(false);
    let capturedUpdateSource: ((next: string) => void) | undefined;
    const updatedSources: string[] = [];
    const mounted = vi.fn();
    const disposed = vi.fn();
    const renderer: ExternalCodeBlockRenderer = {
      id: 'chart-renderer-1',
      languages: ['chart'],
      label: '交互图表',
      height: 240,
      mount(container, context) {
        mounted();
        capturedUpdateSource = context.updateSource;
        const card = container.ownerDocument.createElement('div');
        card.className = 'mock-chart-sandbox';
        card.textContent = `${context.language}:${context.source.trim()}`;
        container.append(card);
        return {
          update(next) {
            updatedSources.push(next.source.trim());
            card.textContent = `${next.language}:${next.source.trim()}`;
          },
          dispose: disposed,
        };
      },
    };
    const renderers = [renderer];
    app = createApp({
      render: () =>
        h(MarkdownEditor, {
          documentId: 'doc-cb',
          modelValue: content.value,
          codeBlockRenderers: renderers,
          'onUpdate:modelValue': (next: string) => {
            content.value = next;
          },
          onReady: () => {
            ready.value = true;
          },
        }),
    });
    app.mount(root);
    await waitForReady(ready);

    const card = root.querySelector('.tano-plugin-code-block')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('交互图表');
    expect(card.querySelector('.mock-chart-sandbox')?.textContent).toBe('chart:series: 1,2,3');
    const mountsBeforeUpdate = mounted.mock.calls.length;

    const toggle = card.querySelector<HTMLButtonElement>('.tano-plugin-code-toggle')!;
    expect(card.classList.contains('is-editing-source')).toBe(false);
    toggle.click();
    expect(card.classList.contains('is-editing-source')).toBe(true);

    // Interactive sandbox writes updated source back into Markdown without tearing down the iframe
    capturedUpdateSource!('series: 4,5,6');
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(content.value).toContain('series: 4,5,6');
    expect(updatedSources.at(-1)).toBe('series: 4,5,6');
    expect(mounted.mock.calls.length).toBe(mountsBeforeUpdate);

    app.unmount();
    app = undefined;
    expect(disposed).toHaveBeenCalledTimes(mounted.mock.calls.length);
  });

  it('renders declarative inline highlights and clickable badges from UTF-16 source offsets', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const content = ref('Hello world from Tano.\n');
    const ready = ref(false);
    const clicked = vi.fn();
    const decorations = ref<ExternalEditorDecoration[]>([
      {
        key: 'deco-1',
        from: 6,
        to: 11,
        tone: 'warning',
        badge: '待核对',
        tooltip: '检查此词',
        onClick: clicked,
      },
    ]);
    app = createApp({
      render: () =>
        h(MarkdownEditor, {
          documentId: 'doc-deco',
          modelValue: content.value,
          decorations: decorations.value,
          onReady: () => {
            ready.value = true;
          },
        }),
    });
    app.mount(root);
    await waitForReady(ready);

    const highlight = root.querySelector<HTMLElement>('.tano-plugin-deco-warning');
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toBe('world');
    expect(highlight?.title).toBe('检查此词');

    const badge = root.querySelector<HTMLButtonElement>('.tano-plugin-badge-warning');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('待核对');
    badge!.click();
    expect(clicked).toHaveBeenCalledOnce();

    // Clearing decorations removes both DOM elements cleanly
    decorations.value = [];
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(root.querySelector('.tano-plugin-deco-warning')).toBeNull();
    expect(root.querySelector('.tano-plugin-badge-warning')).toBeNull();
  });
});
