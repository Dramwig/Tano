# Math, Mermaid, and footnotes

[简体中文](../zh-CN/03-公式图表与脚注.md) · [Guide](00-getting-started.md)

Dollar inline math: $a^2+b^2=c^2$; LaTeX inline math: \(a^2+b^2=c^2\).

Dollar display math:

$$
E = mc^2
$$

LaTeX display math:

\[
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
\]

Inline code `$x$` and this fenced formula remain source text:

```latex
\[x^2 + y^2 = z^2\]
```

## Mermaid diagram

```mermaid
flowchart LR
  A[Markdown file] --> B[Editor]
  B --> C[Save changes]
  C --> A
```

Disable math or Mermaid to check source fallback; re-enable them to restore rendering. A rendering error should retain editable source.

## Footnotes

This sentence cites one footnote[^note] and another[^second].

[^note]: The first footnote supports **bold text** and a [link](https://example.com).
[^second]: The second checks numbering and definition matching.
