// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { credentialPath, npmRegistry, publicationAuth, publishPackages,
  readCredentialStatus, saveCredential, verifyRegistryToken } from './core-publish-auth.mjs';

const setupNpmVersion = '11.21.1';

async function setupNpm() {
  const prefix = join(dirname(credentialPath()), 'npm-cli');
  const root = join(prefix, 'node_modules/npm');
  const installed = await readFile(join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  if (installed.version !== setupNpmVersion) {
    const cli = process.env.npm_execpath;
    if (!cli?.endsWith('.js')) throw new Error('Start setup with npm run core:auth:setup.');
    console.log(`Installing isolated npm ${setupNpmVersion} for credential setup (outside the repository).`);
    execFileSync(process.execPath, [cli, 'install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `npm@${setupNpmVersion}`],
      { stdio: 'inherit', windowsHide: true });
  }
  // This adapter is intentionally pinned: npm has no stable programmatic API.
  // Use its own web-2FA flow without ever printing token-create's secret output.
  const require = createRequire(join(root, 'package.json'));
  return { Npm: require('./lib/npm.js'), fetch: require('npm-registry-fetch'),
    auth: require('./lib/utils/auth.js'), read: require('./lib/utils/read-user-info.js') };
}

export async function createPublicationCredential() {
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Run npm run core:auth:setup in an interactive Windows terminal.');
  console.log('Create a local Tano npm publishing token:');
  console.log(`  Packages: ${publishPackages.join(', ')}`);
  console.log('  Permission: direct read-write, bypass publishing 2FA; no organization administration.');
  console.log('  Lifetime: 90 days. Stored encrypted for this Windows user; never printed.');
  console.log('  npm plans to end direct publication with these tokens in January 2027.');
  const { Npm, fetch, auth, read } = await setupNpm();
  const npm = new Npm({ argv: ['--registry', npmRegistry, '--logs-max=0', '--loglevel=notice'] });
  let password;
  try {
    await npm.load();
    // npm normally adds command context when executing its token command. This
    // adapter supplies it explicitly so the registry returns browser polling
    // URLs instead of the legacy copy-an-OTP flow.
    let options = { ...npm.flatOptions, registry: npmRegistry, npmCommand: 'token', authType: 'web' };
    try { await fetch.json('/-/whoami', options); }
    catch (error) {
      if (!['E401', 'ENEEDAUTH'].includes(error.code)) throw error;
      console.log('The existing npm login has expired. Complete this one-time browser login.');
      const { newCreds } = await auth.login(npm, { ...options, creds: {} });
      // Keep the setup login in memory; preserve ~/.npmrc for other projects.
      options = { ...options, forceAuth: { token: newCreds.token } };
    }
    password = await read.password('npm account password (hidden; only sent to npm): ');
    const body = { name: `tano-local-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      password, packages: publishPackages, packages_and_scopes_permission: 'read-write',
      orgs_permission: 'no-access', expires: 90, bypass_2fa: true };
    const result = await auth.otplease(npm, options,
      opts => fetch.json('/-/npm/v1/tokens', { ...opts, method: 'POST', body }));
    password = undefined; delete body.password;
    if (!result.token) throw new Error('Registry did not return a token; do not retry without checking npm token settings.');
    // Persist immediately so a later network failure does not lose the only copy.
    await saveCredential(result.token, { name: body.name, tokenId: result.key,
      packages: publishPackages, permission: 'read-write', orgPermission: 'no-access', bypass2fa: true,
      expires: typeof result.expiry === 'string' && Number.isFinite(Date.parse(result.expiry))
        ? result.expiry : new Date(Date.now() + 90 * 86_400_000 - 120_000).toISOString() });
    const checkOptions = { ...options, forceAuth: { token: result.token } };
    const listing = await fetch.json('/-/npm/v1/tokens?perPage=1000', checkOptions);
    const verified = verifyRegistryToken(listing.objects?.find(item => item.name === body.name), body.name);
    await saveCredential(result.token, { ...verified, tokenId: result.key });
    const identity = await fetch.json('/-/whoami', checkOptions);
    console.log(`Saved and authenticated as ${identity.username}.`);
    console.log(`Encrypted credential: ${credentialPath()}`);
    console.log('Future npm run core:publish -- --apply releases will use this token automatically.');
    console.log('Renew with this same setup command when it expires; revoke the old token in npm settings.');
  } finally { password = undefined; npm.unload(); }
}

async function status(check) {
  const result = await readCredentialStatus();
  console.log(JSON.stringify(result, null, 2));
  if (!result.configured || !result.valid) { process.exitCode = 1; return; }
  if (check) {
    const auth = await publicationAuth();
    try {
      const cli = process.env.npm_execpath;
      if (!cli?.endsWith('.js')) throw new Error('Run through npm run core:auth:status.');
      const identity = execFileSync(process.execPath, [cli, 'whoami', '--registry', npmRegistry],
        { cwd: auth.cwd, env: auth.env, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
      const listing = JSON.parse(execFileSync(process.execPath, [cli, 'token', 'list', '--json', '--registry', npmRegistry],
        { cwd: auth.cwd, env: auth.env, encoding: 'utf8', stdio: 'pipe', windowsHide: true }));
      const verified = verifyRegistryToken(listing.find(item => item.name === result.name), result.name);
      console.log(`Registry identity: ${identity}. Five package write permissions and bypass 2FA verified; expires ${verified.expires}. No package was uploaded.`);
    } catch { throw new Error('Registry authentication failed. Renew the dedicated token or check the network.'); }
    finally { await auth.dispose(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const task = args.length === 0 ? createPublicationCredential()
    : args.every(arg => ['--status', '--check'].includes(arg)) && args.includes('--status') ? status(args.includes('--check'))
      : Promise.reject(new Error('Usage: npm run core:auth:setup | npm run core:auth:status -- [--check]'));
  task.catch(error => {
    // Registry errors can carry request bodies and credentials. Never serialize
    // errors, stderr, the token response or raw API bodies from setup.
    console.error(`Credential setup/status failed (${error.code ?? 'error'}). ${error.code ? 'Complete authentication in this terminal and retry if needed.' : error.message}`);
    process.exitCode = 1;
  });
}
