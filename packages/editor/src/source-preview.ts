import type { Node } from '@milkdown/kit/prose/model';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { renderMathPreview } from './math';
import { defaultCapabilities } from './runtime';
import { sourcePresentation } from './runtime-views';
import type { WorkspaceCapabilities } from './runtime';
import type { MermaidRenderer } from './mermaid-preview';
import { floatingPanelPosition, observePanelPosition } from './panel-position';

/** Preserve the rendered block's spacing and typography as its source grows. */
export function sourceBlockStyle(element: globalThis.Node | null): Record<string, string> | null {
  if (!(element instanceof HTMLElement)) return null;
  const style = getComputedStyle(element);
  const textStyle = getComputedStyle(
    element.matches('pre') ? element.querySelector(':scope > code') ?? element : element,
  );
  return {
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    // Lists reserve marker space; table viewports compensate for horizontal
    // scrolling. Neither inset belongs to editable source. Leave horizontal
    // spacing to CSS so source stays on the paragraph text rail.
    ...(element.matches('ul, ol, .tano-table-viewport') ? {} : {
      marginRight: style.marginRight,
      marginLeft: style.marginLeft,
      paddingRight: style.paddingRight,
      paddingLeft: style.paddingLeft,
    }),
    borderTop: style.borderTop,
    borderRight: style.borderRight,
    borderBottom: style.borderBottom,
    borderLeft: style.borderLeft,
    borderRadius: style.borderRadius,
    backgroundColor: style.backgroundColor,
    color: textStyle.color,
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
    fontStyle: textStyle.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: textStyle.letterSpacing,
    textAlign: textStyle.textAlign,
  };
}

function applyBlockStyle(element: HTMLElement, style: Record<string, string> | null) {
  if (style) Object.assign(element.style, style);
}

export function sourcePreviewView(
  inline: boolean,
  enabled: () => boolean,
  parse: (source: string) => Node | null,
  sourceStyle: (id: string) => Record<string, string> | null = () => null,
  policy: () => WorkspaceCapabilities = () => defaultCapabilities,
  mermaid?: { enabled: () => boolean; render: MermaidRenderer },
): NodeViewConstructor {
  return (node, view) => {
    let current = node;
    const diagram = !inline && node.attrs.origin === 'code_block' && !!mermaid;
    const expected = diagram ? 'code_block' : inline ? 'math_inline' : 'math_block';
    const dom = document.createElement(inline ? 'span' : 'pre');
    dom.className = inline ? 'tano-live-source-inline' : 'tano-live-source-block';
    dom.setAttribute(inline ? 'data-tano-live-inline-source' : 'data-tano-live-source', '');
    if (!inline) {
      const style = sourceStyle(String(node.attrs.id));
      applyBlockStyle(dom, style);
      if (node.attrs.origin === 'code_block' && style) {
        dom.style.setProperty('--tano-code-fence-line-height', style.paddingTop);
        dom.style.setProperty('--tano-code-body-line-height', style.lineHeight);
        dom.style.paddingTop = '0';
        dom.style.paddingBottom = '0';
      }
    }
    if (node.attrs.origin !== expected) {
      if (!inline) {
        dom.dataset.sourceKind = String(node.attrs.origin);
        dom.dataset.sourceLevel = String(node.attrs.level);
      }
      const contentDOM = inline ? dom : document.createElement('code');
      if (!inline) dom.append(contentDOM);
      return {
        dom,
        contentDOM,
        update(next) {
          return next.type === node.type && next.attrs.id === node.attrs.id &&
            next.attrs.origin === node.attrs.origin && next.attrs.level === node.attrs.level;
        },
      };
    }
    const contentDOM = document.createElement(inline ? 'span' : 'code');
    const preview = document.createElement('span');
    preview.className = diagram ? 'tano-live-mermaid-preview' : 'tano-live-math-preview';
    preview.contentEditable = 'false';
    preview.setAttribute('aria-hidden', 'true');
    preview.hidden = true;
    dom.append(contentDOM, preview);

    let generation = 0;
    let diagramSource: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const position = () => {
      if (!diagram || preview.hidden) return;
      // Measure against the editor pane as well as the window, including split
      // views and an open sidebar on a narrow display.
      floatingPanelPosition(dom, preview);
      const availableWidth = Math.min(640, parseFloat(preview.style.getPropertyValue('--tano-panel-available-width')));
      const availableHeight = parseFloat(preview.style.getPropertyValue('--tano-panel-available-height'));
      const svg = preview.querySelector('svg');
      const box = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      if (svg && box && box[2]! > 0 && box[3]! > 0) {
        const scale = Math.max(0.01, Math.min(1, (availableWidth - 24) / box[2]!, Math.min(320, window.innerHeight * 0.4, availableHeight - 16) / box[3]!));
        // Mermaid emits width="100%". Give the shrink-to-fit tooltip an
        // intrinsic size and preserve the diagram's aspect ratio on resize.
        svg.style.width = `${box[2]! * scale}px`;
        svg.style.height = `${box[3]! * scale}px`;
      }
      const offset = (dom.getBoundingClientRect().width - preview.getBoundingClientRect().width) / 2;
      const { x, y } = floatingPanelPosition(dom, preview, offset);
      preview.style.left = `${x}px`;
      preview.style.top = `${y}px`;
    };
    const stopPositioning = diagram ? observePanelPosition(position) : undefined;
    const resizeObserver = diagram && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : undefined;
    resizeObserver?.observe(view.dom);
    resizeObserver?.observe(dom);
    function hideDiagram() {
      generation++;
      clearTimeout(timer);
      diagramSource = undefined;
      preview.hidden = true;
      preview.replaceChildren();
    }
    function renderDiagram(source: string) {
      if (source === diagramSource) { position(); return; }
      diagramSource = source;
      clearTimeout(timer);
      const request = ++generation;
      // Let incomplete keystrokes settle before asking Mermaid to lay out SVG.
      timer = setTimeout(async () => {
        try {
          const result = mermaid!.render(source, view.dom.clientWidth, 'dark');
          const svg = typeof result === 'string' ? result : await result;
          if (request !== generation) return;
          preview.innerHTML = svg;
          preview.classList.remove('tano-mermaid-preview-stale');
          preview.hidden = false;
          position();
        } catch {
          if (request !== generation) return;
          // Retain the last valid diagram while its replacement is incomplete.
          preview.classList.add('tano-mermaid-preview-stale');
        }
      }, 180);
    }
    function render() {
      if (!inline) {
        dom.dataset.sourceKind = String(current.attrs.origin);
        dom.dataset.sourceLevel = String(current.attrs.level);
      }
      if (diagram) {
        const parsed = mermaid!.enabled() && policy().features.mermaid ? parse(current.textContent) : null;
        const code = parsed?.childCount === 1 ? parsed.firstChild : null;
        if (code?.type.name === 'code_block' && String(code.attrs.language).toLowerCase() === 'mermaid' && code.textContent.trim())
          renderDiagram(code.textContent);
        else hideDiagram();
        return;
      }
      if (!enabled() || current.attrs.origin !== expected) {
        preview.hidden = true;
        return;
      }
      const parsed = parse(current.textContent);
      const math = inline
        ? parsed?.childCount === 1 &&
          parsed.firstChild?.type.name === 'paragraph' &&
          parsed.firstChild.childCount === 1
          ? parsed.firstChild.firstChild
          : null
        : parsed?.childCount === 1
          ? parsed.firstChild
          : null;
      if (math?.type.name !== expected || sourcePresentation(math, policy())) {
        preview.hidden = true;
        return;
      }
      renderMathPreview(String(math.attrs.value), preview, !inline);
      preview.hidden = false;
    }

    const refresh = () => render();
    dom.addEventListener('tano-math-refresh', refresh);
    render();
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== current.type || next.attrs.id !== current.attrs.id ||
            next.attrs.origin !== expected) return false;
        current = next;
        render();
        return true;
      },
      ignoreMutation: (mutation) => !contentDOM.contains(mutation.target),
      destroy() {
        generation++;
        clearTimeout(timer);
        stopPositioning?.();
        resizeObserver?.disconnect();
        dom.removeEventListener('tano-math-refresh', refresh);
      },
    };
  };
}
