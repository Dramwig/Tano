# Core release automation

All tests and checks run [locally](local-validation.md). GitHub Actions has no
commit, push, tag, PR or workflow-completion triggers. Remaining operations must
be dispatched manually. Ordinary Git work has no mandatory test gate; publishing
a new version requires local validation of the final release candidate.
Development follows the [branching policy](branching.md).

The MIT repository owns Core versions and `core-vX.Y.Z` tags. Official Product
versions, deployment and installer publication belong to the private repository.
A public Product `vA.B.C` tag points to its pinned Core commit; the private tag
with the same name points to the Product commit.

Only a release that changes shipped Core contents needs a new Core version and
all six registry packages (five on npm, one on crates.io). Product-only changes
reuse the pinned Core, and adopting a previously published Core requires only a
consumer sync. See the [publication decision table](core-distribution.md#when-publication-is-required).
Neither a production deployment nor an ordinary commit automatically publishes
Core packages.

## Prepare and publish Core

Before any release-related Git commit, push, or tag creation, update the website
changelog in the private Tano-cloud repository, including for a Core-only release.
Edit `apps/client/src/changelog/zh-cn.md` and `en-us.md` together, following that
repository's `docs/changelog.md`. Record the intended version, date, release scope
and actual additions, improvements and fixes since the previous corresponding
release. Review `http://127.0.0.1:43941/zh-cn/changelog/` locally before proceeding.
Include the changelog changes in the coordinated release commits before creating
`core-vX.Y.Z` or Product tags; do not defer the entry until after tagging. Pending
release notes must not claim that publication or deployment has already succeeded.
This requirement applies to release work, not ordinary non-release Git operations.

1. Promote the intended development changes to main with
   `git merge --no-ff dev`. Prepare versions locally on main with
   `node scripts/release-plan.mjs prepare patch core` (minor, major or an exact
   stable version also work). This aligns npm/Tauri/Cargo versions and locks and
   drafts release notes. **Prepare Core release PR** remains an optional helper.
2. Review the version changes, then commit and push main normally. When using a
   release branch, merge with `--no-ff`. Before tagging, complete the full local
   check and applicable platform acceptance on the final integrated release
   candidate. Record commands, results and its exact SHA in release evidence
   (release notes, a release commit body or an optional PR). Failed required
   validation blocks publication; ordinary commits and pushes remain allowed.
3. Manually run **Tag reviewed release** on main. It validates the release plan
   and creates an immutable tag; it neither runs tests nor waits for retired CI.
4. Prepare and smoke-test the six registry artifacts locally, then run
   **Publish reviewed Core packages** manually with the tag and exact local
   evidence, or publish locally with `npm run core:publish -- --apply --evidence
   <json>`. Follow [Core distribution](core-distribution.md). Five npm packages
   use `@tano.page`; the Rust crate uses crates.io. Publish the small discovery
   manifest with the Core GitHub Release. **Export reviewed Core** remains an
   optional transport export; its expiring artifact is not a dependency source.
5. In the consumer, run `npm run core:sync -- --registry <manifest-file-or-url>`
   and commit the manifests/locks and removal of tracked snapshots to dev. The
   explicit sync includes local validation; it is not a prerequisite for ordinary
   Git work. **Sync reviewed Core** remains an optional manual PR helper and
   installs published packages without running test suites in Actions.
6. Synchronize main into dev locally with `git merge --no-ff main` and push dev.
   **Sync main into dev** remains an optional manual PR helper. Neither path starts
   Actions or requires a PR to update the protected branches.

Android and Apple preview builds are manual-only and build without running tests.
Local `npm run version:set -- X.Y.Z` and `npm run core:export` remain available.

For public Windows x64 Tano Local installers, manually dispatch **Build reviewed
Tano Local** at the stable Core tag and follow the separate
[Local artifact acceptance and publication procedure](local-release.md). This
public build contains no private overlay, does not execute tests in Actions and
does not automatically publish its installer. Accepted Local assets share the
Core Release with `core-registry.json`; every Core Release stays `latest=false`.

## GitHub configuration

Version/tag/synchronization operations use the `release-automation` environment:
`RELEASE_APP_ID` is a variable and `RELEASE_APP_PRIVATE_KEY` is a secret. An
explicit fine-grained `RELEASE_AUTOMATION_TOKEN` can be used instead.

Register a private GitHub App, disable webhooks and install it only on Tano and
its intended consumer. Repository Contents and Pull requests read/write are
sufficient for these operations; no Administration or protection bypass is needed.
Store the generated private key outside the checkout and never print it or put
it in Git. Use the App ID, not its Client ID or Installation ID. Do not reuse a
human CLI token as an automation secret. App credentials are not yet implied by
the existence of these files; configure them before manually using write jobs.

To verify write access, manually dispatch **Sync main into dev** when main has a
commit missing from dev and verify the PR author. A no-op with equal branches
cannot prove write permissions. The PR starts no CI; test locally when useful
for its changes, and apply the release gate if publishing a new version.
Rotate keys by installing and validating the replacement before revoking the old
key. Production credentials remain separately managed by the consumer.

## Retry

- Failed local validation must be fixed before dispatching a release. GitHub has
  no required test statuses and cannot certify local validation.
- A failed export can be manually retried for the same immutable tag. Changed
  source requires a new version; existing tags are never retargeted.
- Creating a tag does not build or publish anything automatically. Dispatch each
  desired follow-up explicitly.
- Stable releases only are supported. Prereleases require separate channels.
