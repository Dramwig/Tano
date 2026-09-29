# Level 2 object references

This workspace includes four preset `.tano/objects/*.tano.json` records. The links below use `object://type/six-digit-lowercase-hex-id`. Rename an object in the object panel to verify that its references still resolve to the same ID.

- Person inline reference: [@Alex Morgan](object://person/a82f91)
- Task inline reference: [@Review rendering](object://task/b82f91)
- Project inline reference: [@Markdown QA](object://project/c82f91)
- Event inline reference: [@QA review meeting](object://event/d82f91)

The standalone paragraph below becomes an object card through its `tano:object-card` title:

[QA review meeting](object://event/d82f91 'tano:object-card')

A standard Wiki link such as `[[nested-folder/target-document]]` finds a document by path or name. A bound Document or Asset reference instead uses a short file ID assigned by the app. Use the `@` / `[[` picker or the object-reference menu to create one document reference and one asset reference, then check identity tracking after a rename.

The examples in `.tano/objects/` cover text, numbers, booleans, and timezone-aware Event date-times. Person, Task, and Project currently have no preset required business fields. These are JSON record properties, not YAML frontmatter fields.
