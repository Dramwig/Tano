import DOMPurify from 'dompurify';

const blockTags = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'OL',
  'P',
  'PRE',
  'TABLE',
  'UL',
]);

function safeStyle(value: string): string | null {
  const declarations: string[] = [];
  for (const part of value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const match = /^([a-z-]+)\s*:\s*(.+)$/i.exec(part);
    if (!match) return null;
    const property = match[1].toLowerCase();
    const cssValue = match[2].toLowerCase();
    const allowed =
      (['color', 'background-color'].includes(property) &&
        /^(?:#[\da-f]{3}|#[\da-f]{6}|[a-z]{1,20})$/.test(cssValue)) ||
      (property === 'text-align' && /^(?:left|right|center|justify)$/.test(cssValue)) ||
      (property === 'font-weight' && /^(?:normal|bold|[1-9]00)$/.test(cssValue)) ||
      (property === 'font-style' && /^(?:normal|italic|oblique)$/.test(cssValue)) ||
      (property === 'text-decoration' && /^(?:none|underline|line-through)$/.test(cssValue));
    if (!allowed) return null;
    declarations.push(`${property}: ${cssValue}`);
  }
  return declarations.join('; ');
}

/** Render an HTML atom without letting document content control the editor UI. */
export function renderHtml(
  wrapper: HTMLElement,
  raw: string,
  resolveImage?: (reference: string) => string | null,
) {
  wrapper.replaceChildren();
  wrapper.className = 'tano-html-node';
  wrapper.contentEditable = 'false';
  const fragment = DOMPurify.sanitize(raw, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      'a',
      'abbr',
      'address',
      'article',
      'b',
      'blockquote',
      'br',
      'code',
      'dd',
      'del',
      'details',
      'div',
      'dl',
      'dt',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'img',
      'kbd',
      'li',
      'mark',
      'ol',
      'p',
      'pre',
      'q',
      's',
      'small',
      'span',
      'strong',
      'sub',
      'summary',
      'sup',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
    ],
    ALLOWED_ATTR: [
      'alt',
      'class',
      'colspan',
      'height',
      'href',
      'open',
      'rowspan',
      'src',
      'start',
      'style',
      'title',
      'width',
    ],
    ALLOW_DATA_ATTR: false,
  });
  // DOMPurify removes its own parsing BODY wrapper from every fragment.
  const removedContent = DOMPurify.removed.some(
    (entry) => !('element' in entry) || entry.element.nodeName !== 'BODY',
  );
  let renderable = !removedContent && fragment.hasChildNodes();
  if (renderable) {
    for (const element of fragment.querySelectorAll<HTMLElement>('[style]')) {
      const style = safeStyle(element.getAttribute('style') ?? '');
      if (style === null) {
        renderable = false;
        break;
      }
      element.setAttribute('style', style);
    }
  }
  if (renderable) {
    for (const image of fragment.querySelectorAll('img')) {
      const reference = image.getAttribute('src') ?? '';
      const url =
        resolveImage?.(reference) ??
        (!resolveImage && /^https:\/\//i.test(reference) ? reference : null);
      if (!url) {
        renderable = false;
        break;
      }
      image.src = url;
      image.referrerPolicy = 'no-referrer';
      image.loading = 'lazy';
    }
  }
  if (!renderable) {
    wrapper.classList.add('tano-html-fallback');
    wrapper.title = 'HTML 无法安全渲染，原文已保留';
    wrapper.textContent = raw;
    return;
  }
  wrapper.removeAttribute('title');
  if (
    [...fragment.childNodes].some((node) => node instanceof Element && blockTags.has(node.tagName))
  )
    wrapper.classList.add('tano-html-block');
  wrapper.append(fragment);
}
