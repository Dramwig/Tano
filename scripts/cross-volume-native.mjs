// Opt-in test of real filesystem volume/device changes; Rust owns all fixtures.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const secondVolume = process.argv[2];
if (!secondVolume || !isAbsolute(secondVolume) || !(await stat(secondVolume)).isDirectory())
  throw new Error(
    'Pass an existing absolute directory on a different filesystem; only a new temporary child will be modified.',
  );
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
console.log('Testing real cross-volume moves in isolated temporary directories…');
let result;
try {
  result = await promisify(execFile)(
    process.platform === 'win32' ? 'cargo.exe' : 'cargo',
    [
      'test',
      '--release',
      '--locked',
      '--lib',
      '--features',
      'tauri/custom-protocol',
      '--manifest-path',
      'crates/tano-native/Cargo.toml',
      'portable_workspace_crosses_real_volumes_without_aliasing_documents',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      cwd: root,
      env: { ...process.env, TANO_SECOND_VOLUME: secondVolume },
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
} catch (error) {
  await writeFile(
    join(artifacts, 'cross-volume-native.log'),
    `${error.stdout ?? ''}${error.stderr ?? ''}`,
  );
  throw error;
}
await writeFile(join(artifacts, 'cross-volume-native.log'), `${result.stdout}${result.stderr}`);
const line = result.stdout.split(/\r?\n/).find((line) => line.startsWith('TANO_CROSS_VOLUME '));
if (!line) throw new Error('Cross-volume test did not report evidence');
const report = {
  checkedAt: new Date().toISOString(),
  ...JSON.parse(line.slice('TANO_CROSS_VOLUME '.length)),
  limits: [
    'Native storage test; not desktop UI or live File Sync/Yjs migration',
    'Reuses the same external metadata cache; lost cache cannot recover all file UUIDs',
    'Ambiguous identical content or simultaneous cross-volume rename and edit receives new identity',
  ],
};
await writeFile(
  join(artifacts, 'cross-volume-native.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
