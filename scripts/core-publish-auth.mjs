// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { corePackages } from './core-distribution.mjs';

export const publishPackages = corePackages.map(name => `@tano.page/${name}`);
export const npmRegistry = 'https://registry.npmjs.org/';
export const authSetupHint = 'Run npm run core:auth:setup in an interactive Windows terminal.';

export function credentialPath(env = process.env) {
  if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required for the Windows publication credential.');
  return join(env.LOCALAPPDATA, 'Tano/release-operations/npm-publish-token.json');
}

// DPAPI binds the ciphertext to the current Windows user. Secrets travel over
// stdin/stdout pipes, never in command arguments, shell text or on-disk npmrc.
export function protectToken(token, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Local encrypted publication credentials require Windows.');
  const transform = decrypt
    ? '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))';
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); [Console]::Out.Write(${transform})`],
    { input: token, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }).trim();
  } catch {
    throw new Error('Cannot access the publication credential with Windows DPAPI. Use the Windows account that created it.');
  }
}

export function validateMetadata(record, now = Date.now()) {
  const expected = [...publishPackages].sort();
  if (record.format !== 1 || record.registry !== npmRegistry || record.bypass2fa !== true ||
      record.permission !== 'read-write' || record.orgPermission !== 'no-access' ||
      JSON.stringify([...(record.packages ?? [])].sort()) !== JSON.stringify(expected))
    throw new Error(`Publication credential must allow direct publication with bypass 2FA for exactly the five Core packages. ${authSetupHint}`);
  if (!Number.isFinite(Date.parse(record.expires)) || Date.parse(record.expires) <= now)
    throw new Error(`Publication credential has expired. ${authSetupHint}`);
  return record;
}

export function verifyRegistryToken(record, name) {
  const scopes = record?.scopes;
  const permissions = record?.permissions;
  if (!record || record.name !== name || record.revoked || record.bypass_2fa !== true ||
      !Array.isArray(scopes) || scopes.some(scope => scope.type !== 'package') ||
      JSON.stringify(scopes.map(scope => scope.name).sort()) !== JSON.stringify([...publishPackages].sort()) ||
      !Array.isArray(permissions) || permissions.length !== 1 ||
      permissions[0].name !== 'package' || permissions[0].action !== 'write' ||
      !Number.isFinite(Date.parse(record.expiry)) || Date.parse(record.expiry) <= Date.now())
    throw new Error('Registry token permissions or expiration do not match the dedicated Core publication policy.');
  return { name, packages: publishPackages, permission: 'read-write', orgPermission: 'no-access',
    bypass2fa: true, expires: record.expiry };
}

export async function saveCredential(token, metadata, { path = credentialPath(), protect = protectToken } = {}) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Invalid publication credential.');
  const record = validateMetadata({ ...metadata, format: 1, registry: npmRegistry });
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ ...record, encryptedToken: protect(token) }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function readCredentialStatus({ path = credentialPath() } = {}) {
  let record;
  try { record = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { configured: false, path };
    throw new Error('Cannot read the encrypted publication credential.');
  }
  // Only these non-secret fields may be displayed or written into evidence.
  const status = { configured: true, path, name: record.name, expires: record.expires,
    packages: record.packages, bypass2fa: record.bypass2fa, permission: record.permission };
  try { validateMetadata(record); return { ...status, valid: true }; }
  catch (error) { return { ...status, valid: false, reason: error.message }; }
}

export async function publicationAuth({ registry = npmRegistry, env = process.env,
  path,
  unprotect = value => protectToken(value, true), temporaryRoot = tmpdir() } = {}) {
  if (registry !== npmRegistry) throw new Error('The Core publication credential is restricted to registry.npmjs.org.');
  // Explicit automation credentials also support the existing manual CI job.
  let token = env.TANO_NPM_PUBLISH_TOKEN || env.NODE_AUTH_TOKEN || env.NPM_TOKEN;
  let source = 'environment';
  if (!token) {
    if (!path && process.platform === 'win32') path = credentialPath(env);
    if (!path) throw new Error(`Set NODE_AUTH_TOKEN to a dedicated publishing token. ${authSetupHint}`);
    let record;
    try { record = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Dedicated npm publication credential is not configured. ${authSetupHint}`);
      throw new Error('Cannot read the encrypted publication credential.');
    }
    validateMetadata(record);
    token = unprotect(record.encryptedToken);
    source = 'Windows DPAPI';
  }
  if (!token || /[\r\n]/.test(token)) throw new Error('Invalid publication credential.');
  const directory = await mkdtemp(join(temporaryRoot, 'tano-npm-publish-'));
  try {
    const config = join(directory, '.npmrc');
    await writeFile(config, 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${TANO_NPM_PUBLISH_TOKEN}\n', { mode: 0o600 });
    const childEnv = { ...env };
    // Do not let an inherited OTP, userconfig or other token override this one.
    for (const key of Object.keys(childEnv))
      if (/^npm_config_(userconfig|prefix|local_prefix|global|globalconfig|otp|.*auth.*|.*password.*|logs_max)$/i.test(key) || /^(NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key)) delete childEnv[key];
    Object.assign(childEnv, { TANO_NPM_PUBLISH_TOKEN: token, NPM_CONFIG_USERCONFIG: config, NPM_CONFIG_LOGS_MAX: '0' });
    return { cwd: directory, env: childEnv, source,
      dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
