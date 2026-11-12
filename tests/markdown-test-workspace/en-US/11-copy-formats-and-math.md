# Copy formats and math recognition

[简体中文](../zh-CN/11-复制格式与公式识别.md) · [Guide](00-getting-started.md)

## One selection, several copy formats

Copy this paragraph: **key point**, *explanation*, [reference](https://example.com), and $E=mc^2$.

| Item | Quantity | Unit price |
| --- | ---: | ---: |
| Notebook | 2 | 12.5 |
| Folder | 3 | 8 |

$$
\frac{1}{2}+\frac{1}{3}=\frac{5}{6}
$$

- [ ] Try Markdown, plain text, HTML, rich text, WeChat, and Zhihu in Copy as.
- [ ] Inspect Markdown/HTML source in a text editor and formatting in a suitable rich-text editor.
- [ ] Copy MathML with a formula selected; copy TSV with a table selected and paste into a spreadsheet to check rows and columns.
- [ ] Change the device's default copy format and try Ctrl/Cmd+C. Copying must leave the document unchanged.

Rich text uses MathML for formulas; the WeChat format generates formula SVG locally; the Zhihu format supplies markers for the destination editor. Final appearance depends on that editor's paste support. A successful copy does not guarantee identical rendering on every platform.

## Recognition and saved syntax are separate

Dollar inline math: $x^2+y^2=z^2$. LaTeX inline math: \(x^2+y^2=z^2\).

\[
\sum_{i=1}^{n}i=\frac{n(n+1)}{2}
\]

In document capabilities, switch math recognition between all delimiters, dollar delimiters, and LaTeX delimiters. Only recognized delimiters should render. Unrecognized forms retain their source; switch back to all and check again. The syntax used when saving formulas is a separate setting. Disabling recognition does not delete formulas.

Code such as `$x$` and `\(x\)` stays literal. Copy preferences do not convert the document itself.
