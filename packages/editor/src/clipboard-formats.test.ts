// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { destinationClipboardHTML, formulaMathML, selectedFormulaMathML, tableTSV } from './clipboard-formats';

function dom(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('clipboard destination formats', () => {
  it('exports editable MathML for fractions, matrices and inline formulas', () => {
    const fraction = dom(formulaMathML('\\frac{1}{2}', false));
    expect(fraction.querySelector('math')?.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    expect(fraction.querySelector('mfrac')).not.toBeNull();
    expect(fraction.querySelector('annotation,.katex-html')).toBeNull();
    expect(dom(formulaMathML('\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}', true)).querySelectorAll('mtr')).toHaveLength(2);
    expect(dom(selectedFormulaMathML(dom('<p>公式 <span data-tano-math="inline" data-value="x^2"></span></p>'))).querySelector('msup')).not.toBeNull();
    expect(() => selectedFormulaMathML(dom('<p>普通文字</p>'))).toThrow('请选择一个公式');
    expect(() => selectedFormulaMathML(dom('<span data-tano-math></span><span data-tano-math></span>'))).toThrow('请选择一个公式');
    expect(() => formulaMathML('\\frac{', false)).toThrow();
  });

  it('gives Word code font hints and MathML while removing editor identities', () => {
    const output = dom(destinationClipboardHTML(dom('<p><code>.tano/objects/</code><span data-tano-math="inline" data-value="x^2">x^2</span></p>'), [], 'rich'));
    expect(output.querySelector('p')?.className).toBe('MsoNormal');
    expect(output.querySelector('code')?.getAttribute('style')).toContain('mso-ascii-font-family:Consolas');
    expect(output.querySelector('code span')?.getAttribute('style')).toContain('background-color');
    expect(output.querySelector('msup')).not.toBeNull();
    expect(output.querySelector('[data-tano-math],[data-value]')).toBeNull();
  });

  it('adapts external links, code indentation and formulas to the publishing destination', () => {
    const source = '<p><a href="https://example.com/a">参考</a> <a href="object://person/e82f91">内部</a></p>'
      + '<pre><code>const x = 1;\n  next();</code></pre><span data-tano-math="inline" data-value="x^2 + y"></span>';
    const wechat = dom(destinationClipboardHTML(dom(source), [], 'wechat'));
    expect(wechat.textContent).toContain('参考（https://example.com/a）');
    expect(wechat.querySelector('a')).toBeNull();
    expect(wechat.querySelector('svg')?.getAttribute('aria-label')).toBe('x^2 + y');
    expect(wechat.querySelector('svg path')).not.toBeNull();
    expect(wechat.querySelector('svg use,mjx-container,math')).toBeNull();
    expect(wechat.querySelector('pre')?.textContent).toBe('const x = 1;\n  next();');
    const zhihu = dom(destinationClipboardHTML(dom(source), [], 'zhihu'));
    expect(zhihu.querySelector('a')?.href).toBe('https://example.com/a');
    const equation = zhihu.querySelector('img')!;
    expect(equation.className).toBe('Formula-image');
    expect(equation.getAttribute('data-eeimg')).toBe('true');
    expect(equation.alt).toBe('x^2 + y');
    expect(equation.hasAttribute('src')).toBe(false);
  });

  it('keeps object display names and removes executable content and unsafe links', () => {
    const output = dom(destinationClipboardHTML(dom('<script>alert(1)</script><p onclick="alert(1)"><a href="java&#10;script:alert(1)">链接</a>'
      + '<span data-tano-reference="inline" data-reference-url="object://person/e82f91"></span></p>'),
    [{ workspace: 'test', type: 'person', id: 'e82f91', name: '测试人物', path: '' }], 'wechat'));
    expect(output.textContent).toContain('测试人物');
    expect(output.querySelector('script,[onclick],a,[data-reference-url]')).toBeNull();
  });

  it('distinguishes Zhihu display equations and tagged equations without external image requests', () => {
    const source = dom('<p>inline <span data-tano-math="inline"></span></p><div data-tano-math="block"></div><div data-tano-math="block"></div>');
    const formulas = source.querySelectorAll<HTMLElement>('[data-tano-math]');
    formulas[0]!.dataset.value = 'a^2+b^2=c^2';
    formulas[1]!.dataset.value = 'E = mc^2';
    formulas[2]!.dataset.value = 'x = y \\tag{1}';
    const result = dom(destinationClipboardHTML(source, [], 'zhihu'));
    const images = [...result.querySelectorAll<HTMLImageElement>('img.Formula-image')];
    expect(images.map(image => image.alt)).toEqual(['a^2+b^2=c^2', 'E = mc^2\\\\', 'x = y \\tag{1}']);
    expect(images.every(image => !image.hasAttribute('src') && image.dataset.eeimg === 'true')).toBe(true);
    expect(images[0]!.parentElement!.textContent).toContain('inline');
    expect(images[1]!.parentElement!.style.textAlign).toBe('center');
  });

  it('exports standalone WeChat SVGs for inline formulas, fractions and matrices without shared fonts', () => {
    const source = dom('<p>inline <span data-tano-math="inline"></span></p><div data-tano-math="block"></div><div data-tano-math="block"></div>');
    const formulas = source.querySelectorAll<HTMLElement>('[data-tano-math]');
    formulas[0]!.dataset.value = 'a^2+b^2=c^2';
    formulas[1]!.dataset.value = '\\frac{1}{2}';
    formulas[2]!.dataset.value = '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}';
    const result = dom(destinationClipboardHTML(source, [], 'wechat'));
    const svgs = [...result.querySelectorAll('svg')];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg.querySelector('path')).not.toBeNull();
      expect(svg.querySelector('use,image,script,foreignObject')).toBeNull();
      expect(svg.style.width).toMatch(/ex$/);
      expect(svg.style.height).toMatch(/ex$/);
      expect(svg.hasAttribute('width')).toBe(false);
    }
    expect(svgs[0]!.parentElement!.style.display).toBe('inline-block');
    expect(svgs[1]!.parentElement!.tagName).toBe('SECTION');
    expect(svgs[2]!.querySelector('[data-mml-node="mtable"]')).not.toBeNull();
    expect(() => destinationClipboardHTML(dom('<span data-tano-math="inline" data-value="\\frac{"></span>'), [], 'wechat')).toThrow('无法转换公众号公式');
  });

  it('preserves spreadsheet cell boundaries, multiline text, quotes and merged spans', () => {
    const source = dom('<table><tr><th colspan="2">标题</th><th>C</th></tr>'
      + '<tr><td rowspan="2">A</td><td>第一行<br>第二行</td><td>"quoted"\ttext</td></tr>'
      + '<tr><td><p>甲</p><p>乙</p></td><td>尾</td></tr></table>');
    expect(tableTSV(source)).toBe('标题\t\tC\r\nA\t"第一行\n第二行"\t"""quoted""\ttext"\r\n\t"甲\n乙"\t尾');
    expect(() => tableTSV(dom('<p>不是表格</p>'))).toThrow('请选择一个表格');
    expect(() => tableTSV(dom('<table></table><table></table>'))).toThrow('请选择一个表格');
  });

  it('retains invalid formula source instead of losing it during document copy', () => {
    const output = dom(destinationClipboardHTML(dom('<span data-tano-math="inline" data-value="\\frac{"></span>'), [], 'rich'));
    expect(output.textContent).toBe('$\\frac{$');
  });
});
