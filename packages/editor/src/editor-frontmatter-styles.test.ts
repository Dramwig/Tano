// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { BlockRangeSelection } from './block-selection';
import { blockTree } from './block-tree';
import mermaid from 'mermaid';
import { splitFrontmatter, unsupportedMarkdown } from './syntax';
import {
  defaultCapabilities,
  defaultChineseInput,
  defaultEditorPreferences,
  defaultSelectionWrapping,
  normalizeCopyFormat,
} from './runtime';
import { inlineSourceCodec } from './inline-source-session';
import {
  copyMarkdown,
  expandCopyMenu,
  mount,
  mountPanel,
  openSelectedBlockSources,
  placeCaret,
  registerEditorCleanup,
  root,
  wrapInput,
} from './editor.test.helpers';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })),
  },
}));

registerEditorCleanup();

describe('Markdown editor round trips (frontmatter and text styles)', () => {
  it.each(['Body\n', '---\n---\n\nBody\n', '---\n# keep this comment\n---\n\nBody\n', '---\n{}\n---\n\nBody\n'])('keeps empty properties hidden until the first property is requested: %j', async content => {
    const { value, editor, errors } = await mount(content);
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    await editor.value!.addDocumentProperty();
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    const name = panel.querySelector<HTMLInputElement>('[aria-label="属性名"]')!;
    expect(panel.open).toBe(true);
    expect(document.activeElement).toBe(name);
    expect(value.value).toBe(content);
    // A real key event arrives in a later task; Vue ignores bubbled events
    // timestamped in the same millisecond as the newly mounted row listener.
    await new Promise(resolve => setTimeout(resolve, 1));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    expect(value.value).toBe(content);
    expect(errors).toEqual([]);
  });

  it.each(['Body\n', '---\n# keep this comment\n---\n\nBody\n', '---\n{}\n---\n\nBody\n'])('writes the first property and hides the panel after deleting the last one: %j', async content => {
    const { value, editor, errors } = await mount(content);
    await editor.value!.addDocumentProperty();
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    const name = panel.querySelector<HTMLInputElement>('[aria-label="属性名"]')!;
    name.value = 'status';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    panel.querySelector<HTMLButtonElement>('.frontmatter-value-editor button')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('[aria-label="属性值"]')!;
    input.value = 'draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('status: draft\n');
    expect(splitFrontmatter(value.value).body).toBe(splitFrontmatter(content).body);
    if (content.includes('# keep this comment')) expect(value.value).toContain('# keep this comment\n');
    panel.querySelector<HTMLButtonElement>('[aria-label="切换 status 的类型"]')!.click();
    await nextTick();
    panel.querySelector<HTMLButtonElement>('.frontmatter-type-delete')!.click();
    await nextTick();
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    expect(splitFrontmatter(value.value).body).toBe(splitFrontmatter(content).body);
    if (content.includes('# keep this comment')) expect(value.value).toContain('# keep this comment\n');
    await editor.value!.addDocumentProperty();
    expect(root.querySelector<HTMLDetailsElement>('.frontmatter-panel')?.open).toBe(true);
    expect(errors).toEqual([]);
  });

  it('keeps the first-property entry inactive for readonly documents', async () => {
    const { value, editor, readonly } = await mount('Body\n');
    readonly.value = true;
    await nextTick();
    await editor.value!.addDocumentProperty();
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    expect(value.value).toBe('Body\n');
  });

  it('shows frontmatter as collapsible property rows without changing the Markdown', async () => {
    const content =
      '---\ntype: reference\nstatus: active\ndomains: [meta, docs]\ncreated: 2026/05/11\n---\n\nBody\n';
    const { value } = await mount(content);
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent?.trim()).toBe('文档属性');
    expect(
      [...panel.querySelectorAll('.frontmatter-property')].map((row) => row.textContent?.trim()),
    ).toEqual(['typereference', 'statusactive', 'domainsmeta、docs', 'created2026/05/11']);
    expect(panel.querySelector('.frontmatter-raw')).toBeNull();
    expect(value.value).toBe(content);
  });

  it('hides document properties without changing frontmatter, resetting the editor, or dropping later updates', async () => {
    const prefix = '---\n# keep this comment\ntitle: "旧标题"\ntags: [agent, human]\n---\n\n';
    const content = prefix + 'Body\n';
    const { value, editor, showDocumentProperties, errors } = await mount(
      content, undefined, defaultCapabilities, defaultEditorPreferences, false,
    );
    const prose = root.querySelector('.ProseMirror');
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    expect(value.value).toBe(content);

    showDocumentProperties.value = true;
    await nextTick();
    expect(root.querySelector('.frontmatter-panel')?.textContent).toContain('旧标题');
    showDocumentProperties.value = false;
    await nextTick();
    expect(root.querySelector('.frontmatter-panel')).toBeNull();
    expect(root.querySelector('.ProseMirror')).toBe(prose);
    expect(editor.value!.canUndo()).toBe(false);
    expect(value.value).toBe(content);

    editor.value!.withContext(ctx => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText('Updated ', 1));
    });
    await vi.waitFor(() => expect(value.value).toBe(prefix + 'Updated Body\n'));
    value.value = value.value.replace('旧标题', '外部标题');
    await nextTick();
    showDocumentProperties.value = true;
    await nextTick();
    expect(root.querySelector('.frontmatter-panel')?.textContent).toContain('外部标题');
    expect(value.value).toBe(prefix.replace('旧标题', '外部标题') + 'Updated Body\n');
    expect(errors).toEqual([]);
  });

  it('edits document properties in the panel and writes typed YAML', async () => {
    const content = '---\ntitle: "旧标题" # keep\ntags: [agent, human]\nenabled: true\n---\n\nBody\n';
    const { value, readonly } = await mount(content);
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    const title = [...panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-value')]
      .find((button) => button.title === '编辑 title')!;
    title.focus();
    title.click();
    await nextTick();
    const row = panel.querySelector<HTMLElement>('.frontmatter-row-editor')!;
    expect(row.closest('.frontmatter-property')).not.toBeNull();
    expect(panel.querySelector('.frontmatter-form')).toBeNull();
    expect(panel.querySelector('.frontmatter-add')).not.toBeNull();
    const input = row.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = '新标题';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: 新标题 # keep'));
    expect(panel.querySelector('.frontmatter-row-editor')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await nextTick();
    expect(value.value).toContain('tags: [agent, human]\n');
    expect(value.value).toContain('\nBody\n');

    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'count';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    const typeIcon = panel.querySelector<HTMLButtonElement>('[aria-label="切换 count 的类型"]')!;
    typeIcon.focus();
    typeIcon.click();
    await nextTick();
    expect(panel.querySelector('.frontmatter-type-menu')).not.toBeNull();
    [...panel.querySelectorAll<HTMLButtonElement>('.frontmatter-type-menu button')]
      .find((button) => button.textContent?.trim() === '数字')!.click();
    await vi.waitFor(() => expect(value.value).toContain('count: 0\n'));
    const number = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    number.value = '42';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('count: 42\n'));
    readonly.value = true;
    await nextTick();
    expect(panel.querySelector('.frontmatter-property-button')).toBeNull();
  });

  it('focuses the property name when clicked and saves renames inline', async () => {
    const { value } = await mount('---\ntitle: original\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-name')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    expect(document.activeElement).toBe(name);
    name.value = 'heading';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('"heading": original'));
    expect(value.value).not.toContain('title: original');
    expect(value.value).toContain('\nBody\n');
    expect(document.activeElement).toBe(name);
  });

  it('keeps a new property name focused while typing repeated digits', async () => {
    const { value } = await mount('---\nwww: text\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    for (const digit of '111') {
      name.value += digit;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      expect(panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')).toBe(name);
      expect(document.activeElement).toBe(name);
      expect(panel.querySelector('[role="alert"]')).toBeNull();
    }
    expect(value.value).toContain('"111":');
  });

  it('toggles property display order without moving an active new row', async () => {
    const { value } = await mount('---\nwww: text\naaa: first\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    const names = () => [...panel.querySelectorAll<HTMLElement>('.frontmatter-property')]
      .map((row) => row.dataset.propertyName);
    const toggle = panel.querySelector<HTMLButtonElement>('.frontmatter-order-toggle')!;
    expect(names()).toEqual(['www', 'aaa']);
    toggle.click();
    await nextTick();
    expect(panel.open).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual(['aaa', 'www']);

    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    for (const digit of '111') {
      name.value += digit;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      expect(document.activeElement).toBe(name);
      expect(names()).toEqual(['aaa', 'www', name.value]);
    }
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(names()).toEqual(['111', 'aaa', 'www']);
    expect(value.value).toContain('"111":');

    toggle.click();
    await nextTick();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['www', 'aaa', '111']);
  });

  it('reorders a renamed property only after leaving its editor', async () => {
    const { value } = await mount('---\nalpha: first\nmiddle: second\nzulu: third\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-order-toggle')!.click();
    await nextTick();
    const names = () => [...panel.querySelectorAll<HTMLElement>('.frontmatter-property')]
      .map((row) => row.dataset.propertyName);
    panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-name')[1]!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'zzzz';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(names()).toEqual(['alpha', 'zzzz', 'zulu']);
    expect(document.activeElement).toBe(name);
    expect(value.value).toContain('"zzzz": second');

    panel.querySelector<HTMLButtonElement>('.frontmatter-value-editor button')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('[aria-label="属性值"]')!;
    input.focus();
    await nextTick();
    expect(names()).toEqual(['alpha', 'zzzz', 'zulu']);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(names()).toEqual(['alpha', 'zulu', 'zzzz']);
  });

  it('keeps a property draft when another edit arrives and reports a same-field conflict', async () => {
    const { value } = await mount('---\ntitle: first\nother: old\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-value[title="编辑 title"]')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: draft'));
    value.value = value.value.replace('other: old', 'other: new');
    await nextTick();
    expect(panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')?.value).toBe('draft');
    value.value = value.value.replace('title: draft', 'title: external');
    await nextTick();
    input.value = 'mine';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain('属性已被其他修改更新');
    expect(value.value).toContain('title: external');
  });

  it('saves inline typing immediately and leaves the row on Escape or blur', async () => {
    const { value } = await mount('---\ntitle: original\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-value[title="编辑 title"]')!.click();
    await nextTick();
    let input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'discarded';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: discarded'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    expect(value.value).toContain('title: discarded');
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();

    panel.querySelector<HTMLButtonElement>('.frontmatter-property-value[title="编辑 title"]')!.click();
    await nextTick();
    input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'saved';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await vi.waitFor(() => expect(value.value).toContain('title: saved'));
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
  });

  it('shows validation under the edited value and discards an invalid draft on blur', async () => {
    const { value } = await mount('---\nstamp: 2026-09-26T00:00:23\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-value')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = '2026-09-27T00:00:23';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('stamp: 2026-09-27T00:00:23'));
    input.value = '2026-09-27T00:00:23423';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-value-editor [role="alert"]')?.textContent).toBe('请输入有效日期和时间');
    expect(panel.querySelector('.frontmatter-name-editor [role="alert"]')).toBeNull();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
    expect(panel.querySelector('.frontmatter-property-value')?.textContent).toBe('2026-09-27T00:00:23');
    expect(value.value).not.toContain('2026-09-27T00:00:23423');
  });

  it('shows duplicate-name validation under the property name and restores it on blur', async () => {
    const { value } = await mount('---\ntitle: first\nother: second\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-name')[1]!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'title';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-name-editor [role="alert"]')?.textContent).toBe('属性名已存在');
    expect(panel.querySelector('.frontmatter-value-editor [role="alert"]')).toBeNull();
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
    expect([...panel.querySelectorAll('.frontmatter-property-name')].map((element) => element.textContent)).toEqual(['title', 'other']);
    expect(value.value).toContain('other: second');
  });

  it('preserves YAML bytes while editing math, code and relative image references', async () => {
    const metadata =
      '---\r\ntitle: "同页" # keep this comment\r\ntags: [agent, human]\r\n...\r\n\r\n';
    const content =
      metadata +
      '# Title\n\nInline $x^2 + y^2$ and ![figure](assets/a.png).\n\n$$\n\\frac{1}{2}\n$$\n\n```js\nconst answer = 42;\n```\n';
    const { value, editor, errors } = await mount(content);
    await vi.waitFor(() => expect(root.querySelectorAll('.katex')).toHaveLength(2));
    expect(root.querySelector('.token.keyword')?.textContent).toBe('const');
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/assets/a.png',
    );
    editor.value!.command('math');
    await nextTick();
    expect(value.value.startsWith(metadata)).toBe(true);
    expect(value.value).toContain('$x^2 + y^2$');
    expect(value.value).toContain('\\frac{1}{2}');
    expect(value.value).toContain('(assets/a.png)');
    expect(value.value).not.toContain('https://example.test');
    expect(errors).toEqual([]);
  });

  it('maps an asynchronous pasted image through intervening editor changes', async () => {
    let complete!: (value: { url: string; name: string; image: boolean }) => void;
    const importer = vi.fn(
      () =>
        new Promise<{ url: string; name: string; image: boolean }>((resolve) => {
          complete = resolve;
        }),
    );
    const { value, editor, errors } = await mount('A paragraph.\n', importer);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['image'], 'pasted.png', { type: 'image/png' })] },
    });
    root.querySelector('.ProseMirror')!.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(root.querySelector('.asset-upload-placeholder')).not.toBeNull();
    editor.value!.command('math');
    complete({ url: 'assets/pasted.png', name: 'pasted.png', image: true });
    await vi.waitFor(() => expect(value.value).toContain('assets/pasted.png'));
    expect(value.value).toContain('$E = mc^2$');
    expect(value.value).toContain('A paragraph.');
    expect(root.querySelector('.asset-upload-placeholder')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('detects collaboration-incompatible syntax and preserves frontmatter delimiters', () => {
    expect(splitFrontmatter('---\na: 1\n---\n\nbody')).toEqual({
      prefix: '---\na: 1\n---\n\n',
      body: 'body',
    });
    expect(unsupportedMarkdown('Footnote[^a]\n\n[^a]: details')).toEqual([]);
    expect(unsupportedMarkdown('<script>alert(1)</script>')).toContain('内嵌 HTML / MDX');
    expect(unsupportedMarkdown('---\nnot closed')).toContain('未闭合的 YAML 属性');
    expect(unsupportedMarkdown('```html\n<div>sample</div>\n```\n\n$\\text{<tag>}$')).toEqual([]);
  });

  it('edits formula source without granting KaTeX trusted HTML or URL access', async () => {
    const { value, errors } = await mountPanel('Formula $x$ and $\\href{javascript:alert(1)}{bad}$.\n');
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    const button = root.querySelector<HTMLButtonElement>('.math-preview')!;
    button.click();
    const input = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="LaTeX 公式源码"]')!;
    input.value = '\\frac{a}{b}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('$\\frac{a}{b}$');
    expect(errors).toEqual([]);
  });

  it('inserts a display formula and renders updated multiline source after reloading', async () => {
    const { value, editor, errors } = await mountPanel('正文\n');
    editor.value!.command('math-block');
    await nextTick();
    expect(root.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(value.value).toContain('$$\nE = mc^2\n$$');
    expect(value.value).toContain('正文');
    const button = root.querySelector<HTMLButtonElement>('.math-block .math-preview')!;
    button.click();
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    const latex = '\\begin{aligned}\na &= b + c \\\\\nd &= \\frac{1}{2}\n\\end{aligned}';
    input.value = latex;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const modifiedEnter = new KeyboardEvent('keydown', {
      key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
    });
    input.dispatchEvent(modifiedEnter);
    expect(modifiedEnter.defaultPrevented).toBe(false);
    expect(input.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(input.hidden).toBe(true);
    expect(value.value).toContain(latex);
    const saved = value.value;
    value.value = '临时正文';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(root.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(root.querySelector('.katex-error')).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>('.math-block textarea')?.value).toBe(latex);
    expect(errors).toEqual([]);
  });

  it('keeps malformed LaTeX editable without breaking other rendered formulas', async () => {
    const { value, errors } = await mount('$\\frac{$ and $x^2$\n');
    expect(root.querySelector('.katex-error')?.textContent).toBe('\\frac{');
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(value.value).toContain('$\\frac{$');
    expect(errors).toEqual([]);
  });

  it('renders portable text styles and keeps them when editing other content', async () => {
    const content =
      '**粗体** *斜体* ~~删除线~~ `代码` <u>下划线</u> x<sup>2</sup> H<sub>2</sub>O <mark>高亮</mark> <span style="color: #db2777">颜色</span>\n';
    const { value, editor, errors } = await mount(content);
    for (const [tag, text] of [
      ['strong', '粗体'],
      ['em', '斜体'],
      ['del', '删除线'],
      ['code', '代码'],
      ['u', '下划线'],
      ['sup', '2'],
      ['sub', '2'],
      ['mark', '高亮'],
    ])
      expect(root.querySelector(tag)?.textContent).toBe(text);
    expect(root.querySelector<HTMLElement>('span[style]')?.style.color).toBe('rgb(219, 39, 119)');
    editor.value!.command('math');
    await nextTick();
    expect(unsupportedMarkdown(value.value)).toEqual([]);
    expect(value.value).toContain('<u>下划线</u>');
    expect(value.value).toContain('<span style="color: #db2777">颜色</span>');
    expect(errors).toEqual([]);
  });

  it('applies and resets backgrounds independently of text colors and replaces highlight', async () => {
    const { value, editor, errors } = await mount('正文文字\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    editor.value!.command('text-color', '#db2777');
    editor.value!.command('background-color', '#e3f2fd');
    await nextTick();
    expect(value.value).toContain('background-color: #e3f2fd');
    expect(value.value).toContain('color: #db2777');
    expect(view.state.doc.textContent).toBe('正文文字');
    expect(view.state.doc.resolve(3).nodeAfter?.marks).toEqual([]);
    expect(root.querySelector<HTMLElement>('span[style*="background-color"]')?.style.backgroundColor).toBe('rgb(227, 242, 253)');
    const saved = value.value;
    editor.value!.command('background-color', 'url(https://example.test)');
    await nextTick();
    expect(value.value).toBe(saved);
    editor.value!.command('background-color');
    await nextTick();
    expect(value.value).not.toContain('background-color');
    expect(value.value).toContain('color: #db2777');
    editor.value!.command('background-color', '#fbf3db');
    editor.value!.command('highlight');
    await nextTick();
    expect(value.value).toContain('<mark>');
    expect(value.value).not.toContain('background-color');
    editor.value!.command('background-color', '#e7f3ec');
    await nextTick();
    expect(value.value).not.toContain('<mark>');
    expect(value.value).toContain('background-color: #e7f3ec');
    expect(unsupportedMarkdown(value.value)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('undoes and redoes a background color change without changing the text', async () => {
    const { value, editor } = await mount('正文文字\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    editor.value!.command('background-color', '#e3f2fd');
    await nextTick();
    const colored = value.value;
    expect(colored).toContain('background-color: #e3f2fd');
    expect(editor.value!.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toBe('正文文字\n');
    expect(editor.value!.redoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toBe(colored);
  });

  it('applies text styles from commands and serializes selected text without losing it', async () => {
    const { value, editor, errors } = await mount('选中文字\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    const range = document.createRange();
    range.selectNodeContents(prose.querySelector('p')!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    editor.value!.command('underline');
    await nextTick();
    expect(value.value).toContain('<u>选中文字</u>');
    editor.value!.command('text-color', '#db2777');
    await nextTick();
    expect(value.value).toContain('<span style="color: #db2777">');
    editor.value!.command('superscript');
    editor.value!.command('subscript');
    await nextTick();
    expect(value.value).toContain('<sub>');
    expect(value.value).not.toContain('<sup>');
    editor.value!.command('text-color');
    await nextTick();
    expect(value.value).not.toContain('style=');
    expect(value.value).toContain('选中文字');
    expect(errors).toEqual([]);
  });
});
