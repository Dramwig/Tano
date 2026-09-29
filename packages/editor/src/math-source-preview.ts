import type { Node } from '@milkdown/kit/prose/model';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { renderMathPreview } from './math';

/** Preserve the rendered block's spacing and typography as its source grows. */
export function sourceBlockStyle(element: globalThis.Node | null): Record<string, string> | null {
  if (!(element instanceof HTMLElement)) return null;
  const style = getComputedStyle(element);
  const textStyle = getComputedStyle(
    element.matches('pre') ? element.querySelector(':scope > code') ?? element : element,
  );
  return {
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
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

export function mathSourcePreviewView(
  inline: boolean,
  enabled: () => boolean,
  parse: (source: string) => Node | null,
  sourceStyle: (id: string) => Record<string, string> | null = () => null,
): NodeViewConstructor {
  return (node) => {
    let current = node;
    const expected = inline ? 'math_inline' : 'math_block';
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
    preview.className = 'tano-live-math-preview';
    preview.contentEditable = 'false';
    preview.setAttribute('aria-hidden', 'true');
    dom.append(contentDOM, preview);

    function render() {
      if (!inline) {
        dom.dataset.sourceKind = String(current.attrs.origin);
        dom.dataset.sourceLevel = String(current.attrs.level);
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
      if (math?.type.name !== expected) {
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
      destroy: () => dom.removeEventListener('tano-math-refresh', refresh),
    };
  };
}
