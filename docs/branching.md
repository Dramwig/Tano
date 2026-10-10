# Branching and integration

PRs are optional in both repositories. Ordinary commits and pushes may update
`main` and `dev` directly after local validation. `main` remains the default,
releasable branch; `dev` integrates the next version. Production and installers
come from explicitly selected, immutable tags in [release automation](release-automation.md),
not automatically from a branch push.

## Daily development

1. Fetch origin and update the same local branch with `git merge --ff-only origin/dev`
   (or `origin/main`). This tracks the remote branch without inventing a merge.
2. Work on dev directly, or create an isolated task branch from dev, normally
   `codex/<task>` for agent work. Use Conventional Commits.
3. Run `npm run check` and relevant native/platform checks locally. Record the
   tested revision, commands and results in the commit body or an optional PR.
4. Merge a task branch into dev with `git merge --no-ff <task-branch>`, and push dev.
5. After integration passes locally, merge dev into main with
   `git merge --no-ff dev`, and push main. Keep unfinished work out of main.

For example, with current branches and locally validated dev:

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
git merge --no-ff dev -m "chore(repo): integrate tested development"
git push origin main
```

Use `--no-ff` for **all merges between different branches**, including task
branches and both directions between main/dev. Do not squash or rebase these
integrations. If you choose a GitHub PR, use **Create a merge commit**. GitHub does
not automatically enforce the local `--no-ff` convention. If the source is already
an ancestor, Git correctly reports that there is nothing to merge.

Do not force-push, reset shared history, or delete main/dev. If a push is rejected
because the remote advanced, fetch and integrate the remote changes, resolve any
conflicts, validate the result locally and retry an ordinary push. Never use force
to bypass the rejection. Delete only fully merged short-lived task branches.

## Releases and hotfixes

Version changes happen on main only when preparing a release. Run the release-plan
script locally, validate, commit and push; the **Prepare release PR** workflows
remain optional helpers for review. Tags must retain main ancestry and immutable
source identity. Pushing main or a tag does not publish anything automatically.

Urgent fixes may be committed on main or merged from a hotfix branch with
`--no-ff`, after local tests. If the deployed tag differs from main, assess the
additional changes before publishing. Every version update and hotfix must return
to dev before the next promotion.

## Synchronize main back into dev

With current branches and local validation:

```sh
git fetch origin
git switch dev
git merge --ff-only origin/dev
git merge --no-ff origin/main -m "chore(repo): synchronize main into development"
git push origin dev
```

Resolve conflicts on dev or a temporary branch based on dev; do not change main
just to resolve a synchronization conflict. Test the resolved result before
committing and pushing it.

[Sync main into dev](../.github/workflows/sync-development.yml) is an optional
manual helper that opens/reuses a main-to-dev PR. It does not merge, rewrite
branches or deploy. It needs the release-automation App/token; ordinary local
merge and push use the developer's existing Git authentication and need no App.
If using this helper, validate locally and choose **Create a merge commit**.

## GitHub protection

[The checked-in policy](../.github/branch-protection.json) applies to administrators
and blocks force pushes and deletion on both main and dev. It has no required PR,
review approval, remote status check or linear-history requirement. Ordinary
pushes are allowed. If a PR is used, its review conversations must be resolved.

All tests run [locally](local-validation.md). Commits, branch/tag pushes, PRs and
merges do not trigger Actions. GitHub cannot attest to local test results.

Inspect and verify policy with an authenticated repository administrator:

```sh
node scripts/configure-branches.mjs OWNER/REPOSITORY
node scripts/configure-branches.mjs OWNER/REPOSITORY --apply
```

The first command is read-only. The second creates missing matching protection
and verifies it. It refuses to overwrite a different existing policy; reconcile
only the intended settings explicitly. Checked-in JSON alone does not activate
GitHub protection. Keep main as the default branch and keep merge commits enabled.
