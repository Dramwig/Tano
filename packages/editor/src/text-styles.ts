import { $markSchema, $remark } from '@milkdown/kit/utils';
import type { DOMOutputSpec } from '@milkdown/kit/prose/model';
import { normalizeTextColor, remarkTextStyles } from './text-style-markdown';
import type { TextStyle } from './text-style-markdown';

function styleMark(name: TextStyle, tag: string, excludes?: string) {
  return $markSchema(name, () => ({
    attrs: { delimiter: { default: null } },
    ...(excludes ? { excludes } : {}),
    parseDOM: [{ tag }],
    toDOM: (): DOMOutputSpec => [tag, 0],
    parseMarkdown: {
      match: (node) => node.type === 'tanoTextStyle' && node.style === name,
      runner: (state, node, markType) => {
        state.openMark(markType, { delimiter: node.delimiter ?? null });
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: (state, mark) => {
        state.withMark(mark, 'tanoTextStyle', undefined, { style: name, delimiter: mark.attrs.delimiter });
      },
    },
  }));
}

export const underline = styleMark('underline', 'u');
export const superscript = styleMark('superscript', 'sup', 'superscript subscript');
export const subscript = styleMark('subscript', 'sub', 'subscript superscript');
export const highlight = styleMark('highlight', 'mark', 'highlight background_color');
export const inlineComment = $markSchema('inline_comment', () => ({
  attrs: { delimiter: { default: '%%' } },
  excludes: '_',
  parseDOM: [{ tag: 'span[data-tano-comment]' }],
  toDOM: () => ['span', { 'data-tano-comment': '', title: 'Markdown 注释' }, 0],
  parseMarkdown: {
    match: node => node.type === 'tanoTextStyle' && node.style === 'inline_comment',
    runner: (state, node, type) => { state.openMark(type); state.next(node.children); state.closeMark(type); },
  },
  toMarkdown: {
    match: mark => mark.type.name === 'inline_comment',
    runner: (state, mark) => { state.withMark(mark, 'tanoTextStyle', undefined, { style: 'inline_comment', delimiter: '%%' }); },
  },
}));
function colorMark(name: 'text_color' | 'background_color', property: 'color' | 'background-color') {
  return $markSchema(name, () => ({
    ...(name === 'background_color' ? { excludes: 'background_color highlight' } : {}),
    attrs: {
      color: {
        default: '#111111',
        validate(value: unknown) {
          if (typeof value !== 'string' || !normalizeTextColor(value))
            throw new Error('无效的颜色');
        },
      },
    },
    parseDOM: [
      {
        tag: 'span[style]',
        getAttrs: (dom) => {
          const style = (dom as HTMLElement).getAttribute('style') ?? '';
          const match = new RegExp(`^\\s*${property}\\s*:\\s*(#[\\da-f]{3}(?:[\\da-f]{3})?)\\s*;?\\s*$`, 'i').exec(style);
          return match ? { color: normalizeTextColor(match[1]) } : false;
        },
      },
    ],
    toDOM: (mark) => [
      'span',
      { style: `${property}: ${normalizeTextColor(mark.attrs.color) ?? '#111111'}` },
      0,
    ],
    parseMarkdown: {
      match: (node) => node.type === 'tanoTextStyle' && node.style === name,
      runner: (state, node, markType) => {
        state.openMark(markType, { color: node.color });
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: (state, mark) => {
        state.withMark(mark, 'tanoTextStyle', undefined, {
          style: name,
          color: mark.attrs.color,
        });
      },
    },
  }));
}
export const textColor = colorMark('text_color', 'color');
export const backgroundColor = colorMark('background_color', 'background-color');
export const textStylesRemark = $remark('tano-text-styles', () => remarkTextStyles);
export const textStyles = [
  textStylesRemark,
  underline,
  superscript,
  subscript,
  highlight,
  textColor,
  backgroundColor,
  inlineComment,
].flat();
