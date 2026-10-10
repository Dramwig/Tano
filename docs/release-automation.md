# Core release automation

The public repository owns the MIT Core version and its `core-vX.Y.Z` tags. Official Product versions, production deployment and official installer publication are managed in the private repository. A public Product `vA.B.C` tag points to its pinned Core commit; the private tag with the same name points to the Product commit.

## Prepare and publish Core

1. Run **Prepare Core release PR** on `main`. Choose `patch`, `minor`, `major`, or an exact stable version. For the first tag only, the current version can be used. The workflow calls the existing version setter, updates npm/Tauri/Cargo versions and lockfiles, and drafts `.github/releases/core-vX.Y.Z.md`.
2. Review the version PR, especially compatibility changes and release notes. Merge it after checks pass.
3. **Tag reviewed release** waits for `check.yml` on the exact merged `main` commit and creates an immutable tag. It never retargets an existing tag.
4. The Core tag runs checks and native builds. **Export verified Core** runs only after the successful tag check, verifies main ancestry and tag identity, exports a clean distribution and uploads a 30-day transport artifact.
5. If a consumer is configured, the export workflow sends `core-released` with the tag and SHA. The consumer independently verifies the tag and CI, regenerates the distribution and creates a synchronization PR. Its committed vendored snapshot is the durable copy; an expiring Actions artifact is not a dependency source.

For local preparation, `node scripts/release-plan.mjs prepare patch core` updates files without committing or tagging. Direct `npm run version:set -- X.Y.Z` and `npm run core:export` remain available.

## GitHub configuration

Create the `release-automation` environment. Configure `RELEASE_APP_ID` as a variable and `RELEASE_APP_PRIVATE_KEY` as a secret. The GitHub App needs Contents read/write and Actions read on this repository, plus Pull requests read/write for version PRs. An explicit fine-grained `RELEASE_AUTOMATION_TOKEN` can be used instead.

To notify the official consumer, set `CORE_CONSUMER_REPOSITORY=Tano-cloud` (repository name, same owner). Install the App on that repository with permission to create a repository dispatch. Its own workflow identity needs permission to create its synchronization PR. Keep these credentials out of PR/fork workflows. Protect `main`, release environments and immutable release tags according to the maintainer's policy.

The default `GITHUB_TOKEN` is deliberately not used to push release tags or PR branches: events it creates generally do not start another Actions workflow. See [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Failures and retry

- A failed main check prevents tagging; a failed tag check prevents export and consumer notification.
- Rerun a failed export/notification after fixing configuration. An identical tag and commit can be processed again; changed content requires a new version.
- If the tag workflow was skipped or a required App permission was missing, run it manually on `main` after its checks succeed.
- Stable releases only are supported. Pre-release channels require separate tag validation and update feeds before use.

The workflow files are checked with actionlint in `check.yml`. Release tooling tests cover version bounds, tag immutability, exact-commit checks and authentication failures.
