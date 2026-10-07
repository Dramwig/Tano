---
# Keep this comment when editing the body.
title: "Field format test: colon: and English"
plain_text: Unquoted text
description: |
  First line of a multiline string.
  Second line keeps its line break.
folded: >
  Folded first line
  folded second line.
count: 42
ratio: 3.14
enabled: true
disabled: false
empty: null
tags: [Markdown, "English tag", Agent]
list_block:
  - First item
  - Second item
created: 2026-09-26
updated: 2026-09-26T10:30:00+08:00
date: 2026/09/26
created_at: 2026-09-26T09:00:00+08:00
updated_at: 2026-09-26T18:00:00+08:00
nested:
  owner: Tester
  score: 100
items:
  - name: Document
    done: true
  - name: Attachment
    done: false
---

# YAML properties

[简体中文](../zh-CN/02-YAML-属性字段.md) · [Guide](00-getting-started.md)

Expand document properties and inspect strings, numbers, booleans, nulls, arrays, multiline strings, and nested objects. Compare the date fields with ordinary text fields. Arbitrary YAML keys do not imply a dedicated business schema.

Edit `title` or `tags` in source mode, then save and reopen. Check comments, quotes, key order, and multiline syntax. Editing the body should not silently discard the frontmatter comment or rewrite its values.

The document title and filename are separate from the YAML `title` property. Check each operation independently.
