# Branching and integration

`main` is the default branch and contains accepted, releasable work. `dev` is the
integration branch for the next version. A branch name does not identify the
currently deployed version: production and official installers come from reviewed,
immutable release tags described in [release automation](release-automation.md).

## Daily development

1. Fetch origin and update local `dev` with `git merge --ff-only origin/dev`.
2. Create a short-lived branch from `dev`, normally `codex/<task>` for agent work.
3. Keep one logical change per Conventional Commit; run `npm run check` and the
   relevant native/platform checks. Open a PR targeting `dev`.
4. Integrate and validate the combined work on `dev`. Unfinished features stay on
   their task branches. Open a `dev` → `main` PR when the integrated work is ready.
5. Merge long-lived branches with **Create a merge commit**, never squash or rebase.
   A short-lived feature PR may be squashed; delete its branch after merging.

Keep both long-lived branches. Do not force-push or reset them. Do not develop
unrelated tasks directly on the same `dev` checkout. Keep `main` as the GitHub
default branch and explicitly choose `dev` as the base of ordinary PRs.

## Releases and hotfixes

Prepare version PRs from `main` using the existing release workflow after the
`dev` promotion has passed local validation. Bump versions only for a release, not for each
development commit. Version PRs still target `main`; tags and release workflows
still require main ancestry and immutable tag identity. Validate the exact commit locally before dispatching a release.

For an urgent fix, create a short-lived branch from current `main`, test it, and
submit it to `main`. If the deployed tag differs substantially from main, assess
the additional changes before publishing; do not silently release unfinished work.
Every version update and hotfix must return to `dev` before further promotion.

## Manual main-to-dev synchronization

[Sync main into dev](../.github/workflows/sync-development.yml) is dispatched manually
on `main` after a version update or hotfix. It compares ancestry and opens one
`main` → `dev` PR only when main has commits missing from dev. An existing PR
automatically follows new main commits. It never merges automatically, rewrites a
branch, or deploys anything. Merge this PR with a merge commit after local validation passes.

The workflow uses the `release-automation` environment's `RELEASE_APP_ID` and
`RELEASE_APP_PRIVATE_KEY`, or `RELEASE_AUTOMATION_TOKEN`. The identity needs Contents
read and Pull requests write on this repository. Use the existing scoped App/PAT
to create the PR. The PR does not start any Actions checks; validate it locally.

If a sync PR conflicts, **do not resolve it by editing main in GitHub's conflict
editor**. Create a temporary branch from current dev, merge `origin/main` into it,
resolve the conflicts there, and open a replacement PR to dev. Merge that
replacement with a merge commit, then close the original sync PR if still open.

## GitHub protection

[The checked-in policy](../.github/branch-protection.json) requires PRs and resolved
review conversations on both branches. It applies to administrators and blocks
force pushes and deletion. No additional reviewer's approval is required for this
single-maintainer workflow. Merge commits must remain enabled.

Required Actions status checks are disabled because **all tests and checks run
locally**. Commits, branch/tag pushes, PRs and merges do not trigger workflows.
GitHub does not attest to local test results: include the tested SHA, commands and
results in the PR, and rerun relevant checks locally after resolving conflicts or
changing the target branch. See [local validation](local-validation.md).

Do not enable required linear history, because it would forbid merge commits
that preserve main/dev ancestry. Retired CI failures do not block this policy.

Apply and verify the policy with an authenticated repository administrator:

```sh
node scripts/configure-branches.mjs OWNER/REPOSITORY
node scripts/configure-branches.mjs OWNER/REPOSITORY --apply
```

The first command is read-only. The second adds the protection policy and verifies
it by reading it back. Existing protection is preserved unless it already matches;
different existing settings require explicit reconciliation instead of overwriting.
The GitHub account/plan must support branch protection for this repository.

Initial setup fast-forwards dev to main and installs this policy before enabling
protection. Subsequent changes use the PR flow above. A checked-in JSON file alone
does not activate GitHub protection.
