import { editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { DOMSerializer, type Fragment } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseReferenceUrl, resolveReference, type ReferenceTarget } from '@tano/protocol';
import { destinationClipboardHTML, selectedFormulaMathML, tableTSV } from '../core/clipboard-formats';
import { normalizeCopyFormat, type CopyFormat, type EditorPreferences } from '../core/runtime';

export function containsEmbeddedImage(data: DataTransfer | null): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']?data:image\//i.test(
    typeof data?.getData === 'function' ? data.getData('text/html') : '',
  );
}

export function unavailableImageLabel(reference: string, alt: unknown): string {
  if (typeof alt === 'string' && alt) return alt;
  if (/^data:image\//i.test(reference)) return '剪贴板内嵌图片';
  return reference.length > 160 ? `${reference.slice(0, 157)}…` : reference;
}

export interface EditorClipboardOptions {
  document: Document;
  readonly: () => boolean;
  preferences: () => EditorPreferences;
  referenceTargets: () => readonly ReferenceTarget[];
  onError: (message: string) => void;
}

export function createEditorClipboard(options: EditorClipboardOptions) {
  const { document, readonly, preferences, referenceTargets, onError } = options;

  function clipboardContent(
    ctx: Ctx,
    content: Fragment,
    format: CopyFormat | 'mathml' | 'tsv',
  ): { text: string; html?: string } {
    if (format === 'markdown') {
      return {
        text: ctx.get(serializerCtx)(
          ctx.get(editorViewCtx).state.schema.topNodeType.create(null, content),
        ),
      };
    }
    const targets = referenceTargets();
    const text = content.textBetween(0, content.size, '\n\n', (node) => {
      if (node.type.name.startsWith('tano_reference')) {
        const identity = parseReferenceUrl(node.attrs.url ?? '');
        const result = identity && resolveReference(targets, identity);
        return result && result.target ? result.target.name : node.attrs.label || node.attrs.url || '';
      }
      if (node.type.name === 'hardbreak') return '\n';
      return node.attrs.label || node.attrs.alt || node.attrs.value || node.attrs.target || '';
    });
    if (format === 'text') return { text };
    const clipboardDocument = document.implementation.createHTMLDocument('');
    const container = clipboardDocument.createElement('div');
    container.append(
      DOMSerializer.fromSchema(ctx.get(editorViewCtx).state.schema).serializeFragment(content, {
        document: clipboardDocument,
      }),
    );
    if (format === 'mathml') {
      const math = selectedFormulaMathML(container);
      return { text: math, html: math };
    }
    if (format === 'tsv') {
      // Resolve object names before converting cells to spreadsheet text.
      container.querySelectorAll<HTMLElement>('[data-tano-reference]').forEach((reference) => {
        const identity = parseReferenceUrl(reference.dataset.referenceUrl ?? '');
        const resolved = identity && resolveReference(targets, identity);
        reference.textContent =
          resolved && resolved.target
            ? resolved.target.name
            : reference.dataset.referenceLabel || reference.dataset.referenceUrl || '';
      });
      return { text: tableTSV(container) };
    }
    const html = destinationClipboardHTML(
      container,
      targets,
      format === 'wechat' || format === 'zhihu' ? format : 'rich',
    );
    return format === 'html' ? { text: html } : { text, html };
  }

  function copySelectionWithPreference(ctx: Ctx, view: EditorView, event: ClipboardEvent): boolean {
    if (view.state.selection.empty || !event.clipboardData) return false;
    event.preventDefault();
    if (event.type === 'cut' && readonly()) return true;
    const format = normalizeCopyFormat(preferences().copyFormat);
    const serialized = view.serializeForClipboard(view.state.selection.content());
    let copied: { text: string; html?: string };
    try {
      copied =
        format === 'markdown'
          ? { text: serialized.text }
          : clipboardContent(ctx, serialized.slice.content, format);
    } catch (error) {
      onError(error instanceof Error ? error.message : '无法转换复制内容');
      return true;
    }
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', copied.text);
    if (copied.html !== undefined) event.clipboardData.setData('text/html', copied.html);
    if (event.type === 'cut') {
      view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
    }
    return true;
  }

  return {
    clipboardContent,
    copySelectionWithPreference,
  };
}
