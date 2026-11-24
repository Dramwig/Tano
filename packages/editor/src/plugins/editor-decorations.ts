import type { Component } from 'vue';
import type { Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { CommentAnchor } from '@tano/protocol';
import { createDocumentDecorations } from './document-decorations';
import { blockType, featureLevel } from '../core/document-model';
import { calloutMarker } from '../markdown/callout';
import { createCalloutTitle, type CalloutKind } from '../markdown/callout-title';
import { customCalloutWidget } from '../views/custom-callout-view';
import { projectCommentText, proseRangesForCommentSpans } from '../core/comment-projection';
import type { EditorExtension } from '../core/extension';
import type { WorkspaceCapabilities } from '../core/runtime';
import type { InlineSourceDestination } from './inline-source-controller';

export const referenceFlashKey = new PluginKey<DecorationSet>('tano-reference-flash');

export function createReferenceFlashPlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: referenceFlashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const range = tr.getMeta(referenceFlashKey) as { from: number; to: number } | null | undefined;
            if (range === null || tr.docChanged) return DecorationSet.empty;
            return range
              ? DecorationSet.create(tr.doc, [
                  Decoration.inline(range.from, range.to, { class: 'tano-reference-flash' }),
                ])
              : previous;
          },
        },
        props: { decorations: (state) => referenceFlashKey.getState(state) },
      }),
  );
}

export function createCommentMarksPlugin(
  getCommentAnchors: () => readonly { id: string; anchor: CommentAnchor }[] | undefined,
) {
  return $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const anchors = getCommentAnchors();
            if (!anchors?.length) return DecorationSet.empty;
            const text = projectCommentText(state.doc).text;
            const marks = anchors.flatMap(({ id, anchor }) => {
              if (
                anchor.basis !== 'prose' ||
                anchor.spans.some((span) => text.slice(span.from, span.to) !== span.text)
              ) {
                return [];
              }
              return proseRangesForCommentSpans(state.doc, anchor.spans).map(({ from, to }) => {
                const node = state.doc.nodeAt(from);
                return node && !node.isText && node.isAtom && node.nodeSize === to - from
                  ? Decoration.node(
                      from,
                      to,
                      { class: 'tano-comment-mark', 'data-comment-id': id },
                      { id },
                    )
                  : Decoration.inline(
                      from,
                      to,
                      { class: 'tano-comment-mark', 'data-comment-id': id },
                      { id },
                    );
              });
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
  );
}

export interface DocumentDecorationsOptions {
  getEditor: () => Editor | undefined;
  getRuntimeRevision: () => number;
  readonly: () => boolean;
  revealMarkdown: () => boolean;
  policy: () => WorkspaceCapabilities;
  customCalloutIcon: () => Component | undefined;
  extension: () => EditorExtension | undefined;
  inlineSourceDestination: (ctx: Ctx, source: string) => InlineSourceDestination | null;
}

export function createEditorDecorationsBuilder(options: DocumentDecorationsOptions) {
  const {
    getEditor,
    getRuntimeRevision,
    readonly,
    revealMarkdown,
    policy,
    customCalloutIcon,
    extension,
    inlineSourceDestination,
  } = options;
  const documentDecorations = createDocumentDecorations();

  return (ctx: Ctx, state: EditorState) =>
    documentDecorations(
      state,
      `${getRuntimeRevision()}:${readonly()}:${revealMarkdown()}`,
      (block, start) => {
        const decorations: Decoration[] = [];
        const revision = String(getRuntimeRevision());
        const visit = (node: Node, pos: number) => {
          if (
            node.type.name === 'tano_live_source_inline' &&
            inlineSourceDestination(ctx, node.textContent)
          ) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: 'tano-clickable-source' }),
            );
          }
          if (node.type.name === 'tano_wiki_link') {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                'data-feature-level': '1',
                'data-inline-type': 'Mention',
              }),
            );
          }
          if (
            node.isText &&
            node.text?.startsWith('@') &&
            node.marks.some((mark) => mark.type.name === 'link')
          ) {
            decorations.push(
              Decoration.inline(pos, pos + node.nodeSize, {
                class: 'tano-file-mention',
                'data-feature-level': '1',
                'data-inline-type': 'Mention',
              }),
            );
          }
          if (!node.isText && !node.isBlock) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                'data-runtime-policy': revision,
              }),
            );
          }
          if (!node.isBlock) return;
          const type = blockType(node);
          const editingFootnoteLabel =
            type === 'FootnoteDefinition' &&
            node.firstChild?.firstChild?.type.name === 'tano_live_source_inline' &&
            node.firstChild.firstChild.attrs.origin === 'footnote_definition';
          if (type === 'Callout' && policy().features.callout) {
            const marker = calloutMarker.exec(node.firstChild?.textContent ?? '');
            if (marker && node.firstChild?.type.name === 'paragraph') {
              decorations.push(
                Decoration.inline(pos + 2, pos + 2 + marker[0].length, {
                  class: 'tano-callout-marker',
                }),
              );
              if (marker[1]!.toUpperCase().startsWith('CUSTOM')) {
                decorations.push(
                  customCalloutWidget(
                    pos,
                    marker[0],
                    readonly(),
                    customCalloutIcon(),
                    () => getEditor()?.action((c) => extension()?.stopHistoryCapture?.(c)),
                  ),
                );
              } else {
                const label = createCalloutTitle(marker[1]!.toUpperCase() as CalloutKind);
                decorations.push(Decoration.widget(pos + 1, label, { side: -1 }));
              }
              if (node.firstChild.textContent === marker[0]) {
                decorations.push(
                  Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, {
                    class: 'tano-callout-marker-paragraph',
                  }),
                );
              }
            }
          }
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              'data-runtime-policy': revision,
              'data-block-type': type,
              'data-feature-level': String(featureLevel(type)),
              ...(editingFootnoteLabel ? { class: 'tano-footnote-label-editing' } : {}),
              ...(type === 'Callout' && policy().features.callout
                ? {
                    class:
                      'tano-callout' +
                      (!/^\[!CUSTOM[:\]]/i.test(node.firstChild?.textContent ?? '') &&
                      revealMarkdown() &&
                      !readonly() &&
                      state.selection.empty &&
                      state.selection.from >= pos &&
                      state.selection.from <= pos + node.nodeSize
                        ? ' tano-live-callout'
                        : ''),
                    'data-callout-kind':
                      /^\[!([A-Z]+)[:\]]/i
                        .exec(node.firstChild?.textContent ?? '')?.[1]
                        ?.toLowerCase() ?? 'note',
                  }
                : {}),
            }),
          );
        };
        visit(block, start);
        block.descendants((node, pos) => visit(node, start + pos + 1));
        return decorations;
      },
    );
}
