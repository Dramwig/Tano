import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { activeInlineSourceRange, touchingInlineRange } from './inline-source-range';

describe('inline source visibility contract', () => {
  const fields = [{ from: 2, to: 5 }, { from: 5, to: 9 }, { from: 11, to: 13 }];
  it.each([
    [1, null], [2, { from: 2, to: 5 }], [3, { from: 2, to: 5 }],
    [5, { from: 2, to: 9 }], [6, { from: 5, to: 9 }], [9, { from: 5, to: 9 }],
    [10, null], [11, { from: 11, to: 13 }], [13, { from: 11, to: 13 }], [14, null],
  ])('reveals exactly fields containing or touching caret %s', (caret, expected) => {
    expect(touchingInlineRange(fields, caret as number)).toEqual(expected);
  });
  it('does not retain previously visited fields when the caret reverses direction', () => {
    const path = [3, 5, 6, 9, 10, 9, 6, 5, 3];
    expect(path.map(caret => touchingInlineRange(fields, caret))).toEqual([
      fields[0], { from: 2, to: 9 }, fields[1], fields[1], null,
      fields[1], fields[1], { from: 2, to: 9 }, fields[0],
    ]);
  });
  it('includes enclosing syntax without expanding unrelated fields', () => {
    expect(touchingInlineRange([{ from: 0, to: 8 }, { from: 2, to: 5 }, { from: 9, to: 12 }], 3))
      .toEqual({ from: 0, to: 8 });
  });
});

describe('rendered document field boundaries', () => {
  const schema = new Schema({
    nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' }, text: { group: 'inline' },
      math_inline: { inline: true, group: 'inline', atom: true } },
    marks: { strong: {}, underline: {}, highlight: {}, inline_comment: {}, link: { attrs: { href: {} } } },
  });
  const text = (value: string, name?: string) => schema.text(value, name ? [schema.marks[name]!.create()] : []);
  const doc = schema.node('doc', null, schema.node('paragraph', null, [
    text('前 '), text('粗体', 'strong'), text('下划线', 'underline'), schema.node('math_inline'), text(' 后'),
  ]));
  it.each([
    [2, null], [3, { from: 3, to: 5 }], [4, { from: 3, to: 5 }],
    [5, { from: 3, to: 8 }], [6, { from: 5, to: 8 }],
    [8, { from: 5, to: 9 }], [9, { from: 8, to: 9 }], [10, null],
  ])('handles marks and inline atoms identically at position %s', (position, expected) => {
    expect(activeInlineSourceRange({ selection: TextSelection.create(doc, position as number) },
      node => node.type.name === 'math_inline')).toEqual(expected);
  });
  it('does not replace a nonempty text selection with editable source', () => {
    expect(activeInlineSourceRange({ selection: TextSelection.create(doc, 4, 6) })).toBeNull();
  });
  it('respects different attributes on adjacent marks of the same type', () => {
    const linked = schema.node('doc', null, schema.node('paragraph', null, [
      schema.text('one', [schema.marks.link!.create({ href: 'a' })]),
      schema.text('two', [schema.marks.link!.create({ href: 'b' })]),
    ]));
    expect(activeInlineSourceRange({ selection: TextSelection.create(linked, 2) })).toEqual({ from: 1, to: 4 });
    expect(activeInlineSourceRange({ selection: TextSelection.create(linked, 4) })).toEqual({ from: 1, to: 7 });
    expect(activeInlineSourceRange({ selection: TextSelection.create(linked, 5) })).toEqual({ from: 4, to: 7 });
  });
});
