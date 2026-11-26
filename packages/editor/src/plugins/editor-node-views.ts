import { watch } from 'vue';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  defaultTableColumnWidth,
  type ReferenceIdentity,
  type ReferenceTarget,
} from '@tano/protocol';
import { setSurfaceVisible } from '../primitives/surface-motion';
import { renderHtml } from '../views/html-render';
import { mathView } from '../markdown/math';
import { sourcePreviewView } from '../views/source-preview';
import { enhancedViews } from '../views/enhanced-views';
import { mermaidView, runtimeViews } from '../views/runtime-views';
import { referenceViews } from '../views/reference-views';
import { virtualBlockViews } from '../views/rich-viewport';
import { TableViewport } from '../views/table-viewport';
import { positionAnchoredPanel, type PanelSide } from '../core/panel-position';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, onOtherEditorPanel } from '../core/editor-panel';
import type { createMermaidRenderer } from '../views/mermaid-preview';
import type { EditorPreferences, WorkspaceCapabilities } from '../core/runtime';
import type { LocalSourceState } from './inline-source-controller';
import type { ExternalCodeBlockRenderer } from './external-decorations';
import { unavailableImageLabel } from './editor-clipboard';

export interface EditorNodeViewsOptions {
  document: Document;
  ctx: Ctx;
  policy: () => WorkspaceCapabilities;
  preferences: () => EditorPreferences;
  readonly: () => boolean;
  revealMarkdown: () => boolean;
  resourceRevision: () => string | undefined;
  resolveImage: () => ((reference: string) => string | null) | undefined;
  referencesEnabled: () => boolean;
  referenceTargets: () => readonly ReferenceTarget[];
  renderMermaid: ReturnType<typeof createMermaidRenderer>;
  codeBlockRenderers?: () => readonly ExternalCodeBlockRenderer[];
  getLocalSource: () => LocalSourceState | undefined;
  activateReferenceSource: (view: EditorView, pos: number) => void;
  onOpenReference: (identity: ReferenceIdentity) => void;
  onOpenLink: (url: string, newTab?: boolean) => void;
  onEditSource: () => void;
}

export function buildEditorNodeViews(options: EditorNodeViewsOptions) {
  const {
    document,
    ctx,
    policy,
    preferences,
    readonly,
    revealMarkdown,
    resourceRevision,
    resolveImage,
    referencesEnabled,
    referenceTargets,
    renderMermaid,
    codeBlockRenderers,
    getLocalSource,
    activateReferenceSource,
    onOpenReference,
    onOpenLink,
    onEditSource,
  } = options;

  return virtualBlockViews(
    runtimeViews(
      {
        table: (node, view) => new TableViewport(node, defaultTableColumnWidth, view),
        ...referenceViews(
          referenceTargets,
          referencesEnabled,
          onOpenReference,
          () => revealMarkdown() && !readonly(),
          activateReferenceSource,
        ),
        ...enhancedViews(
          readonly,
          (url) => onOpenLink(url, true),
          (url) => {
            const resolver = resolveImage();
            return resolver?.(url) ?? (!resolver && /^https?:\/\//i.test(url) ? url : null);
          },
          resourceRevision,
        ),
        html(node) {
          const wrapper = document.createElement('span');
          let current = node;
          const render = () => renderHtml(wrapper, String(current.attrs.value ?? ''), resolveImage());
          render();
          const stop = watch(resourceRevision, render);
          return {
            dom: wrapper,
            update(next) {
              if (next.type !== current.type) return false;
              current = next;
              render();
              return true;
            },
            ignoreMutation: () => true,
            destroy: stop,
          };
        },
        code_block: mermaidView(
          () => policy().features.mermaid,
          readonly,
          revealMarkdown,
          renderMermaid,
          codeBlockRenderers,
        ),
        math_inline: mathView(
          false,
          readonly,
          () => !revealMarkdown() || preferences().previewMathWhileEditing,
          revealMarkdown,
        ),
        math_block: mathView(
          true,
          readonly,
          () => !revealMarkdown() || preferences().previewMathWhileEditing,
          revealMarkdown,
        ),
        tano_live_source_inline: sourcePreviewView(
          true,
          () => preferences().previewMathWhileEditing && revealMarkdown(),
          (source) => ctx.get(parserCtx)(source),
          undefined,
          policy,
        ),
        tano_live_source: sourcePreviewView(
          false,
          () => preferences().previewMathWhileEditing && revealMarkdown(),
          (source) => ctx.get(parserCtx)(source),
          (id) => {
            const localSource = getLocalSource();
            return localSource?.kind === 'block' && localSource.id === id ? localSource.style : null;
          },
          policy,
          {
            enabled: () =>
              preferences().previewMermaidWhileEditing !== false &&
              revealMarkdown() &&
              !readonly(),
            render: renderMermaid,
          },
        ),
        image(node, view, getPos) {
          const wrapper = document.createElement('span');
          wrapper.className = 'tano-image';
          wrapper.contentEditable = 'false';
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.referrerPolicy = 'no-referrer';
          const status = document.createElement('small');
          const imageCaption = document.createElement('span');
          imageCaption.className = 'tano-image-caption';
          const panel = createEditorPanel('div', 'tano-image-editor-panel', '编辑图片');
          const fields = (['src', 'alt', 'title'] as const).map((key) => {
            const label = document.createElement('label');
            const caption = document.createElement('span');
            caption.textContent = {
              src: '图片地址',
              alt: '图注（替代文字）',
              title: '悬停提示',
            }[key];
            const input = document.createElement('input');
            input.type = 'text';
            input.setAttribute('aria-label', caption.textContent);
            label.append(caption, input);
            panel.append(label);
            return { key, input };
          });
          wrapper.append(img, status, imageCaption, panel);
          let current = node;
          let editing = false;
          let stopPositioning: (() => void) | undefined;
          let panelSide: PanelSide | undefined;
          const standalone = () => {
            const pos = getPos();
            if (pos === undefined) return false;
            const parent = view.state.doc.resolve(pos).parent;
            return parent.type.name === 'paragraph' && parent.childCount === 1;
          };
          function positionPanel() {
            panelSide = positionAnchoredPanel(wrapper, panel, 0, panelSide);
          }
          function render() {
            const block = standalone();
            if (editing && (revealMarkdown() || readonly())) {
              editing = false;
              panelSide = undefined;
              stopPositioning?.();
              stopPositioning = undefined;
            }
            wrapper.classList.toggle('tano-image-block', block);
            wrapper.classList.toggle('tano-editor-active', editing);
            wrapper.classList.toggle('tano-image-click-to-edit', !revealMarkdown() && !readonly());
            img.tabIndex = status.tabIndex = !readonly() ? 0 : -1;
            img.setAttribute('role', !readonly() ? 'button' : 'img');
            if (!readonly()) {
              img.setAttribute('aria-label', '编辑图片');
              status.setAttribute('role', 'button');
              status.setAttribute('aria-label', '编辑图片');
            } else {
              img.removeAttribute('aria-label');
              status.removeAttribute('role');
              status.removeAttribute('aria-label');
            }
            setSurfaceVisible(panel, editing);
            for (const { key, input } of fields) {
              const value = String(current.attrs[key] ?? '');
              if (input.value !== value) input.value = value;
              input.readOnly = readonly();
            }
            const reference = String(current.attrs.src ?? '');
            const resolver = resolveImage();
            const url =
              resolver?.(reference) ?? (!resolver && /^https:\/\//i.test(reference) ? reference : null);
            img.alt = current.attrs.alt ?? '';
            img.title = current.attrs.title ?? '';
            imageCaption.textContent = block ? String(current.attrs.alt ?? '') : '';
            imageCaption.hidden = !block || !imageCaption.textContent || !url;
            status.textContent = `图片不可用：${unavailableImageLabel(reference, current.attrs.alt)}`;
            status.hidden = !!url;
            img.hidden = !url;
            if (url) img.src = url;
            else img.removeAttribute('src');
            if (editing) positionPanel();
          }
          function finish(refocus = true) {
            if (!editing) return;
            editing = false;
            panelSide = undefined;
            stopPositioning?.();
            stopPositioning = undefined;
            render();
            if (refocus) view.focus();
          }
          function openPanel() {
            if (revealMarkdown() || readonly() || editing) return;
            announceEditorPanel(view.dom, wrapper);
            editing = true;
            panelSide = undefined;
            render();
            stopPositioning = activateEditorPanel({
              panel,
              anchor: wrapper,
              position: positionPanel,
              close: () => finish(false),
            });
            fields[0]!.input.focus();
          }
          img.onerror = () => {
            img.hidden = true;
            status.hidden = false;
            imageCaption.hidden = true;
            if (editing) positionPanel();
          };
          img.onload = () => {
            img.hidden = false;
            status.hidden = true;
            imageCaption.hidden = !standalone() || !imageCaption.textContent;
            if (editing) positionPanel();
          };
          wrapper.onclick = (event) => {
            if (panel.contains(event.target as globalThis.Node)) return;
            if (editing) finish(false);
            else if (!revealMarkdown()) openPanel();
          };
          wrapper.onkeydown = (event) => {
            if (panel.contains(event.target as globalThis.Node) || !['Enter', ' '].includes(event.key)) {
              return;
            }
            event.preventDefault();
            if (editing) finish(false);
            else if (revealMarkdown()) img.click();
            else openPanel();
          };
          for (const { key, input } of fields) {
            input.oninput = () => {
              if (readonly()) return;
              const pos = getPos();
              if (pos !== undefined) {
                view.dispatch(
                  view.state.tr.setNodeMarkup(pos, undefined, {
                    ...current.attrs,
                    [key]: input.value,
                  }),
                );
              }
            };
            input.onkeydown = (event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              finish();
            };
          }
          wrapper.addEventListener('tano-math-refresh', render);
          const stopOtherPanel = onOtherEditorPanel(view.dom, wrapper, () => finish(false));
          render();
          const stop = watch(resourceRevision, render);
          return {
            dom: wrapper,
            stopEvent: (event) =>
              panel.contains(event.target as globalThis.Node) ||
              ((!revealMarkdown() || editing) && wrapper.contains(event.target as globalThis.Node)),
            update(next) {
              if (next.type !== current.type) return false;
              current = next;
              render();
              return true;
            },
            ignoreMutation: () => true,
            destroy() {
              stop();
              stopPositioning?.();
              stopOtherPanel();
              wrapper.removeEventListener('tano-math-refresh', render);
              wrapper.onclick = wrapper.onkeydown = null;
              for (const { input } of fields) input.oninput = input.onkeydown = null;
              img.onload = img.onerror = null;
            },
          };
        },
        list_item(node, view, getPos) {
          const li = document.createElement('li');
          if (node.attrs.checked == null) {
            return {
              dom: li,
              contentDOM: li,
              update: (next) => next.type === node.type && next.attrs.checked == null,
            };
          }
          li.dataset.itemType = 'task';
          li.dataset.checked = String(node.attrs.checked);
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = node.attrs.checked;
          checkbox.contentEditable = 'false';
          checkbox.setAttribute('aria-label', '完成任务');
          const content = document.createElement('div');
          li.append(checkbox, content);
          const change = () => {
            const pos = getPos();
            if (pos === undefined || readonly()) return;
            const current = view.state.doc.nodeAt(pos);
            if (current) {
              view.dispatch(
                view.state.tr.setNodeMarkup(pos, undefined, {
                  ...current.attrs,
                  checked: checkbox.checked,
                }),
              );
            }
          };
          checkbox.addEventListener('change', change);
          return {
            dom: li,
            contentDOM: content,
            update(next) {
              if (next.type !== node.type || next.attrs.checked == null) return false;
              checkbox.checked = next.attrs.checked;
              li.dataset.checked = String(next.attrs.checked);
              return true;
            },
            stopEvent: (event) => event.target === checkbox,
            ignoreMutation: (mutation) =>
              mutation.type !== 'selection' &&
              (mutation.target === checkbox || mutation.target === li),
            destroy: () => checkbox.removeEventListener('change', change),
          };
        },
      },
      policy,
      (node) => {
        const schema = node.type.schema;
        const content = node.isInline ? schema.nodes.paragraph!.create(null, node) : node;
        return ctx.get(serializerCtx)(schema.topNodeType.create(null, content));
      },
      onEditSource,
    ),
  );
}
