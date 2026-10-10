// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubClient, repositoryName } from './release-github.mjs';

function protectionSettings(value) {
  return {
    required_status_checks: value.required_status_checks ? {
      strict: value.required_status_checks.strict,
      contexts: [...value.required_status_checks.contexts].sort(),
    } : null,
    enforce_admins: value.enforce_admins?.enabled ?? value.enforce_admins,
    required_pull_request_reviews: value.required_pull_request_reviews && Object.fromEntries(
      ['dismiss_stale_reviews', 'require_code_owner_reviews', 'required_approving_review_count', 'require_last_push_approval']
        .map((key) => [key, value.required_pull_request_reviews[key]])),
    restrictions: value.restrictions ?? null,
    ...Object.fromEntries(['required_linear_history', 'allow_force_pushes', 'allow_deletions', 'required_conversation_resolution']
      .map((key) => [key, value[key]?.enabled ?? value[key]])),
  };
}

export function matchesProtection(actual, expected) {
  if (!actual) return false;
  // Refuse to overwrite protection whose additional rules would be dropped by PUT.
  if (actual.required_signatures?.enabled || actual.block_creations?.enabled || actual.lock_branch?.enabled)
    return false;
  const reviews = actual.required_pull_request_reviews;
  if ([reviews?.dismissal_restrictions, reviews?.bypass_pull_request_allowances]
    .some((actors) => actors && Object.values(actors).some((value) => Array.isArray(value) && value.length)))
    return false;
  return JSON.stringify(protectionSettings(actual)) === JSON.stringify(protectionSettings(expected));
}

export async function verifyReadBack(read, matches, label, { sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (matches(await read())) return;
    if (attempt < 4) await sleep(1000);
  }
  throw new Error(`${label} read-back failed`);
}

export async function configureBranches(api, repository, policy, { apply = false } = {}) {
  repositoryName(repository);
  if (JSON.stringify(policy.branches) !== JSON.stringify(['main', 'dev']))
    throw new Error('This policy only manages main and dev');
  const root = `/repos/${repository}`;
  const repo = await api(root);
  if (repo.default_branch !== 'main') throw new Error('Expected main as the default branch');
  if (apply && !repo.permissions?.admin) throw new Error('Repository administration permission is required');
  const branches = [];
  // Inspect every branch before the first write; do not silently replace existing rules.
  for (const branch of policy.branches) {
    await api(`${root}/branches/${branch}`);
    const actual = await api(`${root}/branches/${branch}/protection`, { allow404: true });
    branches.push({ branch, state: !actual ? 'missing' : matchesProtection(actual, policy.settings) ? 'matching' : 'different' });
  }
  if (!apply) return { applied: false, branches, repository: policy.repository };
  if (branches.some(({ state }) => state === 'different'))
    throw new Error('Existing branch protection differs; inspect and reconcile it instead of overwriting');
  for (const entry of branches) {
    const path = `${root}/branches/${entry.branch}/protection`;
    if (entry.state === 'missing') await api(path, { method: 'PUT', body: policy.settings });
    await verifyReadBack(() => api(path), actual => matchesProtection(actual, policy.settings),
      `Protection for ${entry.branch}`);
    entry.state = 'verified';
  }
  // Protect both long-lived branches before enabling automatic task-branch deletion.
  if (Object.entries(policy.repository).some(([key, value]) => repo[key] !== value))
    await api(root, { method: 'PATCH', body: policy.repository });
  await verifyReadBack(() => api(root), actual => Object.entries(policy.repository)
    .every(([key, value]) => actual[key] === value), 'Repository merge settings');
  return { applied: true, branches, repository: policy.repository };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , repository, mode] = process.argv;
    if (!repository || (mode && mode !== '--apply') || process.argv.length > 4)
      throw new Error('Usage: node scripts/configure-branches.mjs OWNER/REPO [--apply]');
    const policy = JSON.parse(readFileSync(new URL('../.github/branch-protection.json', import.meta.url), 'utf8'));
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(JSON.stringify(await configureBranches(githubClient(token), repository, policy, { apply: mode === '--apply' }), null, 2));
  } catch (error) {
    // Do not print command output or a token-bearing environment when gh authentication fails.
    console.error(error.status ? 'GitHub login is required: run gh auth login with a repository administrator account.' : error.message);
    process.exitCode = 1;
  }
}
