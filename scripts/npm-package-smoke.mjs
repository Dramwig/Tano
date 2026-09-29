import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (!process.argv[2])
  throw new Error('Usage: node scripts/npm-package-smoke.mjs <installed package>');
const installed = await realpath(resolve(process.argv[2]));
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
const entry = join(installed, manifest.bin.tano);
assert.equal(manifest.private, undefined);
assert(!Object.keys(manifest.dependencies).some((name) => name.startsWith('@tano/')));
for (const argument of ['--help', '--version']) {
  const result = spawnSync(process.execPath, [entry, argument], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes(argument === '--help' ? '--workspace' : manifest.version));
}
const directory = await mkdtemp(join(tmpdir(), 'tano-npm-smoke-'));
const verified = await realpath(directory);
const root = join(directory, 'workspace');
const data = join(directory, 'app-data');
await mkdir(join(root, '.tano'), { recursive: true });
await writeFile(join(root, '.tano/config.json'), JSON.stringify({ format: 1, id: randomUUID() }));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry, 'mcp', '--workspace', root, '--data-dir', data],
  cwd: directory,
  stderr: 'pipe',
});
let errors = '';
transport.stderr?.on('data', (bytes) => {
  errors += bytes;
});
const client = new Client({ name: 'npm-package-smoke', version: '1' });
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  const created = await client.callTool({
    name: 'tano_create_document',
    arguments: { path: 'Test.md', content: '# Original\n' },
  });
  assert.notEqual(created.isError, true);
  const read = await client.callTool({
    name: 'tano_read_document',
    arguments: { path: 'Test.md' },
  });
  const snapshot = JSON.parse(read.content[0].text);
  const write = await client.callTool({
    name: 'tano_write_document',
    arguments: { path: 'Test.md', content: '# Updated\n', expectedHash: snapshot.sha256 },
  });
  assert.notEqual(write.isError, true);
  const stale = await client.callTool({
    name: 'tano_write_document',
    arguments: { path: 'Test.md', content: 'Stale', expectedHash: snapshot.sha256 },
  });
  assert.equal(stale.isError, true);
  assert.equal(await readFile(join(root, 'Test.md'), 'utf8'), '# Updated\n');
  const duplicate = await client.callTool({
    name: 'tano_create_document',
    arguments: { path: 'Test.md', content: 'Overwrite' },
  });
  assert.equal(duplicate.isError, true);
  const escape = await client.callTool({
    name: 'tano_read_document',
    arguments: { path: '../outside.md' },
  });
  assert.equal(escape.isError, true);
  assert.equal(await readFile(join(root, 'Test.md'), 'utf8'), '# Updated\n');
  console.log(
    `PASS installed ${manifest.name}@${manifest.version}: CLI, MCP handshake, create/read/write, stale-write, duplicate-create and path rejection`,
  );
} catch (error) {
  console.error(errors);
  throw error;
} finally {
  await client.close();
  if ((await realpath(directory)) !== verified) throw new Error('Temporary directory changed');
  await rm(directory, { recursive: true, force: true });
}
