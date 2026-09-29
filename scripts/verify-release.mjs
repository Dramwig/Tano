import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyArtifact } from './updater-manifest.mjs';

export async function verifyRelease(directory, version, repository, publicKey) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Expected a GitHub owner/repository');
  const installer = `Tano-Local_${version}_x64-setup.exe`;
  const expected = [installer, `${installer}.sig`, 'checksums.json', 'latest.json'];
  const actual = await readdir(directory);
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name)))
    throw new Error(`Unexpected release assets: ${actual.join(', ')}`);
  const [bytes, signature, checksumsText, manifestText] = await Promise.all([
    readFile(join(directory, installer)),
    readFile(join(directory, `${installer}.sig`), 'utf8'),
    readFile(join(directory, 'checksums.json'), 'utf8'),
    readFile(join(directory, 'latest.json'), 'utf8'),
  ]);
  verifyArtifact(bytes, signature, publicKey, version);
  const checksums = JSON.parse(checksumsText);
  if (Object.keys(checksums).length !== 1 ||
      checksums[installer]?.bytes !== bytes.length ||
      checksums[installer]?.sha256 !== createHash('sha256').update(bytes).digest('hex'))
    throw new Error('Release checksum does not match the signed installer');
  const manifest = JSON.parse(manifestText);
  const expectedUrl = `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(installer)}`;
  if (manifest.version !== version ||
      Object.keys(manifest.platforms ?? {}).length !== 1 ||
      manifest.platforms['windows-x86_64']?.url !== expectedUrl ||
      manifest.platforms['windows-x86_64']?.signature !== signature.trim())
    throw new Error('Updater manifest does not match this release and installer');
  return installer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const version = process.argv[2];
    const directory = process.argv[3];
    if (!version || !directory) throw new Error('Usage: node scripts/verify-release.mjs <version> <directory>');
    const installer = await verifyRelease(
      resolve(directory), version, process.env.GITHUB_REPOSITORY ?? '', process.env.TANO_UPDATER_PUBLIC_KEY ?? '',
    );
    console.log(`Verified release assets for ${installer}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
