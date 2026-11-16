# Level-one heading H1

[简体中文](../zh-CN/01-基础块与行内.md) · [Guide](00-getting-started.md)

This paragraph contains English, 中文, the number 123, and an emoji 🙂. The first line ends with a hard-break marker,\
so this line remains in the same paragraph after a hard break.

## Level-two heading H2

### Level-three heading H3

#### Level-four heading H4

##### Level-five heading H5

###### Level-six heading H6

Markdown parses H5 and H6; check which heading levels the block menu offers directly.

## Inline formatting

**Bold**, *italic*, ***bold italic***, `inline code`, and ~~strikethrough~~.

<u>Underline</u>, x<sup>2</sup>, H<sub>2</sub>O, <mark>highlight</mark>, and <span style="color: #db2777">colored text</span>.

Nested styles: **bold with <mark>highlight</mark> and *italic***. Escaped syntax: \*this is not italic\*.

Safe inline HTML: <abbr title="On the same page">Tano</abbr>. The following block checks local preview and source preservation. Ordinary HTML has separate collaboration compatibility limits.

<div class="sample">
<strong>Text inside an HTML block</strong>
</div>

Autolinks: <https://example.com> and <test@example.com>.

Reference-style link: [Back to the guide][guide].

[guide]: 00-getting-started.md "Getting started"

## Quotes and lists

> A blockquote with **bold text**.
>
> A second paragraph.
>
> > A nested quote.

- Unordered item A
- Unordered item B
  - Nested item B.1
  - Nested item B.2

1. Ordered item one
2. Ordered item two
   1. Nested numbered item

- [ ] Incomplete task
- [x] Completed task

## Table

| Left aligned | Centered | Right aligned |
| :--- | :---: | ---: |
| **Bold** | `code` | 12.5 |
| Second row | [Standard link](https://example.com "Link title") | 99 |

## Code and horizontal rule

```typescript
const message: string = 'The **asterisks** and $x$ in code must not render';
console.log(message);
```

~~~text
Tilde fences also form code blocks.
~~~

---

You can continue editing after the horizontal rule.
