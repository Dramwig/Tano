import { DOMSerializer } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import DOMPurify from 'dompurify';
import type { WorkspaceCapabilities } from './runtime';
import { mermaidHighlightRanges } from './mermaid-highlight';
import { floatingPanelPosition, observePanelPosition, positionAnchoredPanel } from './panel-position';
import type { PanelSide } from './panel-position';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, createEditorTrigger, onOtherEditorPanel } from './editor-panel';
import { matchingCodeLanguages } from './code-languages';
import type { CodeLanguage } from './code-languages';

export function sourcePresentation(node: Node, policy: WorkspaceCapabilities) {
  const features = policy.features;
  switch (node.type.name) {
    case 'math_inline':
    case 'math_block':
      return !features.math;
    case 'tano_wiki_link':
      return !features.wikiLink;
    case 'footnote_definition':
    case 'footnote_reference':
      return !features.footnotes;
    case 'html':
      return !features.html;
    case 'tano_embed':
      return !features.embed;
    case 'tano_toggle':
    case 'tano_tabs':
    case 'tano_columns':
    case 'tano_file':
      return !features.enhanced;
    default:
      return false;
  }
}

/** A presentation fallback, not a different document schema. Collaboration sees identical nodes. */
export function runtimeViews(
  views: Record<string, NodeViewConstructor>,
  policy: () => WorkspaceCapabilities,
  serialize: (node: Node) => string,
  editSource: () => void,
): Record<string, NodeViewConstructor> {
  const result = { ...views };
  for (const name of [
    'math_inline',
    'math_block',
    'tano_wiki_link',
    'footnote_definition',
    'footnote_reference',
    'html',
    'tano_embed',
    'tano_toggle',
    'tano_tabs',
    'tano_columns',
    'tano_file',
  ]) {
    const original = views[name];
    result[name] = (node, view, getPos, decorations, innerDecorations) => {
      const fallback = sourcePresentation(node, policy());
      if (!fallback) {
        const rendered =
          original?.(node, view, getPos, decorations, innerDecorations) ??
          DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
        const update = 'update' in rendered ? rendered.update : undefined;
        return {
          ...rendered,
          update(next, nextDecorations, nextInner) {
            if (next.type !== node.type || sourcePresentation(next, policy()))
              return false;
            return update ? update(next, nextDecorations, nextInner) : next.sameMarkup(node);
          },
        };
      }
      const dom = document.createElement(node.isInline ? 'span' : 'div');
      dom.className = 'tano-feature-source';
      dom.contentEditable = 'false';
      dom.title = '以源码显示 · 双击进入源码编辑';
      dom.ondblclick = (event) => {
        event.preventDefault();
        editSource();
      };
      const code = document.createElement(node.isInline ? 'code' : 'pre');
      dom.append(code);
      code.textContent = serialize(node).trimEnd();
      return {
        dom,
        update(next) {
          if (next.type !== node.type || !sourcePresentation(next, policy()))
            return false;
          code.textContent = serialize(next).trimEnd();
          return true;
        },
        ignoreMutation: () => true,
        destroy() {
          dom.ondblclick = null;
        },
      };
    };
  }
  return result;
}

let diagramId = 0;
let codeLanguageMenuId = 0;
export function mermaidView(
  enabled: () => boolean,
  readonly: () => boolean,
  revealMarkdown: () => boolean,
): NodeViewConstructor {
  return (node, view, getPos) => {
    const isDiagram = node.attrs.language?.toLowerCase() === 'mermaid' && enabled();
    if (!isDiagram) {
      const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
      const block = dom as HTMLElement;
      block.classList.add('tano-code-block');
      const language = document.createElement('input');
      language.className = 'tano-code-language';
      language.type = 'text';
      language.setAttribute('aria-label', '代码语言');
      language.placeholder = '纯文本';
      language.spellcheck = false;
      language.autocomplete = 'off';
      language.contentEditable = 'false';
      language.setAttribute('role', 'combobox');
      language.setAttribute('aria-autocomplete', 'list');
      language.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');
      menu.className = 'tano-code-language-menu';
      menu.id = `tano-code-language-menu-${++codeLanguageMenuId}`;
      const results = document.createElement('div');
      results.className = 'tano-code-language-results';
      results.id = `${menu.id}-results`;
      results.setAttribute('role', 'listbox');
      results.setAttribute('aria-label', '代码语言选项');
      menu.append(results);
      language.setAttribute('aria-controls', results.id);
      block.append(language);
      let currentNode = node;
      let submitted = String(node.attrs.language ?? '');
      let menuOpen = false;
      let filterText = '';
      let activeIndex = -1;
      let options: readonly Pick<CodeLanguage, 'id' | 'label' | 'icon'>[] = [];
      let stopPositioning: (() => void) | undefined;
      function name(value: string) {
        return value.trim().split(/\s+/, 1)[0] ?? '';
      }
      function positionMenu() {
        if (!menuOpen) return;
        const { x, y } = floatingPanelPosition(language, menu, 0, false);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
      }
      function setActive(index: number, scroll = false) {
        activeIndex = index;
        for (const [optionIndex, option] of [...results.children].entries()) {
          const selected = optionIndex === index;
          option.classList.toggle('tano-code-language-option-active', selected);
          option.setAttribute('aria-selected', String(selected));
        }
        const active = index >= 0 ? results.children[index] as HTMLElement | undefined : undefined;
        if (active) {
          language.setAttribute('aria-activedescendant', active.id);
          if (scroll) active.scrollIntoView?.({ block: 'nearest' });
        } else language.removeAttribute('aria-activedescendant');
      }
      function renderMenu() {
        if (!menuOpen) return;
        const query = filterText;
        const matches = matchingCodeLanguages(query);
        options = matches.length
          ? matches
          : [{ id: query, label: `使用“${query}”作为自定义语言` }];
        const fragment = document.createDocumentFragment();
        options.forEach((choice, index) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'tano-code-language-option';
          option.id = `${menu.id}-option-${index}`;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', 'false');
          option.tabIndex = -1;
          const icon = document.createElement('span');
          icon.className = 'tano-code-language-icon';
          icon.setAttribute('aria-hidden', 'true');
          if (choice.icon) {
            const image = document.createElement('img');
            image.src = choice.icon;
            image.alt = '';
            image.loading = 'lazy';
            icon.append(image);
          }
          const label = document.createElement('span');
          label.className = 'tano-code-language-label';
          label.textContent = choice.label;
          const id = document.createElement('span');
          id.className = 'tano-code-language-id';
          id.textContent = choice.id;
          option.append(icon, label, id);
          option.onmousedown = (event) => event.preventDefault();
          option.onclick = () => choose(choice.id);
          option.onmousemove = () => setActive(index);
          fragment.append(option);
        });
        results.replaceChildren(fragment);
        setActive(query ? 0 : -1);
        positionMenu();
      }
      function openMenu(query = '') {
        if (readonly() || revealMarkdown()) return;
        if (!menuOpen) {
          menuOpen = true;
          document.body.append(menu);
          language.setAttribute('aria-expanded', 'true');
          stopPositioning = observePanelPosition(positionMenu);
        }
        filterText = query;
        renderMenu();
      }
      function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        menu.remove();
        stopPositioning?.();
        stopPositioning = undefined;
        language.setAttribute('aria-expanded', 'false');
        language.removeAttribute('aria-activedescendant');
      }
      function refresh() {
        block.toggleAttribute('data-empty-code', currentNode.textContent.length === 0);
        language.hidden = readonly() || revealMarkdown();
        if (language.hidden) closeMenu();
        if (document.activeElement !== language)
          language.value = name(String(currentNode.attrs.language ?? ''));
      }
      function editEmptyCode(event: MouseEvent) {
        if (event.button !== 0 || readonly() || revealMarkdown() || currentNode.textContent ||
            language.contains(event.target as globalThis.Node)) return;
        const pos = getPos();
        if (pos === undefined) return;
        const tr = view.state.tr.insertText('\n', pos + 1);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        view.dispatch(tr);
        view.focus();
        event.preventDefault();
      }
      function commit() {
        if (readonly() || revealMarkdown()) return;
        const nextName = name(language.value);
        const previous = String(currentNode.attrs.language ?? '');
        const previousName = name(previous);
        const next = nextName ? nextName + (previousName ? previous.slice(previousName.length) : '') : '';
        if (next === submitted) return;
        const pos = getPos();
        if (pos === undefined) return;
        submitted = next;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, language: next }));
      }
      function choose(value: string) {
        language.value = value;
        commit();
        closeMenu();
        view.focus();
      }
      language.onfocus = () => openMenu();
      language.onclick = () => { if (!menuOpen) openMenu(); };
      language.oninput = () => openMenu(name(language.value));
      language.onblur = () => {
        closeMenu();
        commit();
      };
      language.onkeydown = (event) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!menuOpen) openMenu();
          if (options.length)
            setActive(event.key === 'ArrowDown'
              ? Math.min(options.length - 1, activeIndex + 1)
              : activeIndex <= 0 ? options.length - 1 : activeIndex - 1, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          language.value = name(String(currentNode.attrs.language ?? ''));
          closeMenu();
          view.focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (menuOpen && activeIndex >= 0) choose(options[activeIndex]!.id);
          else {
            commit();
            closeMenu();
            view.focus();
          }
        }
      };
      block.addEventListener('tano-math-refresh', refresh);
      block.addEventListener('click', editEmptyCode);
      refresh();
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type || (next.attrs.language?.toLowerCase() === 'mermaid' && enabled()))
            return false;
          currentNode = next;
          submitted = String(next.attrs.language ?? '');
          if (submitted) block.dataset.language = submitted;
          else delete block.dataset.language;
          refresh();
          return true;
        },
        stopEvent: (event) => language.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type === 'selection'
            ? document.activeElement === language
            : mutation.target === language || language.contains(mutation.target),
        destroy() {
          closeMenu();
          block.removeEventListener('tano-math-refresh', refresh);
          block.removeEventListener('click', editEmptyCode);
          language.onfocus = language.onclick = language.oninput = language.onblur = language.onkeydown = null;
        },
      };
    }
    const dom = document.createElement('div');
    dom.className = 'tano-mermaid';
    dom.contentEditable = 'false';
    const preview = document.createElement('div');
    preview.className = 'tano-mermaid-preview';
    const edit = createEditorTrigger('tano-mermaid-edit-trigger', '编辑 Mermaid 图表');
    const panel = createEditorPanel('div', 'tano-mermaid-editor-panel', '编辑 Mermaid 图表');
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Mermaid 源码');
    input.placeholder = 'Esc 或点击外部关闭';
    input.rows = 1;
    input.wrap = 'off';
    input.spellcheck = false;
    const field = document.createElement('div');
    field.className = 'tano-mermaid-editor-input';
    const highlight = document.createElement('div');
    highlight.className = 'tano-mermaid-editor-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    field.append(highlight, input);
    panel.append(field);
    dom.append(preview, edit, panel);
    let currentNode = node;
    let editing = false;
    let stopPositioning: (() => void) | undefined;
    let panelSide: PanelSide | undefined;
    let generation = 0;
    let last: string | undefined;
    function renderSource() {
      const source = input.value;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const { from, to, kind } of mermaidHighlightRanges(source)) {
        if (from > offset) fragment.append(document.createTextNode(source.slice(offset, from)));
        const token = document.createElement('span');
        token.className = `tano-mermaid-token-${kind}`;
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
    async function render(value: string) {
      if (value === last) return;
      last = value;
      const current = ++generation;
      if (!value.trim()) {
        preview.innerHTML = '<span class="tano-mermaid-placeholder" aria-hidden="true">Mermaid 图表</span>';
        preview.classList.add('tano-mermaid-preview-empty');
        preview.classList.remove('tano-mermaid-preview-stale');
        preview.title = '';
        if (editing) positionPanel();
        return;
      }
      if (preview.classList.contains('tano-mermaid-preview-empty')) preview.replaceChildren();
      preview.classList.remove('tano-mermaid-preview-empty');
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          htmlLabels: false,
        });
        const result = await mermaid.render(`tano-diagram-${++diagramId}`, value);
        if (current === generation) {
          preview.innerHTML = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
          preview.classList.remove('tano-mermaid-preview-stale');
          preview.title = '';
          if (editing) positionPanel();
        }
      } catch {
        if (current === generation) {
          if (!preview.querySelector('svg')) preview.textContent = '图表暂无法渲染，源码已保留';
          preview.classList.add('tano-mermaid-preview-stale');
          preview.title = '图表尚未完成，显示上一次有效预览';
          if (editing) positionPanel();
        }
      }
    }
    function refresh() {
      if (editing && readonly()) {
        editing = false;
        panelSide = undefined;
        stopPositioning?.();
        stopPositioning = undefined;
      }
      if (input.value !== currentNode.textContent) input.value = currentNode.textContent;
      renderSource();
      input.readOnly = readonly();
      edit.hidden = editing || !revealMarkdown() || readonly();
      panel.hidden = !editing;
      preview.tabIndex = readonly() ? -1 : 0;
      preview.setAttribute('role', readonly() ? 'img' : 'button');
      preview.setAttribute('aria-label', readonly() ? 'Mermaid 图表' : '编辑 Mermaid 图表');
      dom.classList.toggle('tano-mermaid-click-to-edit', !revealMarkdown() && !readonly());
      dom.classList.toggle('tano-editor-active', editing);
      void render(currentNode.textContent);
      if (editing) positionPanel();
    }
    function positionPanel() {
      const bounds = dom.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      panelSide = positionAnchoredPanel(dom, panel, (bounds.width - width) / 2, panelSide);
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
        if (!readonly() && input.value !== currentNode.textContent) {
          const content = input.value ? view.state.schema.text(input.value) : undefined;
          tr.replaceWith(pos + 1, pos + currentNode.nodeSize - 1, content ?? []);
        }
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
      refresh();
      if (refocus) view.focus();
    }
    function openPanel() {
      if (readonly() || editing) return;
      announceEditorPanel(view.dom, dom);
      editing = true;
      panelSide = undefined;
      refresh();
      stopPositioning = activateEditorPanel({ panel, anchor: dom, position: positionPanel, close: () => finish(false) });
      input.focus();
    }
    edit.onclick = openPanel;
    preview.onclick = () => {
      if (editing) finish(false);
      else if (!revealMarkdown()) openPanel();
    };
    preview.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (editing) finish(false);
      else openPanel();
    };
    input.oninput = () => {
      renderSource();
      if (readonly()) return;
      const pos = getPos();
      if (pos === undefined) return;
      const content = input.value ? view.state.schema.text(input.value) : undefined;
      view.dispatch(
        view.state.tr.replaceWith(pos + 1, pos + currentNode.nodeSize - 1, content ?? []),
      );
    };
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    input.onscroll = () => {
      highlight.scrollTop = input.scrollTop;
      highlight.scrollLeft = input.scrollLeft;
    };
    dom.addEventListener('tano-math-refresh', refresh);
    const stopOtherPanel = onOtherEditorPanel(view.dom, dom, () => finish(false));
    refresh();
    return {
      dom,
      update(next) {
        if (
          next.type !== node.type ||
          next.attrs.language?.toLowerCase() !== 'mermaid' ||
          !enabled()
        )
          return false;
        currentNode = next;
        refresh();
        return true;
      },
      stopEvent: (event) =>
        panel.contains(event.target as globalThis.Node) ||
        event.target === edit ||
        ((!revealMarkdown() || editing) && preview.contains(event.target as globalThis.Node)),
      ignoreMutation: () => true,
      destroy() {
        generation++;
        stopPositioning?.();
        stopOtherPanel();
        dom.removeEventListener('tano-math-refresh', refresh);
        edit.onclick = preview.onclick = preview.onkeydown = input.oninput = input.onkeydown = input.onscroll = null;
      },
    };
  };
}
