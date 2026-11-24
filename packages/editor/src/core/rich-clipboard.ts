import { parseReferenceUrl, referenceTypeLabel, resolveReference } from '@tano/protocol';
import type { ReferenceTarget } from '@tano/protocol';

const monospace = 'Consolas, "Courier New", monospace';
const referenceColors: Record<string, string> = {
  person: '#8855bb', task: '#308251', project: '#a9630c', event: '#3269ce', asset: '#287e83',
};
const referenceBackgrounds: Record<string, string> = {
  person: '#f1eaf7', task: '#e9f3ed', project: '#f7efe3', event: '#eaf0fb', asset: '#e8f3f3',
};

function eventDetail(target: ReferenceTarget) {
  const values = [target.properties?.start, target.properties?.end]
    .filter((value): value is string => typeof value === 'string' && !!value.trim());
  if (!values.length) return '';
  const dates = values.map(value => new Date(value));
  if (dates.some(date => !Number.isFinite(date.getTime()))) return values.join(' — ');
  const formatter = new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return dates.length === 2 && dates[0]! <= dates[1]!
    ? formatter.formatRange(dates[0]!, dates[1]!)
    : dates.map(date => formatter.format(date)).join(' — ');
}

/** Word does not load editor CSS or render its SVG controls. Export static,
 * self-contained HTML with inline styles and table-based card layouts instead. */
export function richClipboardHtml(container: HTMLElement, targets: readonly ReferenceTarget[]): string {
  const style = (selector: string, css: string) => {
    container.querySelectorAll<HTMLElement>(selector).forEach(element => {
      element.setAttribute('style', `${css};${element.getAttribute('style') ?? ''}`);
    });
  };
  container.querySelectorAll<HTMLElement>('[data-tano-reference]').forEach(element => {
    const identity = parseReferenceUrl(element.dataset.referenceUrl ?? '');
    const resolved = identity && resolveReference(targets, identity);
    const target = resolved && resolved.target;
    const type = target?.type === 'event' && target.properties?.checkable === true ? 'task' : identity?.type ?? '';
    const color = referenceColors[type] ?? referenceColors.task!;
    const name = target?.name || element.dataset.referenceLabel || element.dataset.referenceUrl || '';
    const completed = target?.properties?.completed === true || ['done', 'completed'].includes(String(target?.properties?.status));
    const label = document.createElement('span');
    label.textContent = name;
    const decoration = type === 'task' && completed ? 'text-decoration:line-through;' : '';
    if (element.dataset.tanoReference !== 'block') {
      // Use shading and semantic bold instead of symbol fonts or pill borders.
      // Bold remains recognizable even when Word merges destination formatting.
      const background = referenceBackgrounds[type] ?? referenceBackgrounds.task!;
      const css = `color:${color};background-color:${background};${decoration}`;
      const strong = document.createElement('strong');
      strong.setAttribute('style', css);
      strong.append(label);
      element.replaceChildren(document.createTextNode('\u00a0'), strong, document.createTextNode('\u00a0'));
      element.setAttribute('style', css);
      return;
    }
    // One cell avoids an icon gutter, internal grid lines and mixed baselines.
    // Keep the card neutral, with only a left accent carrying its type color.
    const table = document.createElement('table');
    table.dataset.tanoClipboardCard = '';
    table.setAttribute('cellspacing', '0');
    table.setAttribute('cellpadding', '0');
    table.setAttribute('width', '100%');
    table.setAttribute('style', 'border-collapse:collapse;border:0;margin:10pt 0;mso-table-lspace:0pt;mso-table-rspace:0pt');
    const row = table.insertRow();
    const body = row.insertCell();
    body.setAttribute('style', `border:0;border-left:solid ${color} 2pt;padding:6pt 10pt;vertical-align:top;background-color:#f8f9fb`);
    const title = document.createElement('p');
    title.setAttribute('style', 'margin:0;font-family:"Microsoft YaHei",sans-serif;font-size:11pt;line-height:16pt;color:#333333');
    const strong = document.createElement('strong');
    strong.append(label);
    const typeLabel = document.createElement('span');
    typeLabel.textContent = `\u00a0\u00a0${referenceTypeLabel(type)}`;
    typeLabel.setAttribute('style', 'font-size:9pt;color:#777777');
    title.append(strong, typeLabel);
    body.append(title);
    const detail = target && ((target.type === 'event' ? eventDetail(target) : '') || target.description || target.path);
    if (detail) {
      const paragraph = document.createElement('p');
      paragraph.setAttribute('style', 'margin:3pt 0 0;font-size:9pt;line-height:14pt;color:#777777');
      paragraph.textContent = detail;
      body.append(paragraph);
    }
    const spacer = document.createElement('p');
    spacer.setAttribute('style', 'margin:0;font-size:1pt;line-height:6pt');
    spacer.textContent = '\u00a0';
    element.replaceWith(table, spacer);
  });

  // Semantic tags alone (especially <code> and <mark>) are not sufficient for
  // Word's HTML importer. Repeat their visible formatting as inline CSS.
  style('h1', 'font-size:26pt;font-weight:bold;margin:16pt 0 10pt');
  style('h2', 'font-size:21pt;font-weight:bold;margin:14pt 0 8pt');
  style('h3', 'font-size:17pt;font-weight:bold;margin:12pt 0 6pt');
  style('h4,h5,h6', 'font-size:14pt;font-weight:bold;margin:10pt 0 6pt');
  style('a', 'color:#3269a8;text-decoration:underline');
  style('u', 'text-decoration:underline');
  style('del,s,strike', 'text-decoration:line-through');
  style('sup', 'vertical-align:super;font-size:smaller');
  style('sub', 'vertical-align:sub;font-size:smaller');
  style('mark', 'background-color:#fff2a8;mso-shading:#fff2a8');
  style('blockquote', 'border-left:solid #bfc9d4 3pt;padding-left:10pt;margin-left:12pt;color:#596573');
  style('pre', `font-family:${monospace};font-size:10pt;background-color:#f3f4f6;mso-shading:#f3f4f6;white-space:pre-wrap;padding:8pt;border:solid #d9dde3 0.5pt`);
  container.querySelectorAll<HTMLElement>('code').forEach(code => {
    const inBlock = !!code.closest('pre');
    const css = `font-family:${monospace};font-size:10pt;${inBlock ? '' : 'color:#d82760;background-color:#eeeeee;mso-shading:#eeeeee;padding:1pt 3pt;'}`;
    code.setAttribute('style', css);
    // Word may strip the HTML5 code wrapper; a styled span preserves its font
    // and shading even when that happens.
    const span = document.createElement('span');
    span.setAttribute('style', css);
    span.append(...Array.from(code.childNodes));
    code.append(span);
  });
  style('table:not([data-tano-clipboard-card])', 'border-collapse:collapse');
  container.querySelectorAll<HTMLElement>('th,td').forEach(cell => {
    if (!cell.closest('[data-tano-clipboard-card]'))
      cell.setAttribute('style', `border:solid #c8ced6 0.5pt;padding:5pt 7pt;vertical-align:top;${cell.getAttribute('style') ?? ''}`);
  });
  style('th', 'font-weight:bold;background-color:#f1f3f5;mso-shading:#f1f3f5');
  // Interactive task controls do not survive Word paste; keep their state as
  // printable characters instead.
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.replaceWith(document.createTextNode(input.checked || input.hasAttribute('checked') ? '☑ ' : '☐ '));
  });
  // A light, static document palette is independent of the app's theme and CSS.
  return `<div style="font-family:Calibri,'Microsoft YaHei',sans-serif;font-size:11pt;color:#333333;line-height:1.5">${container.innerHTML}</div>`;
}
