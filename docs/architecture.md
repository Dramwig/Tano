# Architecture

English | [中文](zh/architecture.md) | [日本語](ja/architecture.md) | [Deutsch](de/architecture.md) | [Documentation](README.md)

The Vue workbench uses a document store and a `WorkspaceAdapter`. The desktop adapter calls the Tauri IPC commands implemented by `tano-native`; the browser demo uses a separate browser-storage adapter. `configureWorkbench(pinia, runtime)` binds one runtime to each workbench instance.

```text
Vue workbench -> document store -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

Markdown files are the source of truth. The editor and headless codec share the same Markdown schema. The editor accepts host features through `EditorExtension`, keeping editing separate from storage and transport.

Each save compares the file with a base hash. Independent external changes can be merged; overlapping edits preserve both versions for review. There is a small race window between the final hash check and atomic replacement when another process does not coordinate with Tano.

Workspace identity is independent of file paths. The workspace UUID, short file IDs, and ID reservations travel with `.tano/identities.json`. Objects, relations, and rules also live under `.tano/`. SQLite indexes, drafts, and recovery state stay in application data outside the workspace. Tano does not follow symlinks outside the selected workspace.
