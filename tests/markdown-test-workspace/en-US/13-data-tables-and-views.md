# Data tables and views

[简体中文](../zh-CN/13-数据表与视图.md) · [Guide](00-getting-started.md)

## Choose a data format

| Format | Best for | Content location |
| --- | --- | --- |
| Markdown table | Small comparisons within a document | The `.md` body |
| Data table | Ongoing records, fields, and formulas | An ordinary `name.table.json` file |
| File database | Filtering workspace files and properties | Original files; views under `.tano/` |
| Object database | People, tasks, projects, events, experiments | Records under `.tano/objects/` |

## Create a review table

Create a data table from the file-tree menu and name it “Feature review”. Add Name (text), Status (single select), and Effort (number) fields, then enter these practice records:

| Name | Status | Effort |
| --- | --- | ---: |
| Editor | To check | 2 |
| Navigation | In review | 1 |
| References | Done | 1 |

- [ ] Copy records from this table to check multirow paste, Enter navigation, and Shift+Enter line breaks.
- [ ] Add the formula `IF([Status] = "Done", [Effort], 0)` and inspect computed values and summaries.
- [ ] Save table, board, and card views; group by Status, filter unfinished records, then show all records again.
- [ ] Export the current view as CSV. CSV does not include formula definitions, views, or attachment files.
- [ ] Rename and move the table, reopen it, and check the records. Changing the extension to `.xlsx` does not convert it.

## Object and file views

Use the people, tasks, projects, and events in [Object references](06-object-references.md) to explore object views. Rename an object and check its current name on the reference page. Switching table, board, and gallery views must not duplicate its records.

Create a file view filtered to this language folder's Markdown and inspect YAML fields from the [properties sample](02-yaml-properties.md). Views project the original content; they do not move Markdown into a database.

## External edits and recovery

On desktop, use a table copy to test external cell edits. Independent edits can merge; overlapping edits must preserve both versions. On a conflict, use retry, save a copy, or reload after preserving recovery content. The browser demo saves only in this browser and does not demonstrate live multiuser table editing.
