import { expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { DecorationSet } from '@milkdown/kit/prose/view';
import { autoSpacing } from './auto-spacing';
import { defaultCapabilities } from './runtime';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline' },
    ...Object.fromEntries(['math_inline', 'tano_wiki_link', 'tano_reference'].map(name => [name, { inline: true, group: 'inline', atom: true }])),
  },
  marks: { strong: {}, link: {}, code: { code: true }, superscript: {} },
});
const text = (value: string) => schema.text(value);
const paragraph = (...content: import('@milkdown/kit/prose/model').Node[]) => schema.node('paragraph', null, content);
function setup(blocks: import('@milkdown/kit/prose/model').Node[], features = defaultCapabilities.features) {
  let enabled = true;
  const plugin = autoSpacing(() => enabled, () => features);
  let state = EditorState.create({ schema, doc: schema.node('doc', null, blocks), plugins: [plugin] });
  return {
    ranges: () => (plugin.props.decorations!.call(plugin, state) as DecorationSet).find().map(({ from, to }) => [from, to]),
    enable: (value: boolean) => { enabled = value; },
    edit: () => { state = state.apply(state.tr.insertText('新A文', 1)); },
    select: () => { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))); },
  };
}

it('spaces Chinese/Latin/numbers across formatting without spacing punctuation or existing blanks', () => {
  const test = setup([paragraph(text('中'), text('Word').mark([schema.marks.strong!.create()]), text('文2026年，A。中 A 文\u3000B'))]);
  expect(test.ranges()).toEqual([[2, 3], [6, 7], [7, 8], [11, 12]]);
  test.select();
  expect(test.ranges()).toHaveLength(4);
});

it('keeps spacing inside disabled styles across formatting but skips their visible delimiter boundaries', () => {
  const sup = schema.marks.superscript!.create();
  const test = setup([paragraph(text('1'), text('中').mark([sup]),
    text('A').mark([schema.marks.strong!.create(), sup]), text('文').mark([sup]), text('2'))],
  { ...defaultCapabilities.features, superscript: false });
  expect(test.ranges()).toEqual([[3, 4], [4, 5]]);
});

it.each(['math_inline', 'tano_wiki_link', 'tano_reference'])('spaces both Chinese boundaries of %s, respecting whitespace and punctuation', name => {
  const test = setup([paragraph(text('中'), schema.node(name), text('文，'), schema.node(name), text(' 文'))]);
  expect(test.ranges()).toEqual([[2, 3], [3, 4]]);
});

it('skips code, hard breaks and block boundaries while covering nested prose', () => {
  const test = setup([
    paragraph(text('中'), text('A中').mark([schema.marks.code!.create()]), text('文'), schema.node('hard_break'), text('A')),
    schema.node('code_block', null, text('中A文1')),
    schema.node('blockquote', null, paragraph(text('中A'))),
  ]);
  expect(test.ranges()).toEqual([[17, 18]]);
});

it('preserves supplementary Han and combining Latin characters and refreshes after edits/toggles', () => {
  const test = setup([paragraph(text('𠀀e\u0301文'))]);
  expect(test.ranges()).toEqual([[3, 4], [5, 6]]);
  test.enable(false);
  expect(test.ranges()).toEqual([]);
  test.edit();
  expect(test.ranges()).toEqual([]);
  test.enable(true);
  expect(test.ranges()).toEqual([[2, 3], [3, 4], [6, 7], [8, 9]]);
});
