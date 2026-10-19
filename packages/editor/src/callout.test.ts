import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx } from '@milkdown/kit/core';
import { EditorState, NodeSelection } from '@milkdown/kit/prose/state';
import { createHeadlessMarkdown } from './headless';
import { blockCommand } from './block-commands';
import { blockType } from './document-model';
import { customCalloutMarker, blockContentStart } from './callout';
import { slashItems } from './slash-commands';

let codec: Awaited<ReturnType<typeof createHeadlessMarkdown>>;
beforeAll(async () => { codec = await createHeadlessMarkdown(); });
afterAll(async () => { await codec.destroy(); });

it.each(['CUSTOM', 'CUSTOM:🚀', 'CUSTOM:🧑🏽‍💻', 'CUSTOM:❤️', 'CUSTOM:1️⃣', 'CUSTOM:*️⃣', 'CUSTOM:icon:star', 'CUSTOM:none'])('round-trips %s and keeps nested body content out of its metadata', kind => {
  const source = `> [!${kind}]\n> **Hello**\n>\n> - item\n>\n> > Nested\n\nAfter\n`;
  const saved = codec.normalize(source);
  expect(saved).toContain(`> [!${kind}]`);
  expect(saved).toContain('**Hello**');
  expect(saved).toContain('> > Nested');
  expect(codec.normalize(saved)).toBe(saved);
  codec.withContext(ctx => {
    const doc = ctx.get(parserCtx)(saved)!;
    expect(blockContentStart(doc.firstChild!)).toBe(1);
    expect(blockType(doc.firstChild!)).toBe('Callout');
    expect(doc.firstChild!.child(1).textContent).toBe('Hello');
    expect(doc.lastChild!.textContent).toBe('After');
  });
});

it('converts custom callouts to built-in types and plain quotes without leaking metadata or flattening lists', () => {
  codec.withContext(ctx => {
    let state = EditorState.create({ doc: ctx.get(parserCtx)('> [!CUSTOM:icon:star]\n>\n> - item')! });
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    const body = state.doc.firstChild!.lastChild!;
    expect(blockCommand('callout', 'TIP')(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.firstChild!.firstChild!.textContent).toBe('[!TIP]');
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    expect(blockCommand('callout', 'CUSTOM')(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.firstChild!.firstChild!.textContent).toBe('[!CUSTOM]');
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    expect(blockCommand('quote')(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.firstChild!.childCount).toBe(1);
    expect(state.doc.firstChild!.firstChild!.eq(body)).toBe(true);
  });
});

it('offers custom callouts by Chinese, English and emoji keywords', () => {
  for (const query of ['自定义', 'custom', 'emoji'])
    expect(slashItems(query)).toContainEqual(expect.objectContaining({ command: 'callout', value: 'CUSTOM' }));
  expect(slashItems('custom', [0])).toHaveLength(0);
});

it('rejects multiline and executable icon values', () => {
  for (const value of ['x]\n> injected', '<script>', 'javascript:alert(1)', 'data:image/png;base64,abc'])
    expect(customCalloutMarker(value)).toBeNull();
  expect(customCalloutMarker('🧑🏽‍💻')).toBe('[!CUSTOM:🧑🏽‍💻]');
  expect(customCalloutMarker('')).toBe('[!CUSTOM:none]');
});
