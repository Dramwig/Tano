import { describe, expect, it } from 'vitest';
import { nextVersion, validatePlan } from './release-plan.mjs';
import { ensureTag, successfulRun, githubClient } from './release-github.mjs';

describe('release automation boundaries', () => {
  it('bumps versions and rejects prereleases, overflow and rollback', () => {
    expect(nextVersion('0.9.3', 'minor')).toBe('0.10.0');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
    expect(nextVersion('0.9.3', 'patch')).toBe('0.9.4');
    for (const value of ['0.9.2', '01.2.3', '1.0.0-rc.1', '1.0.0;echo x', '9007199254740993.0.0'])
      expect(() => nextVersion('0.9.3', value)).toThrow();
  });
  it('binds scope, version, kind and notes path to the repository', () => {
    const plan = {
      format: 1,
      kind: 'product',
      version: '0.2.0',
      tag: 'v0.2.0',
      scope: 'cloud',
      notes: '.github/releases/v0.2.0.md',
    };
    expect(validatePlan(plan, { name: 'tano-cloud', version: '0.2.0' })).toBe(plan);
    for (const patch of [
      { scope: 'core' },
      { tag: 'v0.3.0' },
      { notes: '../secret' },
      { kind: 'core' },
    ])
      expect(() =>
        validatePlan({ ...plan, ...patch }, { name: 'tano-cloud', version: '0.2.0' }),
      ).toThrow();
  });
  it('never replaces an existing tag, including annotated tags', async () => {
    const calls = [],
      sha = 'a'.repeat(40);
    const api = async (path, options) => {
      calls.push([path, options]);
      return path.includes('/commits/') ? { sha } : { object: { type: 'tag' } };
    };
    await ensureTag(api, 'owner/repo', 'v0.2.0', sha);
    expect(calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    await expect(ensureTag(api, 'owner/repo', 'v0.2.0', 'b'.repeat(40))).rejects.toThrow(
      'different commit',
    );
  });
  it('requires the latest exact-commit push check, not an older green run or a PR', async () => {
    const sha = 'a'.repeat(40);
    const run = {
      id: 1,
      event: 'push',
      head_sha: sha,
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
    };
    const api = async () => ({ workflow_runs: [run, { ...run, id: 2, conclusion: 'failure' }] });
    await expect(successfulRun(api, 'owner/repo', 'check.yml', sha, 'main')).rejects.toThrow(
      'failed',
    );
    await expect(
      successfulRun(
        async () => ({ workflow_runs: [{ ...run, event: 'pull_request' }] }),
        'owner/repo',
        'check.yml',
        sha,
        'main',
      ),
    ).rejects.toThrow('No completed');
  });
  it('does not treat authentication failure as an absent release', async () => {
    const api = githubClient('test', async () => ({ ok: false, status: 403 }));
    await expect(api('/repos/owner/repo/releases/latest', { allow404: true })).rejects.toThrow(
      '403',
    );
  });
});
