import { $nodeSchema, $remark, $inputRule } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { NodeSelection, Selection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { remarkMathSyntax } from './math-markdown';
import { mathHighlightRanges } from './math-highlight';
import { positionAnchoredPanel } from './panel-position';
import type { PanelSide } from './panel-position';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, onOtherEditorPanel } from './editor-panel';
import { markdownPolicy } from './runtime';
import katex from 'katex';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';

export const mathRemark = $remark(
  'tano-math',
  (ctx) =>
    function () {
      this.use(remarkMathSyntax, { policy: () => markdownPolicy(ctx) });
    },
);
const mathAttrs = {
  value: { default: '', validate: 'string' },
  raw: { default: '', validate: 'string' },
  originalValue: { default: '', validate: 'string' },
  delimiter: { default: '', validate: 'string' },
};
function parsedAttrs(
  node:
    | Extract<import('mdast').Nodes, { type: 'math' }>
    | Extract<import('mdast').Nodes, { type: 'inlineMath' }>,
) {
  return {
    value: node.value,
    raw: node.data?.tanoMath?.raw ?? '',
    originalValue: node.value,
    delimiter: node.data?.tanoMath?.delimiter ?? '',
  };
}
function sourceData(node: import('@milkdown/kit/prose/model').Node) {
  return {
    data: {
      tanoMath: {
        raw: node.attrs.raw,
        value: node.attrs.originalValue,
        delimiter: node.attrs.delimiter,
      },
    },
  };
}
function domAttrs(dom: HTMLElement) {
  return {
    value: dom.dataset.value ?? '',
    raw: dom.dataset.mathRaw ?? '',
    originalValue: dom.dataset.mathOriginal ?? '',
    delimiter: dom.dataset.mathDelimiter ?? '',
  };
}
function domSource(node: import('@milkdown/kit/prose/model').Node) {
  return {
    'data-value': node.attrs.value,
    'data-math-raw': node.attrs.raw,
    'data-math-original': node.attrs.originalValue,
    'data-math-delimiter': node.attrs.delimiter,
  };
}
export const inlineMath = $nodeSchema('math_inline', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  attrs: mathAttrs,
  parseDOM: [
    {
      tag: 'span[data-tano-math]',
      getAttrs: (dom) => domAttrs(dom as HTMLElement),
    },
  ],
  toDOM: (node) => ['span', { 'data-tano-math': 'inline', ...domSource(node) }, node.attrs.value],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(
        type,
        parsedAttrs(node as unknown as Extract<import('mdast').Nodes, { type: 'inlineMath' }>),
      );
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value, sourceData(node));
    },
  },
}));
export const blockMath = $nodeSchema('math_block', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: mathAttrs,
  parseDOM: [
    {
      tag: 'div[data-tano-math]',
      getAttrs: (dom) => domAttrs(dom as HTMLElement),
    },
  ],
  toDOM: (node) => ['div', { 'data-tano-math': 'block', ...domSource(node) }, node.attrs.value],
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.addNode(
        type,
        parsedAttrs(node as unknown as Extract<import('mdast').Nodes, { type: 'math' }>),
      );
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs.value, sourceData(node));
    },
  },
}));

// Milkdown's custom input-rule runner does not honor ProseMirror's inCodeMark option.
function containsCode(state: EditorState, start: number, end: number) {
  let code = (state.storedMarks ?? state.doc.resolve(end).marks()).some(
    (mark) => mark.type.spec.code,
  );
  state.doc.nodesBetween(start, end, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code)) code = true;
  });
  return code;
}

export const inlineMathInput = $inputRule(
  (ctx) =>
    new InputRule(
      /(?<![\\$])(\${1,2})([^$\n\ufffc]+)\1$/,
      (state, match, start, end) => {
        if (!markdownPolicy(ctx).features.math || containsCode(state, start, end)) return null;
        return state.tr.replaceWith(
          start,
          end,
          inlineMath.type(ctx).create({
            value: match[2],
            delimiter: 'dollar',
            raw: match[0],
            originalValue: match[2],
          }),
        );
      },
      { inCodeMark: false },
    ),
);

// Like heading/list shortcuts, an empty paragraph containing "$$ " starts a block.
export const blockMathInput = $inputRule(
  (ctx) =>
    new InputRule(
      /^\$\$[ \u00a0]$/,
      (state, _match, start, end) => {
        if (!markdownPolicy(ctx).features.math || containsCode(state, start, end)) return null;
        const $start = state.doc.resolve(start);
        if ($start.parent.type.name !== 'paragraph' || end !== $start.end()) return null;
        const index = $start.index(-1);
        if (!$start.node(-1).canReplaceWith(index, index + 1, blockMath.type(ctx))) return null;
        const position = $start.before();
        const transaction = state.tr.replaceWith(
          position,
          $start.after(),
          blockMath.type(ctx).create(),
        );
        return transaction.setSelection(NodeSelection.create(transaction.doc, position));
      },
      { inCodeMark: false },
    ),
);

export const latexMathInput = $inputRule(
  (ctx) =>
    new InputRule(/(?<!\\)\\\(([^\n\ufffc]+)\\\)$/, (state, match, start, end) => {
      if (!markdownPolicy(ctx).features.math || containsCode(state, start, end)) return null;
      return state.tr.replaceWith(
        start,
        end,
        inlineMath
          .type(ctx)
          .create({ value: match[1], delimiter: 'latex', originalValue: match[1], raw: match[0] }),
      );
    }),
);

export function renderMathPreview(value: string, element: HTMLElement, display: boolean) {
  katex.render(value, element, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
    output: 'htmlAndMathml',
  });
}

export function mathView(
  display: boolean,
  readonly: () => boolean,
  previewWhileEditing: () => boolean = () => true,
  revealMarkdown: () => boolean = () => true,
): NodeViewConstructor {
  return (node, view, getPos) => {
    let current = node;
    let editing = false;
    let stopPositioning: (() => void) | undefined;
    let panelSide: PanelSide | undefined;
    const dom = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'tano-math math-block' : 'tano-math math-inline';
    dom.contentEditable = 'false';
    const preview = document.createElement('span');
    preview.className = 'math-preview';
    preview.setAttribute('aria-label', 'LaTeX 公式');
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'LaTeX 公式源码');
    input.placeholder = 'Esc 或点击外部关闭';
    input.rows = 1;
    input.wrap = 'off';
    input.spellcheck = false;
    input.hidden = true;
    const panel = createEditorPanel('span', 'math-editor-panel', '编辑公式');
    const field = document.createElement('span');
    field.className = 'math-editor-input';
    const highlight = document.createElement('div');
    highlight.className = 'math-editor-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    field.append(highlight, input);
    panel.append(field);
    dom.append(preview, panel);
    function renderSource() {
      const source = input.value;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const { from, to, kind } of mathHighlightRanges(source)) {
        if (from > offset) fragment.append(document.createTextNode(source.slice(offset, from)));
        const token = document.createElement('span');
        token.className = `tano-math-token-${kind}`;
        token.textContent = source.slice(from, to);
        fragment.append(token);
        offset = to;
      }
      if (offset < source.length) fragment.append(document.createTextNode(source.slice(offset)));
      if (source.endsWith('\n')) fragment.append(document.createTextNode('\u200b'));
      highlight.replaceChildren(fragment);
      highlight.style.width = input.clientWidth ? `${input.clientWidth}px` : '';
      highlight.scrollTop = input.scrollTop;
      highlight.scrollLeft = input.scrollLeft;
    }
    function clickToEdit() {
      return !revealMarkdown();
    }
    function positionPanel() {
      const bounds = dom.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      const preferred = display ? (bounds.width - width) / 2 : 0;
      panelSide = positionAnchoredPanel(dom, panel, preferred, panelSide);
    }
    function render() {
      if (editing && (readonly() || revealMarkdown())) {
        editing = false;
        panelSide = undefined;
        stopPositioning?.();
        stopPositioning = undefined;
      }
      const value = String(current.attrs.value);
      const emptyBlock = display && !value.trim();
      if (input.value !== value) input.value = value;
      input.readOnly = readonly();
      preview.title = emptyBlock ? 'LaTeX 公式' : value;
      preview.classList.toggle('math-preview-empty', emptyBlock);
      const showPreview = !editing || previewWhileEditing();
      preview.style.visibility = showPreview ? '' : 'hidden';
      preview.setAttribute('aria-hidden', String(!showPreview));
      preview.tabIndex = !readonly() && clickToEdit() && showPreview ? 0 : -1;
      preview.setAttribute('role', !readonly() && clickToEdit() ? 'button' : 'img');
      preview.setAttribute('aria-label', !readonly() && clickToEdit() ? '编辑公式' : 'LaTeX 公式');
      dom.classList.toggle('math-click-to-edit', !readonly() && clickToEdit());
      dom.classList.toggle('tano-editor-active', editing);
      panel.hidden = !editing;
      input.hidden = !editing;
      renderSource();
      renderMathPreview(
        emptyBlock ? '\\LaTeX{}\\;\\text{公式}' : value,
        preview,
        !emptyBlock && display,
      );
      if (editing) positionPanel();
    }
    function finish(refocus = true) {
      if (!editing) return;
      editing = false;
      panelSide = undefined;
      stopPositioning?.();
      stopPositioning = undefined;
      const pos = getPos();
      if (pos !== undefined) {
        const tr = view.state.tr;
        if (!readonly() && input.value !== String(current.attrs.value))
          tr.setNodeMarkup(pos, undefined, { ...current.attrs, value: input.value });
        if (refocus) {
          const after = pos + tr.doc.nodeAt(pos)!.nodeSize;
          let selection =
            Selection.findFrom(tr.doc.resolve(after), 1, true) ??
            Selection.findFrom(tr.doc.resolve(pos), -1, true);
          if (!selection) {
            const paragraph = tr.doc.type.schema.nodes.paragraph;
            if (paragraph) {
              tr.insert(tr.doc.content.size, paragraph.create());
              selection = Selection.findFrom(tr.doc.resolve(tr.doc.content.size), -1, true);
            }
          }
          if (selection) tr.setSelection(selection);
          tr.setMeta('tanoKeepNodeView', true);
        }
        if (tr.docChanged || tr.selectionSet) view.dispatch(tr);
      }
      render();
      if (refocus) view.focus();
    }
    function openPanel() {
      if (readonly() || revealMarkdown() || editing) return;
      announceEditorPanel(view.dom, dom);
      editing = true;
      panelSide = undefined;
      render();
      stopPositioning = activateEditorPanel({ panel, anchor: dom, position: positionPanel, close: () => finish(false) });
      input.focus();
    }
    function startEditing() {
      if (readonly() || editing) return;
      openPanel();
    }
    preview.onclick = () => {
      if (editing) {
        finish(false);
        return;
      }
      if (clickToEdit()) startEditing();
    };
    preview.onkeydown = (event) => {
      if (clickToEdit() && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (editing) finish(false);
        else startEditing();
      }
    };
    input.oninput = () => {
      renderSource();
      if (readonly()) {
        render();
        return;
      }
      const pos = getPos();
      if (pos !== undefined)
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, value: input.value }),
        );
    };
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    };
    input.onscroll = () => {
      highlight.scrollTop = input.scrollTop;
      highlight.scrollLeft = input.scrollLeft;
    };
    const refresh = () => render();
    dom.addEventListener('tano-math-refresh', refresh);
    const stopOtherPanel = onOtherEditorPanel(view.dom, dom, () => finish(false));
    render();
    return {
      dom,
      selectNode() {
        dom.classList.add('ProseMirror-selectednode');
        if (!current.attrs.value && !readonly()) {
          openPanel();
        }
      },
      deselectNode() {
        dom.classList.remove('ProseMirror-selectednode');
      },
      stopEvent: (event) =>
        panel.contains(event.target as Node) ||
        ((clickToEdit() || editing) && preview.contains(event.target as Node)),
      ignoreMutation: () => true,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      destroy() {
        stopPositioning?.();
        stopOtherPanel();
        dom.removeEventListener('tano-math-refresh', refresh);
        preview.onclick = input.oninput = input.onkeydown = input.onscroll = null;
        preview.onkeydown = null;
      },
    };
  };
}
