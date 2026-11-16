// SPDX-License-Identifier: MIT
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmRegistry, publicationAuth, protectToken, publishPackages, readCredentialStatus,
  saveCredential, validateMetadata, verifyRegistryToken } from './core-publish-auth.mjs';

const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const metadata = () => ({ format: 1, registry: npmRegistry, name: 'test', packages: publishPackages,
  permission: 'read-write', orgPermission: 'no-access', bypass2fa: true, expires: new Date(Date.now() + 86_400_000).toISOString() });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tano-auth-test-')); directories.push(directory);
  return { directory, path: join(directory, 'credential.json') };
}
it('rejects expired, broad or interactive credentials', () => {
  for (const patch of [{ expires: '2000-01-01' }, { packages: [...publishPackages, '@other/package'] },
    { bypass2fa: false }, { permission: 'read-write-stage-only' }, { orgPermission: 'read-write' }])
    expect(() => validateMetadata({ ...metadata(), ...patch })).toThrow();
});
it('rejects server metadata granting organization or scope-wide access, revoked or stage-only tokens', () => {
  const token = { name: 'test', bypass_2fa: true, expiry: metadata().expires,
    scopes: publishPackages.map(name => ({ name, type: 'package' })), permissions: [{ name: 'package', action: 'write' }] };
  expect(verifyRegistryToken(token, 'test').packages).toEqual(publishPackages);
  for (const patch of [{ revoked: true }, { bypass_2fa: false }, { expiry: '2000-01-01' },
    { scopes: [{ name: '@tano.page', type: 'scope' }] },
    { permissions: [...token.permissions, { name: 'organization', action: 'write' }] },
    { permissions: [{ name: 'package', action: 'write-stage-only' }] }])
    expect(() => verifyRegistryToken({ ...token, ...patch }, 'test')).toThrow('policy');
});
it('persists only protected credentials and excludes secrets from status', async () => {
  const f = await fixture();
  await saveCredential('fake-secret', metadata(), { path: f.path, protect: () => 'protected-value' });
  expect(await readFile(f.path, 'utf8')).not.toContain('fake-secret');
  const status = await readCredentialStatus(f);
  expect(status.valid).toBe(true);
  expect(JSON.stringify(status)).not.toContain('protected-value');
});
it('uses an isolated npmrc with interpolation, leaves parent environment intact and removes it afterwards', async () => {
  const f = await fixture();
  const env = { NODE_AUTH_TOKEN: 'fake-secret', npm_config_otp: '123456', NPM_CONFIG_USERCONFIG: 'old' };
  const auth = await publicationAuth({ env, path: f.path, temporaryRoot: f.directory });
  try {
    expect(auth.env.TANO_NPM_PUBLISH_TOKEN).toBe('fake-secret');
    expect(auth.env.npm_config_otp).toBeUndefined();
    expect(auth.env.NODE_AUTH_TOKEN).toBeUndefined();
    expect(await readFile(auth.env.NPM_CONFIG_USERCONFIG, 'utf8')).toContain('${TANO_NPM_PUBLISH_TOKEN}');
    expect(await readFile(auth.env.NPM_CONFIG_USERCONFIG, 'utf8')).not.toContain('fake-secret');
    expect(env.NODE_AUTH_TOKEN).toBe('fake-secret');
  } finally { await auth.dispose(); }
  await expect(readFile(auth.env.NPM_CONFIG_USERCONFIG)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('loads a protected token, but rejects expiry and other registries before decryption', async () => {
  const f = await fixture();
  await writeFile(f.path, JSON.stringify({ ...metadata(), encryptedToken: 'cipher' }));
  const auth = await publicationAuth({ env: {}, path: f.path, unprotect: value => value === 'cipher' ? 'fake-secret' : '', temporaryRoot: f.directory });
  await auth.dispose();
  await writeFile(f.path, JSON.stringify({ ...metadata(), expires: '2000-01-01', encryptedToken: 'cipher' }));
  await expect(publicationAuth({ env: {}, path: f.path, unprotect: () => { throw new Error('must not decrypt'); } })).rejects.toThrow('expired');
  await expect(publicationAuth({ env: { NPM_TOKEN: 'fake-secret' }, registry: 'https://other.invalid/' })).rejects.toThrow('restricted');
});
it.runIf(process.platform === 'win32')('roundtrips through Windows DPAPI', () => {
  const ciphertext = protectToken('test-only-not-a-real-credential');
  expect(ciphertext).not.toContain('test-only');
  expect(protectToken(ciphertext, true)).toBe('test-only-not-a-real-credential');
});
