// A real stdio MCP client runs the shipped, standalone CJS bundle outside the repo.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Pass an extracted package resource to verify the bundle users actually receive.
const bundle = await realpath(resolve(process.argv[2] ?? 'apps/mcp/dist/tano-mcp.cjs'));
const directory = await mkdtemp(join(tmpdir(), 'tano-mcp-production-'));
const verified = await realpath(directory);
const root = join(directory, 'workspace'),
  data = join(directory, 'data');
await mkdir(join(root, '.tano'), { recursive: true });
const workspaceId = randomUUID();
await writeFile(
  join(root, '.tano/config.json'),
  JSON.stringify({ format: 1, id: workspaceId }),
);
const entry = join(directory, 'tano-mcp.cjs');
await copyFile(bundle, entry);
let errors = '';
const connections = Array.from({ length: 4 }, (_, index) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, '--workspace', root, '--data-dir', data, '--access', 'write'],
    cwd: directory,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (bytes) => {
    errors += `[client ${index}] ${bytes}`;
  });
  return {
    transport,
    client: new Client({ name: `production-smoke-client-${index}`, version: '1' }),
  };
});
const client = connections[0].client;
try {
  await Promise.all(connections.map(({ client, transport }) => client.connect(transport)));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 18);
  const create = await client.callTool({
    name: 'tano_create_document',
    arguments: { path: 'Shared.md', content: '# Shared\n\nFirst\n' },
  });
  assert.notEqual(create.isError, true);
  const read = await client.callTool({
    name: 'tano_read_document',
    arguments: { path: 'Shared.md' },
  });
  const snapshot = JSON.parse(read.content[0].text);
  const update = await client.callTool({
    name: 'tano_write_document',
    arguments: {
      path: 'Shared.md',
      expectedHash: snapshot.sha256,
      content: '# Shared\n\nMCP updated\n',
    },
  });
  assert.notEqual(update.isError, true);
  const stale = await client.callTool({
    name: 'tano_write_document',
    arguments: { path: 'Shared.md', expectedHash: snapshot.sha256, content: 'Stale writer' },
  });
  assert.equal(stale.isError, true);
  assert.equal(await readFile(join(root, 'Shared.md'), 'utf8'), '# Shared\n\nMCP updated\n');
  const escape = await client.callTool({
    name: 'tano_read_document',
    arguments: { path: '../outside.md' },
  });
  assert.equal(escape.isError, true);
  await Promise.all(
    connections.slice(1).map(async ({ client }, index) => {
      const path = `Concurrent-${index}.md`;
      const content = `# Concurrent client ${index}\n`;
      const created = await client.callTool({
        name: 'tano_create_document',
        arguments: { path, content },
      });
      assert.notEqual(created.isError, true);
      assert.equal(await readFile(join(root, path), 'utf8'), content);
    }),
  );
  const db = new DatabaseSync(join(data, 'agents', `${workspaceId}.sqlite`));
  try {
    const records = db.prepare('SELECT instance_id, status FROM agent_changes').all();
    assert.equal(records.length, 5);
    assert(records.every((record) => record.status === 'applied'));
    const identities = [...new Set(records.map((record) => record.instance_id))];
    assert.equal(identities.length, 1);
    assert.equal(
      identities[0],
      (await readFile(join(data, 'agents', `${workspaceId}.instance`), 'utf8')).trim(),
    );
  } finally {
    db.close();
  }
  const markdown = '---\nowner: Alice\n状态: Review\ncount: 0\nenabled: false\ntags: [paper, review]\n---\n# Shared\n';
  await writeFile(join(root, 'Shared.md'), markdown);
  const sha256 = createHash('sha256').update(markdown).digest('hex');
  await writeFile(join(root, '.tano/identities.json'), JSON.stringify({
    format: 1, workspaceId, revision: 1, reservedIds: ['abc123'],
    files: [{ id: 'abc123', path: 'Shared.md', hash: sha256, version: 1, deleted: false }],
  }));
  const query = await client.callTool({ name: 'tano_query_files', arguments: { database: {
    directory: '', recursive: true, filters: [{ field: 'property:owner', operator: 'equals', value: 'Alice' }],
    sort: { field: 'path', direction: 'asc' }, groupBy: '',
  } } });
  assert.notEqual(query.isError, true);
  const files = JSON.parse(query.content[0].text);
  assert.equal(files.complete, true);
  assert.equal(files.total, 1);
  assert.equal(files.items[0].sha256, sha256);
  assert.equal(files.items[0].metadataHash, null);
  assert.deepEqual(files.items[0].metadata.properties, { owner: 'Alice', '状态': 'Review', status: 'Review', count: 0, enabled: false });
  assert.deepEqual(files.items[0].metadata.tags, ['paper', 'review']);
  console.log(
    'PASS standalone MCP: 4 concurrent clients, shared durable identity, stdio handshake, tools, create/read/conditional write, stale-write and path rejection, Markdown frontmatter filtering',
  );
  console.log(`Bundle: ${bundle}`);
} catch (error) {
  console.error(errors);
  throw error;
} finally {
  await Promise.all(connections.map(({ client }) => client.close()));
  if ((await realpath(directory)) !== verified)
    throw new Error('Temporary directory changed; refusing cleanup');
  await rm(directory, { recursive: true, force: true });
}
