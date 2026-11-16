// Builds a separate identity: it never registers as or shares AppData with Tano.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createManifest, releaseVersion } from './updater-manifest.mjs';
const version = releaseVersion(process.argv[2]);
const fixture = JSON.parse(await readFile('artifacts/updater-e2e-current.json', 'utf8'));
const output = join(fixture.root, `build-${version}`);
await mkdir(output, { recursive: true });
const publicKey = (await readFile(join(fixture.root, 'signing.key.pub'), 'utf8')).trim();
const config = {
  productName: fixture.productName,
  identifier: fixture.identifier,
  version,
  app: {
    windows: [
      { title: fixture.productName, width: 1440, height: 940, minWidth: 800, minHeight: 580 },
    ],
  },
  bundle: { createUpdaterArtifacts: true, windows: { nsis: { displayLanguageSelector: false } } },
  plugins: { updater: { pubkey: publicKey, requireSignedVersion: true } },
};
const configPath = join(output, 'build-config.json');
await writeFile(configPath, JSON.stringify(config, null, 2));
const result = spawnSync(
  process.execPath,
  [resolve('node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', configPath],
  {
    cwd: resolve('apps/client'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TANO_UPDATER_URL: `${fixture.serverUrl}/latest.json`,
      TANO_UPDATER_PUBLIC_KEY: publicKey,
      TANO_UPDATER_CA_PEM: await readFile(join(fixture.root, 'certs/ca.pem'), 'utf8'),
      TAURI_SIGNING_PRIVATE_KEY: await readFile(join(fixture.root, 'signing.key'), 'utf8'),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'fixture-only',
    },
  },
);
if (result.status !== 0) throw new Error(`QA build failed: ${result.status}`);
const filename = `${fixture.productName}_${version}_x64-setup.exe`;
const source = resolve('apps/client/src-tauri/target/release/bundle/nsis', filename);
const { manifest, checksums } = await createManifest({
  version,
  publicKey,
  baseUrl: `${fixture.serverUrl}/releases/`,
  artifacts: [{ target: 'windows-x86_64', path: source }],
  notes: `Isolated updater acceptance ${version}. Preserve documents and session.`,
});
await copyFile(source, join(fixture.root, 'releases', filename));
await copyFile(`${source}.sig`, join(fixture.root, 'releases', `${filename}.sig`));
await writeFile(join(fixture.root, `manifest-${version}.json`), JSON.stringify(manifest, null, 2));
await writeFile(join(output, 'checksums.json'), JSON.stringify(checksums, null, 2));
console.log(
  `Verified QA package ${version}; manifest is prepared but not served until explicitly copied to latest.json.`,
);
