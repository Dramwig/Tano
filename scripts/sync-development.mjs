// SPDX-License-Identifier: MIT
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubClient, repositoryName } from './release-github.mjs';
import { output } from './release-plan.mjs';

export async function syncDevelopment(api, repository, { checkOnly = false } = {}) {
  repositoryName(repository);
  const root = `/repos/${repository}`;
  // ahead_by counts main commits missing from dev, even when dev has its own work.
  const comparison = await api(`${root}/compare/dev...main`);
  if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0)
    throw new Error('GitHub returned an invalid branch comparison');
  if (comparison.ahead_by === 0) return { status: 'up-to-date' };

  const query = `${root}/pulls?state=open&base=dev&head=${encodeURIComponent(repository.split('/')[0] + ':main')}`;
  const existing = await api(query);
  if (existing.length) return { status: 'existing', url: existing[0].html_url };
  if (checkOnly) return { status: 'needs-pr' };
  const body = {
    base: 'dev',
    head: 'main',
    title: 'chore(repo): sync main into dev',
    body: [
      'Bring reviewed release versions, hotfixes and other main changes back into development.',
      '',
      '**Merge with a merge commit. Do not squash or rebase this long-lived branch.**',
      'This PR follows main automatically; later main pushes do not create duplicate PRs.',
      'Required checks must pass. This workflow never merges, force-pushes or rewrites either branch.',
      '',
      'If there are conflicts, resolve them on a temporary branch created from dev, merge main into',
      'that branch, and submit it to dev. Do not use the conflict editor to commit changes onto main.',
      'See docs/branching.md for the integration and release policy.',
    ].join('\n'),
    maintainer_can_modify: false,
  };
  try {
    const pr = await api(`${root}/pulls`, { method: 'POST', body });
    return { status: 'created', url: pr.html_url };
  } catch (error) {
    // Another maintainer/run may have opened the same PR between list and create.
    // Preserve all other errors, including missing permissions and no-diff failures.
    const raced = await api(query);
    if (raced.length) return { status: 'existing', url: raced[0].html_url };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main')
      throw new Error('Run main-to-dev synchronization from main');
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check'))
      throw new Error('Usage: sync-development.mjs [--check]');
    const result = await syncDevelopment(githubClient(process.env.GH_TOKEN), process.env.GITHUB_REPOSITORY,
      { checkOnly: process.argv[2] === '--check' });
    output({ needed: result.status === 'needs-pr' });
    const summary = `main → dev: ${result.status}${result.url ? ` — ${result.url}` : ''}\n`;
    console.log(summary.trim());
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
