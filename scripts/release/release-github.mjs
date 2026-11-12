// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { output, readPlan } from './release-plan.mjs';

export function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? '') ||
    value.split('/').some((part) => part === '.' || part === '..'))
    throw new Error('Invalid GitHub repository');
  return value;
}
export function commitSha(value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('Expected a full Git commit SHA');
  return value;
}
export function githubClient(token, fetchImpl = fetch) {
  if (!token) throw new Error('A GitHub App token or automation token is required');
  return async (path, { method = 'GET', body, allow404 = false } = {}) => {
    if (!path.startsWith('/repos/')) throw new Error('Only repository API paths are supported');
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path.split('?')[0]} failed: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
}
export async function ensureTag(api, repository, tag, sha) {
  repositoryName(repository);
  commitSha(sha);
  if (!/^(core-)?v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid stable release tag');
  const existing = await api(`/repos/${repository}/git/ref/tags/${tag}`, { allow404: true });
  if (existing) {
    const commit = await api(`/repos/${repository}/commits/${tag}`);
    if (commit.sha !== sha) throw new Error(`Immutable tag ${tag} points to a different commit`);
    return;
  }
  await api(`/repos/${repository}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/tags/${tag}`, sha },
  });
}
export function assertMainAncestor(root, sha) {
  commitSha(sha);
  execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {
    cwd: root,
    stdio: 'pipe',
  });
}
async function main() {
  const root = process.cwd(),
    repository = repositoryName(process.env.GITHUB_REPOSITORY);
  const sha = commitSha(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assertMainAncestor(root, sha);
  const api = githubClient(process.env.GH_TOKEN);
  const plan = readPlan(root);
  if (process.argv[2] === 'tag') {
    await ensureTag(api, repository, plan.tag, sha);
    console.log(`Release tag ready: ${plan.tag} at ${sha}`);
  } else if (process.argv[2] === 'verify') {
    if (process.env.TANO_RELEASE_TAG !== plan.tag)
      throw new Error('Only the planned release tag can be deployed');
    const commit = await api(`/repos/${repository}/commits/${plan.tag}`);
    if (commit.sha !== sha) throw new Error('Release checkout does not match its tag');
    output({ sha, version: plan.version, tag: plan.tag, scope: plan.scope, notes: plan.notes });
  } else throw new Error('Usage: release-github.mjs tag | verify');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
