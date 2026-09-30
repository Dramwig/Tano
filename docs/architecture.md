# Architecture

English | [中文](zh/architecture.md) | [日本語](ja/architecture.md) | [Deutsch](de/architecture.md) | [Documentation](README.md)

The Vue workbench uses a document store and a `WorkspaceAdapter`. The desktop adapter calls the Tauri IPC commands implemented by `tano-native`; the browser demo uses a separate browser-storage adapter. `configureWorkbench(pinia, runtime)` binds one runtime to each workbench instance.

```text
Vue workbench -> document store -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

Markdown files are the source of truth. The editor and headless codec share the same Markdown schema. The editor accepts host features through `EditorExtension`, keeping editing separate from storage and transport.

Each save compares the file with a base hash. Independent external changes can be merged; overlapping edits preserve both versions for review. There is a small race window between the final hash check and atomic replacement when another process does not coordinate with Tano.

Workspace identity is independent of file paths. The workspace UUID, short file IDs, and ID reservations travel with `.tano/identities.json`. Objects, relations, and rules also live under `.tano/`. SQLite indexes, drafts, and recovery state stay in application data outside the workspace. Tano does not follow symlinks outside the selected workspace.

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

Workspace records remain in the workspace's `.tano/objects/`. Native personal records live in a separate `personal/.tano/objects/` directory within application data, with portable identities under `personal/.tano/` and a rebuildable `personal-index.sqlite` outside it. Personal files are user content, not disposable cache. Separate IPC and storage adapters leave the active workspace session untouched. Personal records are excluded from workspace references, search, plugins, and workspace exports. The welcome page also provides personal planning without an open workspace; a read-only workspace or disabled object feature does not disable personal plans.

Browser personal records use the separate `tano.personal-plans.v1` key. Writes require Web Locks and compare against the latest base hash; unsupported browsers cannot write personal records. Native operations use a process coordination lock and the existing atomic file writer. Both adapters reuse object merging, retaining the persisted version and editing draft on conflicts and preserving corrupt data.

Personal means this device or browser, not a Tano account-backed private cloud. Optional desktop calendar and Todo connections can exchange selected records with external services; connection setup, credentials, and baselines stay in application data and the OS credential store. Calendar and Todo have separate connection settings. Browser and mobile hosts support iCalendar file import only. See the [planning sync guide](zh/planning-sync.md) for provider setup, conflict behavior, and verification limits. Cross-workspace assignee filtering and ownership migration are not implemented. Ownership and responsibility are separate: a person record does not establish a signed-in identity, and workspace records are not labeled as assigned to the current user.
