import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Release URLs require HTTPS without credentials, query or fragment');
  return url;
}

export function releaseVersion(value) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      value,
    )
  )
    throw new Error('Expected a SemVer release version without a v prefix');
  return value;
}

function decode(value) {
  const clean = value.trim();
  const bytes = Buffer.from(clean, 'base64');
  if (!clean || bytes.toString('base64') !== clean) throw new Error('Invalid base64 encoding');
  return bytes;
}

/** Verify the Tauri CLI's Minisign envelope with Node's Ed25519 implementation.
 * Both payload and trusted version comment are authenticated before publishing.
 * Only the modern prehashed format emitted by our pinned CLI is accepted. */
export function verifyArtifact(bytes, encodedSignature, encodedPublicKey, version) {
  const keyLines = decode(encodedPublicKey).toString('utf8').trimEnd().split(/\r?\n/);
  const signatureLines = decode(encodedSignature).toString('utf8').trimEnd().split(/\r?\n/);
  if (
    keyLines.length !== 2 ||
    signatureLines.length !== 4 ||
    !signatureLines[2].startsWith('trusted comment: ')
  )
    throw new Error('Invalid Minisign envelope');
  const key = decode(keyLines[1]),
    packet = decode(signatureLines[1]),
    global = decode(signatureLines[3]);
  if (
    key.length !== 42 ||
    !['Ed', 'ED'].includes(key.subarray(0, 2).toString()) ||
    packet.length !== 74 ||
    packet.subarray(0, 2).toString() !== 'ED' ||
    global.length !== 64 ||
    !key.subarray(2, 10).equals(packet.subarray(2, 10))
  )
    throw new Error('Unsupported signature or signing key mismatch');
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]),
    format: 'der',
    type: 'spki',
  });
  const signature = packet.subarray(10),
    trusted = signatureLines[2].slice(17);
  if (
    !verify(null, createHash('blake2b512').update(bytes).digest(), publicKey, signature) ||
    !verify(null, Buffer.concat([signature, Buffer.from(trusted)]), publicKey, global)
  )
    throw new Error('Update signature verification failed');
  const versions = trusted.split('\t').filter((field) => field.startsWith('version:'));
  if (versions.length !== 1 || versions[0].slice(8) !== releaseVersion(version))
    throw new Error('Signed version does not match the manifest version');
}

export async function createManifest({
  version,
  publicKey,
  baseUrl,
  artifacts,
  notes = '',
  publishedAt = new Date().toISOString(),
}) {
  releaseVersion(version);
  const base = httpsUrl(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const platforms = {},
    checksums = {},
    names = new Set();
  for (const { target, path } of artifacts) {
    if (
      !/^(windows|darwin|linux)-(x86_64|aarch64|i686)(-(nsis|msi|app|appimage))?$/.test(target) ||
      platforms[target]
    )
      throw new Error(`Unsupported or duplicate target: ${target}`);
    const name = basename(path);
    if (names.has(name)) throw new Error(`Artifact filenames must be unique: ${name}`);
    names.add(name);
    const [bytes, signature] = await Promise.all([readFile(path), readFile(`${path}.sig`, 'utf8')]);
    verifyArtifact(bytes, signature, publicKey, version);
    platforms[target] = {
      url: new URL(encodeURIComponent(name), base).href,
      signature: signature.trim(),
    };
    checksums[name] = {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  if (!artifacts.length) throw new Error('At least one signed artifact is required');
  return { manifest: { version, notes, pub_date: publishedAt, platforms }, checksums };
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'public-key-file': { type: 'string' },
      'base-url': { type: 'string' },
      artifact: { type: 'string', multiple: true },
      notes: { type: 'string' },
      out: { type: 'string' },
    },
  });
  for (const key of ['version', 'public-key-file', 'base-url', 'out'])
    if (!values[key]) throw new Error(`Missing --${key}`);
  const artifacts = (values.artifact ?? []).map((value) => {
    const split = value.indexOf('=');
    if (split < 1) throw new Error('--artifact must be target=path');
    return { target: value.slice(0, split), path: resolve(value.slice(split + 1)) };
  });
  const result = await createManifest({
    version: values.version,
    publicKey: await readFile(values['public-key-file'], 'utf8'),
    baseUrl: values['base-url'],
    artifacts,
    notes: values.notes ? await readFile(values.notes, 'utf8') : '',
  });
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(result.manifest, null, 2)}\n`);
  await writeFile(`${values.out}.checksums.json`, `${JSON.stringify(result.checksums, null, 2)}\n`);
  console.log(`Verified ${artifacts.length} signed artifact(s); manifest: ${resolve(values.out)}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
