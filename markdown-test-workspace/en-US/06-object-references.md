# Object references

[简体中文](../zh-CN/06-对象引用.md) · [Guide](00-getting-started.md)

Preset records live under `.tano/objects/` at the workspace root. References use a six-digit lowercase hexadecimal ID independent of the file path.

- Person: [@Alex Morgan](object://person/a82f91)
- Historical Task: [@Review rendering](object://task/b82f91)
- Historical Project: [@Markdown QA](object://project/c82f91)
- Event: [@QA review meeting](object://event/d82f91)

The standalone paragraph becomes a card through its `tano:object-card` title:

[QA review meeting](object://event/d82f91 "tano:object-card")

Rename the Person or Event in the object panel and check that references still resolve by ID. Task and Project are historical compatibility examples: their records remain readable, but creating or changing those retired object types is disabled. Current to-dos use checkable Event records.

[[nested-folder/target-document]] resolves a document by path. Bound Document/Asset references use app-assigned short IDs instead. Create one with the `@` / `[[` picker, rename its target, and check identity tracking.

Each language has its own object records and names. These JSON properties are separate from YAML frontmatter. The browser demo uses bundled records and does not modify the local workspace.
