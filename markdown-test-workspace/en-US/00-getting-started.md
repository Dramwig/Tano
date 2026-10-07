---
title: "Tano Markdown QA Workspace"
tags: [testing, Markdown, workspace]
created: "2026-09-26"
---

# Tano Markdown QA Workspace

[简体中文](../zh-CN/00-从这里开始.md) · [Language overview](../开始使用.md)

This is the English set of Markdown QA documents. Open the containing workspace folder in the desktop app to test real files. The browser demo bundles separate copies and saves edits only in this browser; it cannot read or sync this local folder.

## File guide

| File | What to check |
| --- | --- |
| [01-basic-blocks-and-inline.md](01-basic-blocks-and-inline.md) | Headings, paragraphs, lists, quotes, tables, code, rules, and inline styles |
| [02-yaml-properties.md](02-yaml-properties.md) | YAML value types, date fields, comments, and source preservation |
| [03-math-diagrams-and-footnotes.md](03-math-diagrams-and-footnotes.md) | Dollar and LaTeX math, Mermaid, and footnotes |
| [04-enhanced-blocks.md](04-enhanced-blocks.md) | Five callout types, toggles, tabs, columns, file cards, and embeds |
| [05-links-images-and-attachments.md](05-links-images-and-attachments.md) | Standard links, Wiki links, relative images, and attachments |
| [06-object-references.md](06-object-references.md) | Inline object references, object cards, and file identity |
| [07-source-preservation-boundaries.md](07-source-preservation-boundaries.md) | Unsupported syntax and source fallback |
| [08-unknown-directives-and-embeds.md](08-unknown-directives-and-embeds.md) | Unknown directives, Wiki embeds, and code-fence metadata |
| [09-toml-frontmatter.md](09-toml-frontmatter.md) | TOML frontmatter source preservation |
| [nested-folder/target-document.markdown](nested-folder/target-document.markdown) | Nested paths, the `.markdown` extension, and heading navigation |

## Format checklist

| Category | Formats to check |
| --- | --- |
| Blocks | H1–H6, paragraphs, quotes, unordered/ordered/task lists, fenced code, GFM tables, images, rules, Mermaid, and display math |
| Inline | Bold, italic, code, standard/reference/autolinks, strikethrough, math, footnotes, escapes, and hard breaks |
| Text extensions | `<u>`, `<sup>`, `<sub>`, `<mark>`, and restricted `<span style="color: #RGB/#RRGGBB">` |
| Document links | `[[document]]`, `[[folder/document\|alias]]`, and `[[document#heading]]` |
| Enhanced blocks | NOTE/TIP/IMPORTANT/WARNING/CAUTION, Toggle, File, Embed, Tabs, and Columns; Panel belongs inside Tabs or Columns |
| Math | Inline `$...$` / `\(...\)` and display `$$...$$` / `\[...\]` |
| Properties | YAML strings, numbers, booleans, nulls, lists, multiline values, nested objects, and comments |
| Objects | Person and Event records, historical Task/Project references, and Document/Asset file resources |

This checklist does not promise every CommonMark dialect or arbitrary HTML/CSS. Ordinary HTML can be previewed locally and preserved in source mode; its real-time collaboration codec support differs from restricted text-style tags.

## Suggested test order

1. Compare source mode and rich text in each document.
2. Edit a paragraph, switch modes, save, and reopen. Check the Markdown meaning.
3. Try block handles, the slash menu, the toolbar, undo, and redo.
4. Follow links and heading anchors, preview images, and download an attachment in `05-links-images-and-attachments.md`.
5. Use `06-object-references.md` to check object resolution and references after renaming.
6. In the desktop app, edit a line externally and check filesystem watching. Edit the same line concurrently to check conflict copies.

## Capability switches

In workspace document-capability settings, toggle `objectReferences`, `math`, `mermaid`, `wikiLink`, `callout`, `footnotes`, `embed`, `html`, and `enhanced`. Check source fallback and restoration. Capability switches, rendering preferences, and object-creation controls are separate settings.

Edit the YAML examples in source mode to inspect exact comments, order, and multiline syntax. `created`, `updated`, `date`, `created_at`, and `updated_at` are useful date-field examples; arbitrary keys do not acquire a dedicated business schema.

Preset object records live at the workspace root under `.tano/objects/`. Document and Asset short IDs are assigned by the app; create their references with the picker instead of guessing an ID. Browser samples are isolated from the local workspaces and do not provide network sync or a real agent connection.
