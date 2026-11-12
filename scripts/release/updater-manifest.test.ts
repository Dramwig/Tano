import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
// @ts-expect-error Node release tooling is kept executable without a TS build.
import { verifyArtifact, createManifest } from './updater-manifest.mjs';

const fixtures = 'apps/client/src-tauri/test-fixtures/updater';
it('verifies actual CLI signatures and rejects changed bytes, wrong version and forged trusted comments', async () => {
  const [bytes, signature, publicKey] = await Promise.all([
    readFile(join(fixtures, 'payload.txt')),
    readFile(join(fixtures, 'payload.txt.sig'), 'utf8'),
    readFile(join(fixtures, 'public-key.txt'), 'utf8'),
  ]);
  expect(() => verifyArtifact(bytes, signature, publicKey, '9.9.9')).not.toThrow();
  expect(() => verifyArtifact(Buffer.from('tampered'), signature, publicKey, '9.9.9')).toThrow(
    'signature',
  );
  expect(() => verifyArtifact(bytes, signature, publicKey, '10.0.0')).toThrow('version');
  const forged = Buffer.from(
    Buffer.from(signature.trim(), 'base64').toString().replace('version:9.9.9', 'version:10.0.0'),
  ).toString('base64');
  expect(() => verifyArtifact(bytes, forged, publicKey, '10.0.0')).toThrow('signature');
  const result = await createManifest({
    version: '9.9.9',
    publicKey,
    baseUrl: 'https://updates.example.com/v9.9.9',
    artifacts: [{ target: 'windows-x86_64', path: join(fixtures, 'payload.txt') }],
  });
  expect(result.manifest.platforms['windows-x86_64'].url).toBe(
    'https://updates.example.com/v9.9.9/payload.txt',
  );
  expect(result.checksums['payload.txt'].bytes).toBe(bytes.length);
  await expect(
    createManifest({
      version: '9.9.9',
      publicKey,
      baseUrl: 'http://updates.example.com',
      artifacts: [],
    }),
  ).rejects.toThrow('HTTPS');
});

it('refuses a missing signature and duplicate targets before writing a release manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tano-release-'));
  try {
    const path = join(directory, 'installer.exe');
    await writeFile(path, 'unsigned');
    const publicKey = await readFile(join(fixtures, 'public-key.txt'), 'utf8');
    await expect(
      createManifest({
        version: '9.9.9',
        publicKey,
        baseUrl: 'https://updates.example.com',
        artifacts: [{ target: 'windows-x86_64', path }],
      }),
    ).rejects.toThrow();
    const signed = { target: 'windows-x86_64', path: join(fixtures, 'payload.txt') };
    await expect(
      createManifest({
        version: '9.9.9',
        publicKey,
        baseUrl: 'https://updates.example.com',
        artifacts: [signed, signed],
      }),
    ).rejects.toThrow('duplicate');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
