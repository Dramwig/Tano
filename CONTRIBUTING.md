# Contributing to Tano

Run `npm run check` before submitting a change. For native storage changes, also run `npm run test:native` and format the affected Rust crates as described in `AGENTS.md`.

## Commit messages

Use the Conventional Commit form `type(scope): imperative summary`. Write the subject in English, in the imperative, without a final period. Choose a short scope for the affected area, such as `editor`, `workbench`, `native`, `mcp`, `docs`, `ci`, or `repo`.

Use `feat` for features, `fix` for bug fixes, `docs` for documentation, `refactor` for behavior-preserving restructuring, `perf` for performance, `test` for tests, `build` for build tooling, `ci` for automation, and `chore` for maintenance. For a breaking change, add `!` after the scope and a `BREAKING CHANGE:` footer.

For a substantial change, leave a blank line after the subject and explain what changed and why. Include behavior, compatibility or safety details, and any important validation. Use bullets when several details need to be called out. Keep each commit focused on one coherent change.

Example:

```text
feat(editor): preserve external Markdown edits during save

Compare the current file with the editor's base hash before writing, so
changes made outside Tano are not silently replaced. Merge independent
edits and retain both versions when the same lines conflict.

- Keep file identity stable across conflict resolution
- Cover independent and conflicting edits in store tests
```
