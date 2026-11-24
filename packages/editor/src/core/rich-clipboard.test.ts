// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { richClipboardHtml } from './rich-clipboard';
import type { ReferenceTarget } from '@tano/protocol';

const targets: ReferenceTarget[] = [
  { workspace: 'test', type: 'person', id: 'e82f91', name: '测试人物', path: '' },
  { workspace: 'test', type: 'task', id: 'f82f91', name: '检查渲染', path: '', properties: { completed: true } },
  { workspace: 'test', type: 'event', id: '282f91', name: '验收会议', path: '', properties: { start: '2026-09-26T10:00:00+08:00', end: '2026-09-26T11:00:00+08:00' } },
];

function exportHtml(html: string) {
  const source = document.createElement('div');
  source.innerHTML = html;
  const output = document.createElement('div');
  output.innerHTML = richClipboardHtml(source, targets);
  return output;
}

describe('portable rich clipboard HTML', () => {
  it('carries code font, color and shading without relying on editor CSS', () => {
    const output = exportHtml('<p>目录 <code>.tano/objects/</code></p><pre><code>const x = 1;\n  next();</code></pre>');
    const inline = output.querySelector('p code span') as HTMLElement;
    expect(inline.textContent).toBe('.tano/objects/');
    expect(inline.style.fontFamily).toContain('Consolas');
    expect(inline.style.color).toBe('rgb(216, 39, 96)');
    expect(inline.style.backgroundColor).toBe('rgb(238, 238, 238)');
    expect(inline.getAttribute('style')).toContain('mso-shading');
    expect(output.querySelector('pre')!.textContent).toBe('const x = 1;\n  next();');
  });

  it('exports inline references as shaded bold names without substitute icons or boxes', () => {
    const output = exportHtml('<p><span data-tano-reference="inline" data-reference-url="object://person/e82f91"></span> <span data-tano-reference="inline" data-reference-url="object://task/f82f91"></span></p>');
    const person = output.querySelector<HTMLElement>('[data-reference-url="object://person/e82f91"]')!;
    expect(person.textContent?.trim()).toBe('测试人物');
    expect(person.style.color).toBe('rgb(136, 85, 187)');
    expect(person.style.borderStyle).toBe('');
    expect(person.style.backgroundColor).toBe('rgb(241, 234, 247)');
    expect(person.querySelector('strong')?.textContent).toBe('测试人物');
    const task = output.querySelector<HTMLElement>('[data-reference-url="object://task/f82f91"]')!;
    expect(task.textContent?.trim()).toBe('检查渲染');
    expect(task.querySelector('strong')?.textContent).toBe('检查渲染');
    expect(task.style.textDecoration).toBe('line-through');
  });

  it('exports object cards as Word-compatible tables, including event details', () => {
    const output = exportHtml('<div data-tano-reference="block" data-reference-url="object://event/282f91"></div>');
    const table = output.querySelector('table')!;
    expect(table.getAttribute('width')).toBe('100%');
    expect(table.rows[0]!.cells).toHaveLength(1);
    expect(table.rows[0]!.cells[0]!.style.borderLeftWidth).toBe('2pt');
    expect(table.rows[0]!.cells[0]!.style.borderTopWidth).toBe('0px');
    expect(table.nextElementSibling?.textContent).toBe('\u00a0');
    expect(table.querySelector('strong')!.textContent).toBe('验收会议');
    expect(table.textContent).toContain('2026');
    expect(table.textContent).toContain('事件');
    expect(output.querySelector('button,svg')).toBeNull();
  });

  it('keeps names and descriptions as text and preserves unavailable references', () => {
    const source = document.createElement('div');
    source.innerHTML = '<span data-tano-reference="inline" data-reference-url="object://person/e82f91"></span><span data-tano-reference="inline" data-reference-url="object://person/000000"></span>';
    const html = richClipboardHtml(source, [{ ...targets[0]!, name: '<img src=x onerror=alert(1)>' }]);
    expect(html).toContain('&lt;img');
    expect(html).toContain('object://person/000000');
    expect(source.querySelector('img')).toBeNull();
  });

  it('exports visible formatting for headings, highlights, tables and checklists', () => {
    const output = exportHtml('<h1>标题</h1><p><mark>高亮</mark> <del>删除</del> <u>下划线</u></p><blockquote>引用</blockquote><table><tr><th>标题</th><td>内容</td></tr></table><ul><li><input type="checkbox" checked>完成</li><li><input type="checkbox">待办</li></ul>');
    expect(output.querySelector<HTMLElement>('h1')!.style.fontSize).toBe('26pt');
    expect(output.querySelector<HTMLElement>('mark')!.style.backgroundColor).not.toBe('');
    expect(output.querySelector<HTMLElement>('td')!.style.borderStyle).toBe('solid');
    expect(output.querySelector<HTMLElement>('blockquote')!.style.borderLeftStyle).toBe('solid');
    expect(output.querySelector('ul')!.textContent).toContain('☑ 完成');
    expect(output.querySelector('ul')!.textContent).toContain('☐ 待办');
    expect(output.querySelector('input')).toBeNull();
  });
});
