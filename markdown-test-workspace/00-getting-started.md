---
title: "Tano Markdown Test Workspace"
tags: [testing, Markdown, workspace]
created: "2026-09-26"
---

# Tano Markdown Test Workspace

This folder is a standalone **local workspace**. In the desktop app, select "Open workspace folder" and choose this folder. The browser `/demo` uses browser storage and cannot read these files directly. Feel free to edit these test copies; restore this directory from Git when you want to start again.

## File guide

| File | What to check |
| --- | --- |
| [01-basic-blocks-and-inline.md](01-basic-blocks-and-inline.md) | Headings, paragraphs, lists, quotes, tables, code, rules, and inline styles |
| [02-yaml-properties.md](02-yaml-properties.md) | YAML frontmatter value types, date fields, and source preservation |
| [03-math-diagrams-and-footnotes.md](03-math-diagrams-and-footnotes.md) | Dollar and LaTeX math, Mermaid, and footnotes |
| [04-enhanced-blocks.md](04-enhanced-blocks.md) | Five callout types, toggles, tabs, columns, file cards, and embeds |
| [05-links-images-and-attachments.md](05-links-images-and-attachments.md) | Standard links, Wiki links, relative images, and local attachments |
| [06-object-references.md](06-object-references.md) | Level 2 inline references and standalone object cards |
| [07-source-preservation-boundaries.md](07-source-preservation-boundaries.md) | Raw source preservation for unsupported syntax |
| [nested-folder/target-document.markdown](nested-folder/target-document.markdown) | Nested paths, the `.markdown` extension, and cross-file navigation |

## Supported-format checklist

| Category | Formats to check |
| --- | --- |
| Basic blocks | H1-H6 headings, paragraphs, quotes, unordered/ordered/task lists, fenced code, images, GFM tables, Mermaid, horizontal rules, and display math |
| Basic inline | Bold, italic, inline code, standard/reference/autolinks, strikethrough, inline math, footnote references and definitions, escapes, and line breaks |
| Text extensions | Underline `<u>`, superscript `<sup>`, subscript `<sub>`, highlight `<mark>`, and restricted color `<span style="color: #RGB/#RRGGBB">` |
| Document links | `[[document]]`, `[[folder/document\|alias]]`, and `[[document#heading]]`; use Wiki links for documents and standard links for attachments |
| Enhanced blocks | NOTE/TIP/IMPORTANT/WARNING/CAUTION callouts, Toggle, File, Embed, Tabs, and Columns; Panel is an internal part of Tabs and Columns |
| Math syntax | Inline `$...$` / `\(...\)` and display `$$...$$` / `\[...\]` |
| YAML properties | A top-level `---` mapping; preserve strings, numbers, booleans, nulls, lists, multiline strings, nested objects, and comments as source; properties are read-only in the panel |
| Safe HTML | Preview safe block and inline HTML; edit text-style tags directly; other HTML is displayed or preserved according to the safety checks |
| Level 2 | Person, Task, Project, and Event records; Document and Asset file resources; inline `object://type/short-id` links and standalone object cards |

This checklist covers the main input and rendering formats. It does not promise full compatibility with every CommonMark dialect or arbitrary HTML/CSS. The ordinary HTML in `01-basic-blocks-and-inline.md` can be previewed and round-tripped through source mode, but the current real-time collaboration compatibility check marks it incompatible. Restricted text-style tags have separate structured parsing.

## Suggested test order

1. Open each document and compare source mode with the rich-text view.
2. Edit text in any document, switch modes, save, and reopen it to check that the Markdown meaning is preserved.
3. Try block-handle moves, the slash menu, the toolbar, undo, and redo.
4. Use `05-links-images-and-attachments.md` to test navigation, image previews, and opening attachments.
5. Use `06-object-references.md` to test object links. Then rename an object in the workspace object panel and confirm that references still resolve by ID.
6. Change a line in an external editor and watch for the filesystem update. Make concurrent edits to the same line to check conflict copies.

## Capability switches

A clean checkout does not prepopulate `.tano/capabilities.json`, so it starts with the app's default document capabilities. In "Workspace -> Document capabilities", toggle `objectReferences`, `math`, `mermaid`, `wikiLink`, `callout`, `footnotes`, `embed`, `html`, and `enhanced` to check source fallback and restoration. Capability switches, personal rendering preferences, and Level creation controls are separate settings.

YAML has no fixed field schema: the mapping inside the top `---` delimiters may contain any keys. The properties panel currently displays values read-only. `created`, `updated`, `date`, `created_at`, and `updated_at` use date icons; arrays use list icons; other values appear as text. Edit YAML in source mode.

The app assigns file IDs for `document` and `asset` on its first scan. Create bound references to those resources by choosing a target in the UI instead of guessing an ID. The preset Person, Task, Project, and Event records in this directory have fixed short IDs for reference tests.
