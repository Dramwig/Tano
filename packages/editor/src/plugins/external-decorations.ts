import { serializerCtx } from '@milkdown/kit/core';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { markdownPositionMap } from '../core/mode-selection';

export type ExternalDecorationTone = 'info' | 'accent' | 'warning' | 'danger' | 'muted';

export interface ExternalEditorDecoration {
  key: string;
  /** UTF-16 offset range in the document Markdown source. */
  from: number;
  to: number;
  tone?: ExternalDecorationTone;
  badge?: string;
  tooltip?: string;
  onClick?: () => void;
}

export interface ExternalCodeBlockRenderer {
  id?: string;
  languages: readonly string[];
  label: string;
  height?: number;
  mount(
    container: HTMLElement,
    context: {
      language: string;
      source: string;
      readonly: boolean;
      updateSource: (nextSource: string) => void;
    },
  ): {
    update(context: { language: string; source: string; readonly: boolean }): void;
    dispose(): void;
  };
}

export const externalDecorationsKey = new PluginKey('tano-external-decorations');

export function createExternalDecorationsPlugin(options: {
  getDecorations: () => readonly ExternalEditorDecoration[];
  getMarkdown: () => string;
  getFrontmatterPrefix: () => string;
}) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: externalDecorationsKey,
        props: {
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null;
            const hit = target?.closest?.<HTMLElement>('[data-plugin-deco-key]');
            if (!hit) return false;
            const key = hit.dataset.pluginDecoKey;
            const item = options.getDecorations().find((entry) => entry.key === key);
            if (!item?.onClick) return false;
            event.preventDefault();
            item.onClick();
            return true;
          },
          decorations(state) {
            const items = options.getDecorations();
            if (!items.length) return DecorationSet.empty;
            const markdown = options.getMarkdown();
            if (!markdown) return DecorationSet.empty;
            const serializer = ctx.get(serializerCtx);
            const prefix = options.getFrontmatterPrefix();
            const map = markdownPositionMap(state.doc, markdown, (node) => prefix + serializer(node));
            const maxPos = state.doc.content.size;
            const decorations: Decoration[] = [];
            for (const item of items) {
              const tone = item.tone ?? 'accent';
              const clampedFrom = Math.max(0, Math.min(item.from, markdown.length));
              const clampedTo = Math.max(clampedFrom, Math.min(item.to, markdown.length));
              const proseFrom = Math.max(0, Math.min(map.toProse(clampedFrom), maxPos));
              const proseTo = Math.max(proseFrom, Math.min(map.toProse(clampedTo), maxPos));
              if (proseTo > proseFrom) {
                decorations.push(
                  Decoration.inline(proseFrom, proseTo, {
                    class: `tano-plugin-deco tano-plugin-deco-${tone}${item.onClick ? ' is-clickable' : ''}`,
                    ...(item.tooltip ? { title: item.tooltip } : {}),
                    ...(item.onClick ? { 'data-plugin-deco-key': item.key } : {}),
                  }),
                );
              }
              if (item.badge) {
                const badgeText = item.badge;
                const tooltip = item.tooltip;
                const onClick = item.onClick;
                const key = item.key;
                decorations.push(
                  Decoration.widget(
                    proseTo,
                    (view) => {
                      const doc = view.dom.ownerDocument;
                      const el = doc.createElement(onClick ? 'button' : 'span');
                      if (el instanceof view.dom.ownerDocument.defaultView!.HTMLButtonElement) {
                        el.type = 'button';
                      }
                      el.className = `tano-plugin-badge tano-plugin-badge-${tone}${onClick ? ' is-clickable' : ''}`;
                      el.contentEditable = 'false';
                      el.textContent = badgeText;
                      if (tooltip) el.title = tooltip;
                      if (onClick) {
                        el.dataset.pluginDecoKey = key;
                        el.addEventListener('mousedown', (e) => e.preventDefault());
                        el.addEventListener('click', (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onClick();
                        });
                      }
                      return el;
                    },
                    { side: 1, key: `badge:${key}:${proseTo}:${badgeText}:${tone}` },
                  ),
                );
              }
            }
            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },
        },
      }),
  );
}
