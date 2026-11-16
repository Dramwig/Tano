import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
// @ts-expect-error Release tooling runs directly in Node without a TypeScript build.
import { verifyRelease } from './verify-release.mjs';
// @ts-expect-error Release tooling runs directly in Node without a TypeScript build.
import { createManifest } from './updater-manifest.mjs';

it('verifies the transferred installer, signature, checksums and GitHub feed URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tano-publish-'));
  const fixture = 'apps/client/src-tauri/test-fixtures/updater';
  const installer = 'Tano-Local_9.9.9_x64-setup.exe';
  try {
    await copyFile(join(fixture, 'payload.txt'), join(root, installer));
    await copyFile(join(fixture, 'payload.txt.sig'), join(root, `${installer}.sig`));
    const publicKey = await readFile(join(fixture, 'public-key.txt'), 'utf8');
    const { manifest, checksums } = await createManifest({
      version: '9.9.9', publicKey,
      baseUrl: 'https://github.com/owner/tano/releases/download/v9.9.9/',
      artifacts: [{ target: 'windows-x86_64', path: join(root, installer) }],
    });
    await writeFile(join(root, 'latest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'checksums.json'), JSON.stringify(checksums));
    await expect(verifyRelease(root, '9.9.9', 'owner/tano', publicKey)).resolves.toBe(installer);
    checksums[installer].sha256 = '0'.repeat(64);
    await writeFile(join(root, 'checksums.json'), JSON.stringify(checksums));
    await expect(verifyRelease(root, '9.9.9', 'owner/tano', publicKey)).rejects.toThrow('checksum');
    const { checksums: validChecksums } = await createManifest({
      version: '9.9.9', publicKey,
      baseUrl: 'https://github.com/owner/tano/releases/download/v9.9.9/',
      artifacts: [{ target: 'windows-x86_64', path: join(root, installer) }],
    });
    await writeFile(join(root, 'checksums.json'), JSON.stringify(validChecksums));
    manifest.platforms['windows-x86_64'].url = 'https://example.com/other.exe';
    await writeFile(join(root, 'latest.json'), JSON.stringify(manifest));
    await expect(verifyRelease(root, '9.9.9', 'owner/tano', publicKey)).rejects.toThrow('manifest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
