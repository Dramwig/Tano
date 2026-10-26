# Contributing to Tano

Ordinary commits, pushes and merges do not require tests, builds or dependency
installation. Run targeted local checks during development when useful for the
change or requested by the user; a Git-only request does not trigger validation
or Core synchronization. Do not describe untested changes as verified.

Before publishing a new version, run `npm run check` and the applicable native,
platform and smoke checks on the final release revision. Record commands,
results, tested SHA and platform limitations in release evidence (release notes,
a release commit body or an optional PR). See [local validation](docs/local-validation.md).

All tests and checks run locally; GitHub Actions only runs explicitly requested
packaging, release or synchronization jobs. Shared Core changes use the public
source and export/update flow; never edit vendor snapshots or dependencies by hand.

## Branches

PRs are optional. Ordinary `git commit` and `git push` may update `dev` or `main` directly. Integrate normal development into `dev`
first; keep `main` releasable. Task branches remain useful for isolated work.

Use `git merge --no-ff` for every merge between branches, including task branches,
`dev` to `main`, and `main` back to `dev` after version updates or hotfixes.
If using a PR, choose **Create a merge commit**. Never force-push, delete or rewrite
either long-lived branch. See [the branching policy](docs/branching.md) and
[release automation](docs/release-automation.md).

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
