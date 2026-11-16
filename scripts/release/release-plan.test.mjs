import { describe, expect, it } from 'vitest';
import { nextVersion, validatePlan } from './release-plan.mjs';
import { ensureTag, githubClient } from './release-github.mjs';

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
  it('does not treat authentication failure as an absent release', async () => {
    const api = githubClient('test', async () => ({ ok: false, status: 403 }));
    await expect(api('/repos/owner/repo/releases/latest', { allow404: true })).rejects.toThrow(
      '403',
    );
  });
});

import { formatDevFeatures } from '../dev/features-check.mjs';
it('formats unfinished features for release drafts including an empty registry', () => {
  expect(formatDevFeatures({})).toBe('- 无');
  expect(
    formatDevFeatures({
      draft: { status: 'dev', note: 'Draft' },
      live: { status: 'stable', note: 'Live' },
    }),
  ).toBe('- draft: Draft');
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareRelease } from './release-plan.mjs';
it('prepare includes the checked unfinished feature list in the notes draft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tano-feature-plan-'));
  try {
    for (const dir of ['packages/workbench/src', 'scripts/release'])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tano', version: '0.0.1' }));
    writeFileSync(
      join(root, 'packages/workbench/src/features.ts'),
      "export const features = defineFeatures({draft:{status:'dev',note:'Draft entry'}});",
    );
    writeFileSync(join(root, 'packages/workbench/src/entry.ts'), "isFeatureEnabled('draft');");
    writeFileSync(join(root, 'scripts/release/version.mjs'), 'export function setVersions() {}');
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init');
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'test: fixture',
    );
    const plan = await prepareRelease(root, 'patch');
    expect(readFileSync(join(root, plan.notes), 'utf8')).toContain(
      '## 仍为未完成状态的功能（未随本版本开启）\n\n- draft: Draft entry',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
