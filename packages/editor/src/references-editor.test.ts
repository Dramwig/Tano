// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { EditorView } from '@milkdown/kit/prose/view';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { editorViewCtx } from '@milkdown/kit/core';
import { Schema } from '@milkdown/kit/prose/model';
import { referencePicker, referencePickerKey } from './reference-picker';
import type { ReferenceTarget } from '@tano/protocol';
import MarkdownEditor from './MarkdownEditor.vue';
import { defaultCapabilities } from './runtime';
const targets: ReferenceTarget[] = [
  { workspace: 'ws', type: 'person', id: 'a00001', name: 'Alice', path: 'objects/a.tano.json' },
  { workspace: 'ws', type: 'project', id: 'b00002', name: 'Alice', path: 'objects/b.tano.json' },
];
let app: App | undefined, root: HTMLDivElement;
afterEach(async () => {
  app?.unmount();
  root?.remove();
  await nextTick();
});
async function mount(
  content = '',
  revealMarkdown = false,
  initialTargets: ReferenceTarget[] = targets,
) {
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content),
    editor = ref<InstanceType<typeof MarkdownEditor>>();
  const candidates = ref(initialTargets.map((target) => ({ ...target })));
  const capabilities = ref(structuredClone(defaultCapabilities));
  const opened: unknown[] = [],
    errors: string[] = [];
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(
    defineComponent(
      () => () =>
        h(MarkdownEditor, {
          ref: editor,
          documentId: 'doc',
          modelValue: value.value,
          referenceTargets: candidates.value,
          capabilities: capabilities.value,
          revealMarkdown,
          'onUpdate:modelValue': (next: string) => {
            value.value = next;
          },
          onOpenReference: (identity) => opened.push(identity),
          onError: (error) => errors.push(error),
        }),
    ),
  );
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return { value, editor, candidates, capabilities, opened, errors };
}
it.each(['task', 'project', 'person', 'document', 'event', 'asset'])(
  'opens the %s reference as editable Markdown when selected',
  async (type) => {
    const target = {
      workspace: 'ws',
      type,
      id: 'a00001',
      name: 'Item',
      path: type === 'document' ? 'Item.md' : type === 'asset' ? 'Item.png' : 'objects/a00001.tano.json',
    };
    const source = `Before [@Item](object://${type}/a00001) after.\n`;
    const { value, opened, errors } = await mount(source, true, [target]);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    root.querySelector<HTMLButtonElement>('.tano-reference button')!.click();
    await nextTick();
    expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(
      `[@Item](object://${type}/a00001)`,
    );
    expect(value.value).toBe(source);
    expect(opened).toEqual([]);
    prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await nextTick();
    expect(root.querySelector('.tano-reference')).not.toBeNull();
    expect(value.value).toBe(source);
    expect(errors).toEqual([]);
  },
);
it('creates an inline Todo reference after selected prose and supports undo without losing the source', async () => {
  const { value, editor } = await mount('before selected after\n', false, [{ workspace: 'ws', type: 'event', id: 'b00001', name: 'Task', path: '.tano/objects/b00001.tano.json' }]);
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 16)));
  });
  const selection = editor.value!.captureTodoSelection()!;
  expect(selection.text).toBe('selected');
  expect(selection.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(true);
  await nextTick();
  expect(value.value).toContain('before selected [@Task](object://event/b00001) after');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value.trim()).toBe('before selected after');
  value.value = 'changed selected after\n';
  await nextTick();
  expect(selection.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(false);
});
it('places a Todo reference in a paragraph after selected fenced code', async () => {
  const { value, editor } = await mount('```ts\nselected code\n```\n');
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 14)));
  });
  const selection = editor.value!.captureTodoSelection()!;
  expect(selection.text).toBe('selected code');
  expect(selection.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(true);
  await nextTick();
  expect(value.value).toContain('```ts\nselected code\n```\n\n[@Task](object://event/b00001)');
});
it('keeps a core object card rendered when clicked with Markdown reveal enabled', async () => {
  const source = '[Plan](object://project/b00002 "tano:object-card")\n';
  const { value, opened, errors } = await mount(source, true);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  root.querySelector<HTMLButtonElement>('.tano-reference-card button')!.click();
  expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(root.querySelector('.tano-reference-card')?.getAttribute('data-reference-url')).toBe(
    'object://project/b00002',
  );
  expect(value.value).toBe(source);
  expect(opened).toEqual([{ type: 'project', id: 'b00002' }]);
  expect(errors).toEqual([]);
});
it('opens a core object target with Ctrl-click while Markdown reveal is enabled', async () => {
  const { opened, value } = await mount('[@Alice](object://person/a00001)\n', true);
  root
    .querySelector<HTMLButtonElement>('.tano-reference button')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(opened).toEqual([{ type: 'person', id: 'a00001' }]);
  expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(value.value).toBe('[@Alice](object://person/a00001)\n');
});
it('switches directly between core object reference sources', async () => {
  const source = '[@Alice](object://person/a00001) and [@Alice](object://project/b00002)\n';
  const { value, opened, errors } = await mount(source, true);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  root.querySelectorAll<HTMLButtonElement>('.tano-reference button')[0]!.click();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(
    '[@Alice](object://person/a00001)',
  );
  root.querySelector<HTMLButtonElement>('.tano-reference button')!.click();
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(
    '[@Alice](object://project/b00002)',
  );
  expect(value.value).toBe(source);
  expect(opened).toEqual([]);
  expect(errors).toEqual([]);
});
it('updates display after rename without rewriting Markdown and preserves unavailable or disabled refs', async () => {
  const source = '[@Alice](object://person/a00001)\n';
  const { value, candidates, capabilities, opened, errors } = await mount(source);
  expect(root.querySelector('.tano-reference')?.textContent).toContain('@Alice');
  candidates.value[0]!.name = 'Alice Zhang';
  await nextTick();
  expect(root.querySelector('.tano-reference')?.textContent).toContain('@Alice Zhang');
  (root.querySelector('.tano-reference button') as HTMLButtonElement).click();
  expect(opened).toEqual([{ type: 'person', id: 'a00001' }]);
  expect(value.value).toBe(source);
  capabilities.value.features.objectReferences = false;
  await nextTick();
  expect(root.textContent).toContain('Level 2 已关闭');
  expect(value.value).toBe(source);
  candidates.value = [targets[1]!];
  capabilities.value.features.objectReferences = true;
  await nextTick();
  expect(root.textContent).toContain('引用不可用');
  expect(value.value).toBe(source);
  expect(errors).toEqual([]);
});
it('keeps removed domain references visible and inert without enabling them as core types', async () => {
  const source = '[@Legacy](object://dataset/a00001)\n';
  const { value, candidates, opened, errors } = await mount(source);
  candidates.value = [
    {
      workspace: 'ws',
      type: 'dataset',
      id: 'a00001',
      name: 'Legacy',
      path: 'objects/legacy.tano.json',
    },
  ];
  await nextTick();
  const button = root.querySelector('.tano-reference button') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('引用不可用');
  button.click();
  expect(opened).toEqual([]);
  expect(value.value).toBe(source);
  expect(errors).toEqual([]);
});
it('binds the chosen same-name target and creates a card through the block command', async () => {
  const { value, editor, errors } = await mount('', false, [targets[0]!, { ...targets[1]!, type: 'event' }]);
  editor.value!.command('reference');
  await nextTick();
  expect(root.querySelectorAll('[role=option]')).toHaveLength(2);
  (
    Array.from(root.querySelectorAll('[role=option]')).find((node) =>
      node.textContent?.includes('事件'),
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(value.value).toContain('[@Alice](object://event/b00002)'));
  editor.value!.command('object-reference');
  await nextTick();
  (root.querySelector('[role=option]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(value.value).toContain('"tano:object-card"'));
  expect(root.querySelector('.tano-reference-card')?.getAttribute('data-feature-level')).toBe('2');
  expect(errors).toEqual([]);
});
it('opens only the link editor when clicking an existing Wiki link', async () => {
  const { value, errors } = await mount('前 [[Notes/Plan|计划]] 后。\n');
  const link = root.querySelector<HTMLAnchorElement>('a[data-tano-wiki-target]')!;
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
  await nextTick();
  expect(document.querySelectorAll('.tano-link-editor-panel')).toHaveLength(1);
  expect(root.querySelector<HTMLElement>('.tano-reference-picker')?.hidden).toBe(true);
  expect(value.value).toBe('前 [[Notes/Plan|计划]] 后。\n');
  expect(errors).toEqual([]);
});
it('does not open the reference picker from a Wiki link click', () => {
  root = document.createElement('div');
  document.body.append(root);
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
      text: {},
      tano_wiki_link: {
        inline: true, group: 'inline', atom: true,
        attrs: { target: { default: '' } },
        toDOM: (node) => ['a', { href: '#', 'data-tano-wiki-target': node.attrs.target }, node.attrs.target],
      },
    },
  });
  const wiki = schema.nodes.tano_wiki_link!.create({ target: 'Notes/Plan' });
  const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, wiki));
  const view = new EditorView(root, {
    state: EditorState.create({ doc, plugins: [referencePicker({ enabled: () => true, targets: () => targets })] }),
  });
  try {
    const handled = view.someProp('handleClickOn', (handler) =>
      handler(view, 1, wiki, 1, new MouseEvent('click', { button: 0 }), true),
    );
    expect(handled).toBeFalsy();
    expect(referencePickerKey.getState(view.state)).toBeNull();
  } finally {
    view.destroy();
  }
});
it('does not turn legacy references into object nodes', async () => {
  const { opened, errors } = await mount('[@Alice](object://old_workspace/person/a00001)\n');
  expect(root.querySelector('.tano-reference')).toBeNull();
  expect(opened).toEqual([]);
  expect(errors).toEqual([]);
});
it('opens @ and [[ suggestions, supports typed qualifiers, and leaves cancelled input intact', async () => {
  root = document.createElement('div');
  document.body.append(root);
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0] },
      text: {},
    },
  });
  let enabled = true;
  const view = new EditorView(root, {
    state: EditorState.create({
      schema,
      plugins: [referencePicker({ enabled: () => enabled, targets: () => targets })],
    }),
  });
  const type = (text: string) => {
    const { from, to } = view.state.selection;
    let handled = false;
    view.someProp('handleTextInput', (handler) => {
      if (handler(view, from, to, text, () => view.state.tr.insertText(text, from, to))) {
        handled = true;
        return true;
      }
    });
    if (!handled) view.dispatch(view.state.tr.insertText(text));
  };
  try {
    type('@');
    type('person:Alice');
    await nextTick();
    expect(root.querySelectorAll('[role=option]')).toHaveLength(1);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.state.doc.textContent).toBe('@person:Alice');
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('[');
    type('[');
    await nextTick();
    expect((root.querySelector('.tano-reference-picker') as HTMLElement).hidden).toBe(false);
    enabled = false;
    view.dispatch(view.state.tr);
    await nextTick();
    expect((root.querySelector('.tano-reference-picker') as HTMLElement).hidden).toBe(true);
  } finally {
    view.destroy();
  }
});
