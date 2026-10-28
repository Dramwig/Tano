import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkVersions } from './version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'Dramwig/Tano';
const workflow = `${repository}/.github/workflows/local-desktop.yml`;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function releaseIdentity(version, sourceCommit) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error('Expected a stable Core version and full source commit');
  const tag = `core-v${version}`;
  const base = `https://github.com/${repository}/releases/download/${tag}/`;
  return { version, sourceCommit, tag, base, installer: `Tano-Local_${version}_x64-setup.exe` };
}
export function validateEvidence(evidence, identity, installerHash, unsignedPreview = false) {
  if (evidence?.sourceCommit !== identity.sourceCommit) throw new Error('Evidence must match the exact source commit');
  for (const command of ['npm run check', 'npm run test:native', 'npm run mcp:smoke'])
    if (!evidence.commands?.some(item => item.command === command && item.exitCode === 0))
      throw new Error(`Missing successful local evidence: ${command}`);
  if (installerHash) {
    if (evidence.installerSha256 !== installerHash) throw new Error('Acceptance must match the exact signed installer');
    for (const check of [unsignedPreview ? 'windowsInstall' : 'cleanWindowsInstall', 'launch', 'localWorkspace', 'mcp', 'productCoexistence', 'uninstallPreservesWorkspace', 'noAutomaticUpdater'])
      if (evidence.acceptance?.[check] !== true) throw new Error(`Missing installer acceptance: ${check}`);
  }
}
function source() {
  const version = checkVersions(root);
  const commit = run('git', ['rev-parse', 'HEAD']).trim();
  const identity = releaseIdentity(version, commit);
  if (run('git', ['rev-parse', `${identity.tag}^{commit}`]).trim() !== commit)
    throw new Error('Build only from the exact immutable Core tag');
  run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
  if (run('git', ['status', '--porcelain']).trim()) throw new Error('Release source must be clean');
  return identity;
}
function verifySignature(file, thumbprint, unsignedPreview = false) {
  if (!unsignedPreview && !/^[A-Fa-f0-9]{40}$/.test(thumbprint ?? '')) throw new Error('Missing Windows code signing certificate thumbprint');
  run('pwsh', ['-NoProfile', '-File', join(root, 'scripts/verify-local-signature.ps1'), '-Path', file, ...(unsignedPreview ? ['-AllowUnsignedPreview'] : ['-Thumbprint', thumbprint])]);
}
function prepare(evidenceFile, unsignedPreview = false) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Local release requires Windows x64');
  const identity = source();
  validateEvidence(json(evidenceFile), identity);
  const thumbprint = process.env.TANO_LOCAL_CERTIFICATE_THUMBPRINT;
  if (!unsignedPreview && !/^[A-Fa-f0-9]{40}$/.test(thumbprint ?? '')) throw new Error('Configure TANO_LOCAL_CERTIFICATE_THUMBPRINT; unsigned previews require explicit --unsigned-preview');
  const destination = join(root, 'artifacts/local', identity.tag);
  mkdirSync(destination, { recursive: true });
  if (readdirSync(destination).length) throw new Error('Output already exists; preserve it and use a fresh checkout for a rebuild');
  const config = json(join(root, 'apps/client/src-tauri/tauri.conf.json'));
  if (config.productName !== 'Tano Local' || config.identifier !== 'app.tano.local' || config.plugins?.updater?.pubkey || config.plugins?.updater?.endpoints?.length)
    throw new Error('Unexpected Local application identity or updater configuration');
  const override = join(root, 'artifacts/local-build.json');
  save(override, { bundle: { createUpdaterArtifacts: false, windows: unsignedPreview ? { certificateThumbprint: null, signCommand: null } : {
    certificateThumbprint: thumbprint, digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com', tsp: true,
  } }, plugins: { updater: { pubkey: '', endpoints: [] } } });
  const target = resolve(root, process.env.CARGO_TARGET_DIR || 'apps/client/src-tauri/target');
  const env = { ...process.env, CARGO_TARGET_DIR: target };
  for (const name of ['TANO_UPDATER_URL', 'TANO_UPDATER_PUBLIC_KEY', 'TANO_UPDATER_CA_PEM', 'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'TANO_MCP_DEV_PATH', ...(unsignedPreview ? ['WINDOWS_CERTIFICATE', 'WINDOWS_CERTIFICATE_PASSWORD', 'TAURI_SIGNING_COMMAND'] : [])]) delete env[name];
  run(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--config', override], { cwd: join(root, 'apps/client'), env, stdio: 'inherit' });
  if (source().sourceCommit !== identity.sourceCommit) throw new Error('Source changed during the release build');
  const binaryRoot = join(target, 'x86_64-pc-windows-msvc/release');
  const installer = join(binaryRoot, 'bundle/nsis', `Tano Local_${identity.version}_x64-setup.exe`);
  verifySignature(join(binaryRoot, 'tano.exe'), thumbprint, unsignedPreview);
  verifySignature(installer, thumbprint, unsignedPreview);
  copyFileSync(installer, join(destination, identity.installer));
  copyFileSync(join(root, 'LICENSE'), join(destination, 'LICENSE'));
  copyFileSync(join(root, 'apps/client/public/THIRD_PARTY_NOTICES.txt'), join(destination, 'THIRD_PARTY_NOTICES.txt'));
  save(join(destination, 'local-release.json'), {
    format: 1, edition: 'local', version: identity.version, sourceCommit: identity.sourceCommit, tag: identity.tag,
    windowsUrl: identity.base + identity.installer,
    sourceUrl: `https://github.com/${repository}/tree/${identity.tag}`,
    checksumsUrl: identity.base + 'SHA256SUMS.txt', provenanceUrl: identity.base + 'local-provenance.jsonl',
    certificateThumbprint: unsignedPreview ? null : thumbprint.toUpperCase(), automaticUpdates: false,
    preview: unsignedPreview, authenticode: unsignedPreview ? 'unsigned' : 'signed',
  });
  writeFileSync(join(destination, 'SHA256SUMS.txt'), readdirSync(destination).sort().map(name => `${sha256(readFileSync(join(destination, name)))}  ${name}\n`).join(''));
  console.log(`Signed Local artifacts prepared: ${destination}`);
}
function publish(directory, evidenceFile, unsignedPreview = false) {
  const identity = source();
  const manifest = json(join(directory, 'local-release.json'));
  if (unsignedPreview !== (manifest.preview === true && manifest.authenticode === 'unsigned' && manifest.certificateThumbprint === null)) throw new Error('Unsigned preview publication requires explicit --unsigned-preview and matching metadata');
  if (manifest.edition !== 'local' || manifest.version !== identity.version || manifest.sourceCommit !== identity.sourceCommit || manifest.tag !== identity.tag || manifest.windowsUrl !== identity.base + identity.installer || manifest.automaticUpdates !== false)
    throw new Error('Local metadata does not match this Core source');
  const names = [identity.installer, 'local-release.json', 'SHA256SUMS.txt', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'local-provenance.jsonl'];
  const actual = readdirSync(directory);
  if (actual.length !== names.length || actual.some(name => !names.includes(name))) throw new Error('Unexpected or incomplete Local release assets');
  const expectedSums = names.filter(name => !['SHA256SUMS.txt', 'local-provenance.jsonl'].includes(name)).sort().map(name => `${sha256(readFileSync(join(directory, name)))}  ${name}\n`).join('');
  if (readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8') !== expectedSums) throw new Error('Local checksums differ');
  const installer = join(directory, identity.installer);
  validateEvidence(json(evidenceFile), identity, sha256(readFileSync(installer)), unsignedPreview);
  verifySignature(installer, manifest.certificateThumbprint, unsignedPreview);
  // The signer ref must be the tag too: dispatch the workflow at the Core tag,
  // never attest a checkout from main while claiming its caller was the tag.
  run('gh', ['attestation', 'verify', installer, '--repo', repository, '--signer-workflow', workflow, '--signer-digest', identity.sourceCommit, '--source-ref', `refs/tags/${identity.tag}`, '--source-digest', identity.sourceCommit, '--deny-self-hosted-runners', '--bundle', join(directory, 'local-provenance.jsonl')], { stdio: 'inherit' });
  run('gh', ['attestation', 'verify', join(directory, 'local-release.json'), '--repo', repository, '--signer-workflow', workflow, '--signer-digest', identity.sourceCommit, '--source-ref', `refs/tags/${identity.tag}`, '--source-digest', identity.sourceCommit, '--deny-self-hosted-runners', '--bundle', join(directory, 'local-provenance.jsonl')], { stdio: 'inherit' });
  const gh = args => run('gh', [...args, '--repo', repository]);
  // Core registry publication creates this release first. Never infer a missing
  // release from a failed/authenticated request and never change Product latest.
  const release = JSON.parse(gh(['release', 'view', identity.tag, '--json', 'assets,isDraft,isPrerelease,targetCommitish']));
  if (release.isDraft || release.isPrerelease || !release.assets.some(asset => asset.name === 'core-registry.json')) throw new Error('Publish the stable six-package Core release first');
  const registry = JSON.parse(gh(['release', 'download', identity.tag, '--pattern', 'core-registry.json', '--output', '-']));
  if (registry.version !== identity.version || registry.sourceCommit !== identity.sourceCommit || registry.dirty !== false || registry.packages?.length !== 5 || registry.native?.version !== identity.version)
    throw new Error('Published Core package set does not match this Local source');
  const staging = mkdtempSync(join(tmpdir(), 'tano-local-verify-'));
  try {
    for (const name of names) if (release.assets.some(asset => asset.name === name)) {
      gh(['release', 'download', identity.tag, '--pattern', name, '--dir', staging]);
      if (sha256(readFileSync(join(staging, name))) !== sha256(readFileSync(join(directory, name)))) throw new Error(`Immutable release asset differs: ${name}`);
    }
    gh(['release', 'edit', identity.tag, '--latest=false']);
    const missing = names.filter(name => !release.assets.some(asset => asset.name === name));
    if (missing.length) gh(['release', 'upload', identity.tag, ...missing.map(name => join(directory, name))]);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.log(`Published Tano Local without changing Product latest: ${identity.base}local-release.json`);
}
export function runLocalRelease(args = process.argv.slice(2)) {
  try {
    const [command, first, second] = args;
    if (command === 'prepare' && first) prepare(resolve(first), args.includes('--unsigned-preview'));
    else if (command === 'publish' && first && second) publish(resolve(first), resolve(second), args.includes('--unsigned-preview'));
    else throw new Error('Usage: node scripts/local-release.mjs prepare <local-evidence.json> | publish <artifact-directory> <installer-acceptance.json>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runLocalRelease();
