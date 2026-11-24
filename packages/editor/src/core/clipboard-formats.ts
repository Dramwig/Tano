import katex from 'katex';
import type { ReferenceTarget } from '@tano/protocol';
import { richClipboardHtml } from './rich-clipboard';
import { clipboardMathSVG } from './clipboard-math-svg';

export type ClipboardDestination = 'rich' | 'wechat' | 'zhihu';

/** Produce presentation MathML, not KaTeX's CSS-dependent visual DOM. */
export function formulaMathML(source: string, display: boolean): string {
  const host = document.implementation.createHTMLDocument('').createElement('div');
  host.innerHTML = katex.renderToString(source, { output: 'mathml', displayMode: display, throwOnError: true, trust: false });
  const math = host.querySelector('math');
  if (!math) throw new Error('无法转换此公式');
  // TeX annotations are unnecessary for a standalone, editable equation.
  math.querySelectorAll('annotation').forEach(annotation => annotation.remove());
  return math.outerHTML;
}

export function selectedFormulaMathML(container: HTMLElement): string {
  const formulas = container.querySelectorAll<HTMLElement>('[data-tano-math]');
  if (formulas.length !== 1) throw new Error('请选择一个公式后复制 MathML');
  const formula = formulas[0]!;
  return formulaMathML(formula.dataset.value ?? formula.textContent ?? '', formula.dataset.tanoMath === 'block');
}

/** TSV uses spreadsheet quoting so tabs, newlines and quotes stay in a cell. */
export function tableTSV(container: HTMLElement): string {
  const tables = [...container.querySelectorAll<HTMLTableElement>('table')].filter(table => !table.parentElement?.closest('table'));
  if (tables.length !== 1) throw new Error('请选择一个表格后复制 TSV');
  const table = tables[0]!;
  const grid: string[][] = [];
  const occupied = new Set<string>();
  let width = 0;
  [...table.rows].forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row.cells) {
      while (occupied.has(`${r}:${c}`)) c++;
      const rows = cell.rowSpan === 0 ? table.rows.length - r : cell.rowSpan;
      const cols = cell.colSpan;
      if ((r + rows) * (c + cols) > 100000) throw new Error('表格过大，无法复制 TSV');
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      clone.querySelectorAll('p + p').forEach(p => p.prepend('\n'));
      grid[r]![c] = clone.textContent ?? '';
      for (let y = r; y < Math.min(table.rows.length, r + rows); y++) {
        grid[y] ??= [];
        for (let x = c; x < c + cols; x++) {
          occupied.add(`${y}:${x}`);
          if (y !== r || x !== c) grid[y]![x] = '';
        }
      }
      c += cols;
      width = Math.max(width, c);
    }
  });
  const quote = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return grid.map(row => Array.from({ length: width }, (_, c) => quote(row[c] ?? '')).join('\t')).join('\r\n');
}

function cleanClipboardDOM(container: HTMLElement, destination: ClipboardDestination) {
  container.querySelectorAll('script,style,iframe,object,embed,form,button,textarea').forEach(node => node.remove());
  container.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || ['contenteditable', 'id'].includes(attr.name)) element.removeAttribute(attr.name);
    }
    for (const attr of ['href', 'src']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      let protocol = '';
      try { protocol = new URL(value, 'https://tano.invalid/').protocol; } catch { element.removeAttribute(attr); continue; }
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) &&
        !(attr === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value))) element.removeAttribute(attr);
      if ((destination === 'wechat' || destination === 'zhihu') && attr === 'href' && !/^https?:\/\//i.test(value))
        element.removeAttribute(attr);
    }
  });
}

export function destinationClipboardHTML(container: HTMLElement, targets: readonly ReferenceTarget[], destination: ClipboardDestination): string {
  // An inert document prevents equation/image URLs from loading during copy.
  // The destination application decides when to fetch them after paste.
  const inert = document.implementation.createHTMLDocument('');
  container = inert.importNode(container, true);
  cleanClipboardDOM(container, destination);
  container.querySelectorAll<HTMLElement>('[data-tano-math]').forEach(formula => {
    const source = formula.dataset.value ?? formula.textContent ?? '';
    const display = formula.dataset.tanoMath === 'block';
    if (destination === 'zhihu') {
      const image = inert.createElement('img');
      // Zhihu imports an equation from this class and its alt text. An ordinary
      // equation-service image URL is treated as a picture, not an equation.
      image.className = 'Formula-image';
      image.setAttribute('data-eeimg', 'true');
      // Omit src: Chromium's Clipboard API resolves src="" to the current
      // page URL. Zhihu's equation importer needs the marker and alt, not a URL.
      image.alt = display && !/\\tag\b/.test(source) && !source.trimEnd().endsWith('\\\\') ? `${source}\\\\` : source;
      if (display) {
        const paragraph = inert.createElement('p');
        paragraph.style.textAlign = 'center';
        paragraph.append(image);
        formula.replaceWith(paragraph);
      } else formula.replaceWith(image);
    } else if (destination === 'wechat') {
      const rendered = inert.createElement('div');
      rendered.innerHTML = clipboardMathSVG(source, display);
      const svg = rendered.querySelector('svg');
      if (!svg) throw new Error('无法转换公众号公式');
      const baseline = svg.style.verticalAlign;
      svg.style.width = svg.getAttribute('width') || 'auto';
      svg.style.height = svg.getAttribute('height') || 'auto';
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', source);
      svg.setAttribute('color', '#333333');
      const wrapper = inert.createElement(display ? 'section' : 'span');
      wrapper.setAttribute('style', display
        ? 'display:block;text-align:center;overflow-x:auto;margin:16px 0'
        : `display:inline-block;vertical-align:${baseline || 'middle'};line-height:0`);
      if (!display) svg.style.verticalAlign = '0';
      wrapper.append(svg);
      formula.replaceWith(wrapper);
    } else {
      try { formula.innerHTML = formulaMathML(source, display); }
      catch { formula.textContent = display ? `$$${source}$$` : `$${source}$`; }
    }
  });
  const html = richClipboardHtml(container, targets);
  const output = inert.createElement('div');
  output.innerHTML = html;
  if (destination === 'rich') {
    output.querySelectorAll<HTMLElement>('code, code span').forEach(code => {
      code.style.setProperty('font-family', 'Consolas, "Courier New", monospace');
      code.setAttribute('style', `${code.getAttribute('style')};mso-ascii-font-family:Consolas;mso-hansi-font-family:Consolas`);
    });
    output.querySelectorAll('p').forEach(p => p.classList.add('MsoNormal'));
  }
  if (destination === 'wechat' || destination === 'zhihu') {
    output.querySelectorAll<HTMLElement>('a').forEach(link => {
      const href = link.getAttribute('href');
      if (destination === 'wechat' && href) {
        // WeChat articles do not accept arbitrary external inline links.
        if (link.textContent !== href) link.after(document.createTextNode(`（${href}）`));
        link.removeAttribute('href');
      }
      if (!link.hasAttribute('href')) {
        const span = document.createElement('span');
        span.append(...link.childNodes);
        link.replaceWith(span);
      }
    });
    output.querySelectorAll<HTMLElement>('pre').forEach(pre => {
      pre.style.whiteSpace = 'pre';
      pre.style.overflowX = 'auto';
      pre.style.padding = '12px';
      pre.querySelectorAll<HTMLElement>('code,span').forEach(code => code.style.whiteSpace = 'pre');
    });
    output.querySelectorAll<HTMLElement>('img').forEach(img => { img.style.maxWidth = '100%'; });
    output.firstElementChild?.setAttribute('style', 'font-family:Arial,"Microsoft YaHei",sans-serif;font-size:15px;color:#333333;line-height:1.75');
  }
  // Editor identities and application attributes are never published.
  output.querySelectorAll('*').forEach(element => {
    for (const attr of [...element.attributes]) {
      if (attr.name.startsWith('data-tano') || attr.name.startsWith('data-reference') || attr.name.startsWith('data-math') || attr.name === 'data-value')
        element.removeAttribute(attr.name);
    }
  });
  return output.innerHTML;
}
