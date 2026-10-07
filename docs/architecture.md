# Architecture

English | [中文](zh/architecture.md) | [日本語](ja/architecture.md) | [Deutsch](de/architecture.md) | [Documentation](README.md)

The Vue workbench uses a document store and a `WorkspaceAdapter`. The desktop adapter calls the Tauri IPC commands implemented by `tano-native`; the browser demo uses a separate browser-storage adapter. `configureWorkbench(pinia, runtime)` binds one runtime to each workbench instance.

```text
Vue workbench -> document store -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

Markdown files are the source of truth. The editor and headless codec share the same Markdown schema. The editor accepts host features through `EditorExtension`, keeping editing separate from storage and transport.

Each save compares the file with a base hash. Independent external changes can be merged; overlapping edits preserve both versions for review. There is a small race window between the final hash check and atomic replacement when another process does not coordinate with Tano.

Workspace identity is independent of file paths. The workspace UUID, short file IDs, and ID reservations travel with `.tano/identities.json`. Objects, relations, and rules also live under `.tano/`. SQLite indexes, drafts, and session state stay in application data outside the workspace. Tano does not follow symlinks outside the selected workspace.

## Block tree

The document, quotes, callouts, toggles, and tab/column panels own ordered block children. These containers can contain paragraphs, tables, lists, quotes, callouts, toggles, or tabs/columns recursively. Lists and tables retain their existing internal schemas and move as whole blocks. Toggle titles are node attributes; a callout's `[!TYPE]` marker is its container header rather than a movable child, and text immediately following it becomes a separate body block. Markdown remains the persistence format: quotes and callouts use `>` prefixes, toggles use balanced `<details>` / `<summary>` wrappers, and tabs/columns use nested container fences. No content migration or additional storage is required.

Columns render as plain side-by-side block containers. Panel titles remain in the source for compatibility but have no visible header or editing panel. Drag a block to the left or right edge of another block to reveal a vertical snap line; releasing creates columns, or adds a slot beside the target column in an existing row. Drops at the top or bottom continue to sort vertically. Moving or deleting the last block removes its empty column, with a remaining single column unwrapped into ordinary blocks. Creation, cleanup, and width redistribution are part of one undoable transaction; existing tab and quote containers retain their editable empty line.

Hovering a boundary reveals a resize handle; dragging changes only its two neighbors, previews locally, and commits once on release. Escape cancels the preview. Arrow keys adjust the boundary and double-click restores equal neighbor widths. Optional relative widths persist in the opening fence (for example, `::::columns widths=40,60`); omitted widths remain equal. On narrow screens columns stack while retaining their saved proportions, and side-drop creation is disabled. Readonly views expose no resize controls or block drag creation.

`packages/editor/src/block-tree.ts` provides revision-scoped block positions, parent relationships, and atomic subtree moves, independent of Vue and storage. Moves reject descendants as destinations and leave an editable paragraph when the last child leaves a container. Gutter handles, context menus, and drag targets use the same tree; stale drags are cancelled after document changes. Alt+Up/Down reorders siblings; Alt+Right moves into the previous container and Alt+Left moves out. The context menu can also wrap a block in a new toggle. Expansion and active-tab state remain presentation-only.

## Table layout

GFM tables remain ordinary Markdown. Column widths are integer CSS pixels, persisted separately in `.tano/document-layout/<fileId>.tano.json` using the stable document identity. Tables use the sum of their column widths, with horizontal scrolling when they exceed the editor width. The default column width is 160 px and the minimum is 48 px. Layout-only edits never rewrite Markdown.

Hover controls select entire rows or columns and offer insertion, duplication, clearing, deletion, and a color submenu with separate text and background groups. Dragging a control reorders its row or column in one undoable transaction. Structural operations preserve GFM's single header and at least one body row. Optional cell text and background colors are stored as palette-key matrices alongside column widths; widths and colors move with their cells and do not enter Markdown.

Editor table identities survive in-session edits and moves. On reopen or external reparsing, layout restoration requires an unambiguous table content/context match; ambiguous or changed tables use default widths while unmatched records are retained. Layout writes compare a base hash, merge independent table edits, and preserve conflicting local layouts under `.tano/conflicts/`. Copying only a Markdown file does not carry its layout.

## Project organization

Projects are organized with ordinary workspace folders and Markdown documents. A project overview is a user document and uses its existing stable document ID; folder paths organize files, not project identities or permissions. There is no built-in `project` object or project-specific `member` / `contains` relationship. Workspace membership and access control remain separate from content organization.

Historical `project` JSON files, IDs, properties, and relations are preserved without automatic conversion. Existing `object://project/<id>` links still open a read-only compatibility record. Projects are excluded from new object creation, copies, reference suggestions, and new relation endpoints. Task/event records, calendar synchronization, and person responsibility relations retain their existing model.

## Planning events

The Plan sidebar shares one selected date with the calendar. It shows that day's events and tasks, plus unscheduled tasks. New tasks and calendar entries are both `event` objects in `.tano/objects/`. Their optional properties are:

- `checkable`: whether the event needs completion; `completed` stores its completion state.
- `date`: a local `YYYY-MM-DD` planned date without a time slot. Completion is optional, so anniversaries and reminder dates can use it. Date-only entries appear above the calendar time grid and in month, year, and agenda views.
- `start` and `end`: a pair of timestamps with explicit time zones. Timed events appear on the calendar, including checkable events.

Use either `date` or the `start`/`end` pair. A checkable event without either is an unscheduled task. Completing or scheduling an event updates the same object with the existing base-hash merge rules. A deadline is separate from its planned execution date. Markdown checkboxes remain in their source documents and are not copied into event records.

Creation and detail editing share one scheduling control with unscheduled, planned-date, and time-range options. Both planned dates and time ranges use a single text button to switch between all-day and precise times, preserving the dates and times entered during the current edit. A precise instant has no default duration and is stored as `start === end`. All-day ranges include both selected dates and store `allDay: true` with `start` at the first day's midnight and an exclusive `end` at midnight after the last day, matching the calendar's half-open intervals. Completion is independent of date precision.

Existing `task` files remain readable and editable with their original IDs and reference URLs. They appear in the Plan sidebar through a compatibility layer; the workbench creates new tasks as `event` objects and no longer offers a separate task object type in the creation form.

### Personal and workspace ownership

New events and tasks can be saved to Personal or Workspace. Existing records retain their workspace ownership; there is no automatic migration. The sidebar and calendar share Workspace / Personal / All filters. All means personal records plus the current workspace. Source labels and composite view keys distinguish coincident short IDs, and completion, scheduling, and detail edits write back to their original source.

Workspace records remain in the workspace's `.tano/objects/`. Native personal records live in a separate `personal/.tano/objects/` directory within application data, with portable identities under `personal/.tano/` and a rebuildable `personal-index.sqlite` outside it. Personal files are user content, not disposable cache. Separate IPC and storage adapters leave the active workspace session untouched. Personal records are excluded from workspace references, search, plugins, and workspace exports. Personal planning is accessible from the plan sidebar and calendar; a read-only workspace or disabled object feature does not disable personal plans.

Browser personal records use the separate `tano.personal-plans.v1` key. Writes require Web Locks and compare against the latest base hash; unsupported browsers cannot write personal records. Native operations use a process coordination lock and the existing atomic file writer. Both adapters reuse object merging, retaining the persisted version and editing draft on conflicts and preserving corrupt data.

Personal means this device or browser, not a Tano account-backed private cloud. Optional desktop calendar and Todo connections can exchange selected records with external services; connection setup, credentials, and baselines stay in application data and the OS credential store. Calendar and Todo have separate connection settings. Browser and mobile hosts support iCalendar file import only. See the [planning sync guide](zh/planning-sync.md) for provider setup, conflict behavior, and verification limits. Cross-workspace assignee filtering and ownership migration are not implemented. Ownership and responsibility are separate: a person record does not establish a signed-in identity, and workspace records are not labeled as assigned to the current user.
