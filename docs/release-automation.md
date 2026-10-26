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
4. Manually run **Export reviewed Core**, supplying that Core tag. It checks tag
   identity, main ancestry and clean source, then exports the distribution and
   uploads a 30-day transport artifact. It does not dispatch a consumer workflow.
5. In the consumer, sync the intended tagged Core source locally using
   `npm run core:sync` and commit the snapshot to dev. This explicit sync command
   includes validation; it is not a prerequisite for ordinary Git work. Alternatively use
   **Sync reviewed Core** as an optional PR helper. The committed snapshot is the
   durable copy; the expiring Actions artifact is not a dependency source.
6. Synchronize main into dev locally with `git merge --no-ff main` and push dev.
   **Sync main into dev** remains an optional manual PR helper. Neither path starts
   Actions or requires a PR to update the protected branches.

Android and Apple preview builds are manual-only and build without running tests.
Local `npm run version:set -- X.Y.Z` and `npm run core:export` remain available.

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
