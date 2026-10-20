# Object references

[简体中文](../zh-CN/06-对象引用.md) · [Guide](00-getting-started.md)

Preset records live under `.tano/objects/` at the workspace root. References use a six-digit lowercase hexadecimal ID independent of the file path.

- Person: [@Alex Morgan](object://person/a82f91)
- Task: [@Review rendering](object://task/b82f91)
- Project: [@Markdown QA](object://project/c82f91)
- Event: [@QA review meeting](object://event/d82f91)

The standalone paragraph becomes a card through its `tano:object-card` title:

[QA review meeting](object://event/d82f91 "tano:object-card")

Rename a Person, Task, Project or Event and verify references still resolve by ID. Task, Project and Experiment are editable core schemas. Existing checkable Events retain their identities. Object databases switch between table, board and gallery without copying records or relations.

[[nested-folder/target-document]] resolves a document by path. Bound Document/Asset references use app-assigned short IDs instead. Create one with the `@` / `[[` picker, rename its target, and check identity tracking.

Each language has its own object records and names. These JSON properties are separate from YAML frontmatter. The browser demo uses bundled records and does not modify the local workspace.
