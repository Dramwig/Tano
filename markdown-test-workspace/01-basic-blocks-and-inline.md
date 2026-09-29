# Level-one heading H1

This paragraph contains English text, the number 123, and an emoji 🙂. The first line ends with a hard-break marker,\
so this line should remain in the same paragraph after a hard line break.

## Level-two heading H2

### Level-three heading H3

#### Level-four heading H4

##### Level-five heading H5

###### Level-six heading H6

Markdown can parse H5 and H6. The block menu currently offers H1 through H4 directly.

## Inline formatting

**Bold**, *italic*, ***bold italic***, `inline code`, and ~~strikethrough~~.

<u>Underline</u>, x<sup>2</sup>, H<sub>2</sub>O, <mark>highlight</mark>, and <span style="color: #db2777">colored text</span>.

Nested styles: **bold with <mark>highlight</mark> and *italic***. Escaped syntax: \*this is not italic\*.

Safe inline HTML: <abbr title="On the same page">Tano</abbr>. The block HTML below checks preview and source round-tripping:

Ordinary HTML is not currently supported by the real-time collaboration codec. This example mainly tests local rich-text preview and source preservation.

<div class="sample">
<strong>Text inside an HTML block</strong>
</div>

Autolinks: <https://example.com> and <test@example.com>.

Standard link: [Back to the guide](00-getting-started.md "Getting started").

## Quotes and lists

> A blockquote with **bold text**.
>
> A second paragraph in the quote.
>
> > A nested quote.

* Unordered item A
* Unordered item B
  * Nested item B.1
  * Nested item B.2

1. Ordered item one
2. Ordered item two
   1. Nested numbered item

* [ ] Incomplete task
* [x] Completed task

## Table

| Left aligned | Centered | Right aligned |
| :----- | :--------------------------------: | ---: |
| **Bold** | `code` | 12.5 |
| Second row | [Standard link](https://example.com "Link title") | 99 |

## Code and horizontal rule

```typescript
const message: string = 'The **asterisks** and $x$ in code must not render';
console.log(message);
```

```text
This is another fenced code block.
```

***

You can continue editing a paragraph after the horizontal rule.
