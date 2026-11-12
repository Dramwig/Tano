// Compile the real storage tests for Android and execute them on one attached device.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const target = process.argv[2] || 'x86_64';
if (!['x86_64', 'aarch64'].includes(target)) throw new Error('Use x86_64 or aarch64');
const sdk = process.env.ANDROID_HOME;
const ndk = process.env.NDK_HOME;
if (!sdk || !ndk) throw new Error('Set ANDROID_HOME and NDK_HOME; see docs/local-development.md');
const windows = process.platform === 'win32';
const host = windows
  ? 'windows-x86_64'
  : process.platform === 'darwin'
    ? 'darwin-x86_64'
    : 'linux-x86_64';
const triple = `${target}-linux-android`;
const bin = join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin');
const clang = join(bin, `${triple}26-clang${windows ? '.cmd' : ''}`);
const env = {
  ...process.env,
  [`CARGO_TARGET_${triple.toUpperCase().replaceAll('-', '_')}_LINKER`]: clang,
  [`CC_${triple.replaceAll('-', '_')}`]: clang,
  [`AR_${triple.replaceAll('-', '_')}`]: join(bin, `llvm-ar${windows ? '.exe' : ''}`),
};
const adbPath = join(sdk, 'platform-tools', `adb${windows ? '.exe' : ''}`);
const devices = await exec(adbPath, ['devices']);
const serials = devices.stdout
  .split(/\r?\n/)
  .map((line) => line.match(/^(\S+)\s+device$/)?.[1])
  .filter(Boolean);
const serial = process.env.ANDROID_SERIAL || (serials.length === 1 ? serials[0] : undefined);
if (!serial || !serials.includes(serial))
  throw new Error('Connect one device, or set ANDROID_SERIAL to an attached device');
const adb = (...args) => exec(adbPath, ['-s', serial, ...args], { maxBuffer: 16 * 1024 * 1024 });
console.log(`Building Rust native tests for ${triple}…`);
const built = await exec(
  windows ? 'cargo.exe' : 'cargo',
  [
    'test',
    '--locked',
    '--lib',
    '--no-run',
    '--target',
    triple,
    '--message-format=json',
    '--manifest-path',
    'crates/tano-native/Cargo.toml',
  ],
  { env, maxBuffer: 32 * 1024 * 1024 },
);
process.stderr.write(built.stderr);
const executable = built.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find(
    (item) =>
      item.reason === 'compiler-artifact' &&
      item.target.name === 'tano_native' &&
      item.profile.test &&
      item.executable,
  )?.executable;
if (!executable) throw new Error('Cargo did not return the test executable');
const remote = `/data/local/tmp/tano-tests-${randomUUID()}`;
await adb('shell', 'mkdir', remote);
let result;
try {
  await adb('push', executable, `${remote}/tests`);
  await adb('shell', 'chmod', '700', `${remote}/tests`);
  try {
    result = await adb('shell', 'env', `TMPDIR=${remote}`, `${remote}/tests`, '--test-threads=1');
  } catch (error) {
    result = error;
    process.exitCode = 1;
  }
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  await mkdir('artifacts', { recursive: true });
  await writeFile(resolve('artifacts/android-native-tests.log'), log);
  console.log(log);
} finally {
  await adb('shell', 'rm', '-f', `${remote}/tests`);
  // No recursive deletion: preserve any unexpected test residue for diagnosis.
  await adb('shell', 'rmdir', remote).catch(() => {});
}
