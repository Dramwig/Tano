import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, httpsUrl } from './updater-manifest.mjs';
import { checkVersions } from './version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function main() {
  const version = checkVersions(root, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error(
      'This release wrapper currently builds Windows x64 NSIS; other desktop builds use the manifest tool after native signing.',
    );
  for (const name of [
    'TANO_UPDATER_URL',
    'TANO_UPDATER_PUBLIC_KEY',
    'TANO_RELEASE_BASE_URL',
    'TAURI_SIGNING_PRIVATE_KEY',
  ])
    if (!process.env[name]?.trim())
      throw new Error(`Missing ${name}; no unsigned fallback is allowed`);
  httpsUrl(process.env.TANO_UPDATER_URL);
  httpsUrl(process.env.TANO_RELEASE_BASE_URL);
  const config = JSON.parse(
    await readFile(join(root, 'apps/client/src-tauri/tauri.conf.json'), 'utf8'),
  );
  const destination = process.env.TANO_RELEASE_OUTPUT_DIR
    ? resolve(process.env.TANO_RELEASE_OUTPUT_DIR)
    : join(root, 'artifacts/releases', version);
  await mkdir(destination, { recursive: true });
  const override = join(destination, 'updater-build.json');
  await writeFile(
    override,
    JSON.stringify({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: { pubkey: process.env.TANO_UPDATER_PUBLIC_KEY.trim(), requireSignedVersion: true },
      },
    }),
  );
  // Resolve custom targets from the repository root once. The Tauri command
  // runs from apps/client, so passing a relative CARGO_TARGET_DIR through
  // unchanged would make Cargo and the artifact lookup disagree.
  const configuredTarget = process.env.CARGO_TARGET_DIR?.trim();
  const targetDirectory = configuredTarget
    ? isAbsolute(configuredTarget)
      ? resolve(configuredTarget)
      : resolve(root, configuredTarget)
    : join(root, 'apps/client/src-tauri/target');
  const buildEnv = { ...process.env, CARGO_TARGET_DIR: targetDirectory };
  const build = spawnSync(
    process.execPath,
    [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', override],
    { cwd: join(root, 'apps/client'), env: buildEnv, stdio: 'inherit' },
  );
  if (build.error || build.status !== 0)
    throw new Error(`Signed build failed (${build.status ?? build.error?.message})`);
  const bundle = join(targetDirectory, 'release/bundle/nsis');
  const matches = (await readdir(bundle)).filter(
    (name) => name === `${config.productName}_${version}_x64-setup.exe`,
  );
  if (matches.length !== 1) throw new Error('Expected exactly one Windows x64 installer');
  const source = join(bundle, matches[0]);
  const releaseName = `Tano-Local_${version}_x64-setup.exe`;
  const artifact = join(destination, releaseName);
  await copyFile(source, artifact);
  await copyFile(`${source}.sig`, `${artifact}.sig`);
  // Verify the final installer, signature and embedded signed version before
  // generating any feed. Signing keys are never written or logged.
  const result = await createManifest({
    version,
    publicKey: process.env.TANO_UPDATER_PUBLIC_KEY,
    baseUrl: process.env.TANO_RELEASE_BASE_URL,
    artifacts: [{ target: 'windows-x86_64', path: artifact }],
    notes: process.env.TANO_RELEASE_NOTES_FILE
      ? await readFile(process.env.TANO_RELEASE_NOTES_FILE, 'utf8')
      : '',
  });
  await writeFile(
    join(destination, 'latest.json'),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
  );
  await writeFile(
    join(destination, 'checksums.json'),
    `${JSON.stringify(result.checksums, null, 2)}\n`,
  );
  console.log(
    `Verified signed release prepared at ${destination}. Publish artifacts before latest.json.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
