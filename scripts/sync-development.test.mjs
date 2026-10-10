import { describe, expect, it } from 'vitest';
import { syncDevelopment } from './sync-development.mjs';

describe('main-to-dev history synchronization', () => {
  it('checks whether a PR is needed without requiring a write identity', async () => {
    const result = await syncDevelopment(async (path, options) => {
      expect(options?.method).toBeUndefined();
      return path.includes('/compare/') ? { ahead_by: 1 } : [];
    }, 'owner/repo', { checkOnly: true });
    expect(result).toEqual({ status: 'needs-pr' });
  });
  it('does nothing when dev already contains main, including dev-only development', async () => {
    const calls = [];
    expect(await syncDevelopment(async (path, options) => {
      calls.push([path, options]);
      return { ahead_by: 0, behind_by: 12 };
    }, 'owner/repo')).toEqual({ status: 'up-to-date' });
    expect(calls).toEqual([['/repos/owner/repo/compare/dev...main', undefined]]);
  });

  it('opens a PR between the real branches without replacing dev-only commits', async () => {
    const writes = [];
    const result = await syncDevelopment(async (path, options) => {
      if (options?.method) {
        writes.push([path, options]);
        return { html_url: 'https://github.com/owner/repo/pull/1' };
      }
      return path.includes('/compare/') ? { ahead_by: 2, behind_by: 5 } : [];
    }, 'owner/repo');
    expect(result.status).toBe('created');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/repos/owner/repo/pulls');
    expect(writes[0][1].body).toMatchObject({ base: 'dev', head: 'main' });
    expect(writes[0][1].body.body).toContain('Do not squash or rebase');
  });

  it('reuses an open PR as main advances', async () => {
    const result = await syncDevelopment(async (path, options) => {
      expect(options?.method).toBeUndefined();
      return path.includes('/compare/') ? { ahead_by: 3 } : [{ html_url: 'existing' }];
    }, 'owner/repo');
    expect(result).toEqual({ status: 'existing', url: 'existing' });
  });

  it('recovers a concurrent PR creation without hiding an authorization failure', async () => {
    for (const raced of [false, true]) {
      let lists = 0;
      const result = syncDevelopment(async (path, options) => {
        if (options?.method) throw new Error('HTTP 403');
        if (path.includes('/compare/')) return { ahead_by: 1 };
        return ++lists > 1 && raced ? [{ html_url: 'concurrent' }] : [];
      }, 'owner/repo');
      if (raced) expect(await result).toEqual({ status: 'existing', url: 'concurrent' });
      else await expect(result).rejects.toThrow('HTTP 403');
    }
  });

  it('rejects malformed repository names and incomplete comparisons before writing', async () => {
    await expect(syncDevelopment(() => { throw new Error('must not call'); }, '../repo')).rejects.toThrow('Invalid GitHub');
    await expect(syncDevelopment(async () => ({}), 'owner/repo')).rejects.toThrow('invalid branch comparison');
  });
});
