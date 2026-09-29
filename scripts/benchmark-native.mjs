// Opt-in real filesystem/SQLite benchmark. Rust owns and removes its temporary data.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const count = Number(process.argv[2] ?? 5000);
if (!Number.isInteger(count) || count < 100 || count > 20000)
  throw new Error('Use a document count between 100 and 20000');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
console.log(`Benchmarking ${count} Markdown files in isolated temporary directories…`);
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
      'large_workspace_scan_and_search',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      cwd: root,
      env: { ...process.env, TANO_BENCH_FILES: String(count) },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
} catch (error) {
  await writeFile(
    join(artifacts, 'native-performance.log'),
    `${error.stdout ?? ''}${error.stderr ?? ''}`,
  );
  throw error;
}
await writeFile(join(artifacts, 'native-performance.log'), `${result.stdout}${result.stderr}`);
const line = result.stdout.split(/\r?\n/).find((line) => line.startsWith('TANO_BENCHMARK '));
if (!line) throw new Error('Benchmark did not produce its result');
const report = {
  checkedAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  ...JSON.parse(line.slice('TANO_BENCHMARK '.length)),
  limits: [
    'Five repeated scans and twenty samples per query; not a load-test percentile guarantee',
    'OS filesystem caches are not cleared; initial means new SQLite index, not cold disk',
    'Does not measure editor rendering, WebSocket latency, mobile battery or physical-device performance',
  ],
};
await writeFile(join(artifacts, 'native-performance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
