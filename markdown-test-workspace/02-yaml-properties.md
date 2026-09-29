---
"1": 42
"11": ""
title: "Field format test: colon: and English"
subtitle: 2026-09-26
plain_text: Unquoted text
description: 2026-09-26T00:00
folded: Folded first line Folded second line 123
ratio: 3.14
enabled: true
disabled: false
empty:
tags:
  - Markdown
  - English tag
  - Agent
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
WWW: ""
---

# YAML properties

Expand "Document properties" at the top and inspect how text, numbers, booleans, nulls, arrays, multiline strings, and nested objects appear. The panel joins array values and converts nested objects to JSON text; only five designated keys use date icons. It does **not** provide a dedicated field type or editor for every YAML key.

Switch to source mode to edit `title` or `tags`, then save and reopen the document. Check that comments, quotes, key order, and multiline syntax remain in the Markdown source. The document-title input, which stays in sync with the filename, is a separate feature and does not automatically rewrite the YAML `title`.
