import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(command, args, label, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`${label} failed to launch: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

const python = process.platform === 'win32' ? 'python' : 'python3';
run(
  python,
  ['-m', 'unittest', 'discover', '-s', 'packages/python-protocol/tests', '-p', 'test_*.py'],
  'Python protocol tests',
  { ...process.env, PYTHONPATH: resolve(root, 'packages/python-protocol/src') },
);
run(
  'cargo',
  ['test', '--manifest-path', 'packages/rust-protocol/Cargo.toml'],
  'Rust protocol tests',
);
console.log('Cross-language protocol parity verified (Python + Rust; TS verified by vitest).');
