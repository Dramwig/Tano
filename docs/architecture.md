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
- `date`: a local `YYYY-MM-DD` planned date without a time slot.
- `start` and `end`: a pair of timestamps with explicit time zones. Timed events appear on the calendar, including checkable events.

Use either `date` or the `start`/`end` pair. A checkable event without either is an unscheduled task. Completing or scheduling an event updates the same object with the existing base-hash merge rules. A deadline is separate from its planned execution date. Markdown checkboxes remain in their source documents and are not copied into event records.

Existing `task` files remain readable and editable with their original IDs and reference URLs. They appear in the Plan sidebar through a compatibility layer; the workbench creates new tasks as `event` objects and no longer offers a separate task object type in the creation form.
