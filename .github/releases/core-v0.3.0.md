# Tano Core 0.3.0

- Add editable data table files with typed fields, formulas, table/card/board views, CSV import/export and attachment references.
- Integrate data tables with file creation, renaming, moving, duplication, tabs and session recovery. Preserve external edits through compared writes and conflict copies.
- Add a searchable template library and empty-document starters, improve command discovery and fix Enter handling in inline Markdown.
- Persist assistant questions and answers across recovery, support cancellation, and replan after user input.
- Improve document creation latency, review controls and dark theme colors.

Markdown remains the document content source of truth. Data tables are ordinary `.table.json` user files with stable workspace file identities. Existing workspaces need no manual migration; legacy `.tano/tables/` files are migrated with their original bytes preserved in recovery copies. Data tables do not claim realtime collaborative editing.

Local Windows validation is recorded in the release commit.
