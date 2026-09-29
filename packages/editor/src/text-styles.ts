import { $markSchema, $remark } from '@milkdown/kit/utils';
import type { DOMOutputSpec } from '@milkdown/kit/prose/model';
import { normalizeTextColor, remarkTextStyles } from './text-style-markdown';
import type { TextStyle } from './text-style-markdown';

function styleMark(name: TextStyle, tag: string, excludes?: string) {
  return $markSchema(name, () => ({
    ...(excludes ? { excludes } : {}),
    parseDOM: [{ tag }],
    toDOM: (): DOMOutputSpec => [tag, 0],
    parseMarkdown: {
      match: (node) => node.type === 'tanoTextStyle' && node.style === name,
      runner: (state, node, markType) => {
        state.openMark(markType);
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: (state, mark) => {
        state.withMark(mark, 'tanoTextStyle', undefined, { style: name });
      },
    },
  }));
}

export const underline = styleMark('underline', 'u');
export const superscript = styleMark('superscript', 'sup', 'superscript subscript');
export const subscript = styleMark('subscript', 'sub', 'subscript superscript');
export const highlight = styleMark('highlight', 'mark');
export const textColor = $markSchema('text_color', () => ({
  attrs: {
    color: {
      default: '#111111',
      validate(value: unknown) {
        if (typeof value !== 'string' || !normalizeTextColor(value))
          throw new Error('无效的文字颜色');
      },
    },
  },
  parseDOM: [
    {
      tag: 'span[style]',
      getAttrs: (dom) => {
        const style = (dom as HTMLElement).getAttribute('style') ?? '';
        const match = /^\s*color\s*:\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*;?\s*$/i.exec(style);
        return match ? { color: normalizeTextColor(match[1]) } : false;
      },
    },
  ],
  toDOM: (mark) => [
    'span',
    { style: `color: ${normalizeTextColor(mark.attrs.color) ?? '#111111'}` },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'tanoTextStyle' && node.style === 'text_color',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'text_color',
    runner: (state, mark) => {
      state.withMark(mark, 'tanoTextStyle', undefined, {
        style: 'text_color',
        color: mark.attrs.color,
      });
    },
  },
}));
export const textStylesRemark = $remark('tano-text-styles', () => remarkTextStyles);
export const textStyles = [
  textStylesRemark,
  underline,
  superscript,
  subscript,
  highlight,
  textColor,
].flat();
