import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configureBranches, matchesProtection, verifyReadBack } from './configure-branches.mjs';

const policy = JSON.parse(readFileSync(new URL('../.github/branch-protection.json', import.meta.url), 'utf8'));

function fixture(initial = {}) {
  const rules = new Map(Object.entries(initial)), calls = [];
  const repo = { default_branch: 'main', permissions: { admin: true } };
  const api = async (path, options = {}) => {
    calls.push([path, options]);
    if (path.endsWith('/protection')) {
      const branch = path.split('/').at(-2);
      if (options.method === 'PUT') rules.set(branch, structuredClone(options.body));
      return rules.get(branch);
    }
    if (path.includes('/branches/')) return { name: path.split('/').at(-1) };
    if (options.method === 'PATCH') Object.assign(repo, options.body);
    return repo;
  };
  return { api, calls, repo, rules };
}

describe('branch protection setup', () => {
  it('retries briefly for GitHub propagation but rejects persistent mismatches', async () => {
    let reads = 0;
    const sleep = async () => {};
    await verifyReadBack(async () => ++reads >= 2, value => value, 'Settings', { sleep });
    expect(reads).toBe(2);
    reads = 0;
    await expect(verifyReadBack(async () => { reads++; return false; }, value => value,
      'Settings', { sleep })).rejects.toThrow('Settings read-back failed');
    expect(reads).toBe(5);
  });
  it('previews missing protection without writing', async () => {
    const f = fixture();
    expect((await configureBranches(f.api, 'owner/repo', policy)).branches.map(b => b.state)).toEqual(['missing', 'missing']);
    expect(f.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it('protects and verifies both branches before enabling branch cleanup, and is idempotent', async () => {
    const f = fixture();
    expect((await configureBranches(f.api, 'owner/repo', policy, { apply: true })).branches.every(b => b.state === 'verified')).toBe(true);
    expect(f.calls.filter(([, options]) => options.method).map(([, options]) => options.method)).toEqual(['PUT', 'PUT', 'PATCH']);
    f.calls.length = 0;
    await configureBranches(f.api, 'owner/repo', policy, { apply: true });
    expect(f.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it('does not partially apply or weaken a different existing policy', async () => {
    const stricter = structuredClone(policy.settings);
    stricter.required_pull_request_reviews = {
      dismiss_stale_reviews: true, require_code_owner_reviews: false,
      required_approving_review_count: 2, require_last_push_approval: false,
    };
    const f = fixture({ dev: stricter });
    await expect(configureBranches(f.api, 'owner/repo', policy, { apply: true })).rejects.toThrow('differs');
    expect(f.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it('recognizes expanded GitHub responses and preserves additional protections', () => {
    const response = structuredClone(policy.settings);
    for (const key of ['enforce_admins', 'required_linear_history', 'allow_force_pushes', 'allow_deletions', 'required_conversation_resolution'])
      response[key] = { enabled: response[key] };
    // GitHub omits status checks when local validation is used.
    delete response.required_status_checks;
    // GitHub also omits review requirements when ordinary pushes are allowed.
    delete response.required_pull_request_reviews;
    // Personal repositories omit restrictions entirely when no restriction is set.
    delete response.restrictions;
    expect(matchesProtection(response, policy.settings)).toBe(true);
    expect(matchesProtection({ ...response, required_signatures: { enabled: true } }, policy.settings)).toBe(false);
  });
  it('refuses to apply without repository administration permission', async () => {
    const f = fixture();
    f.repo.permissions.admin = false;
    await expect(configureBranches(f.api, 'owner/repo', policy, { apply: true })).rejects.toThrow('administration');
    expect(f.calls.every(([, options]) => !options.method)).toBe(true);
  });
});
