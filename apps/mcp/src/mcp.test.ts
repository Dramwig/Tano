import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  renameSync,
  chmodSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentWorkspace, hash } from './workspace';
import { createAgentServer } from './server';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

let directory: string, root: string, data: string, id: string;
const handles: AgentWorkspace[] = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tano-agent-'));
  root = join(directory, 'workspace');
  data = join(directory, 'cache');
  id = randomUUID();
  mkdirSync(join(root, '.tano'), { recursive: true });
  writeFileSync(join(root, '.tano/config.json'), JSON.stringify({ id, format: 1 }));
  writeFileSync(join(root, 'note.md'), '# Note\n\nOriginal\n');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockReset();
  for (const handle of handles.splice(0)) handle.close();
  rmSync(directory, { recursive: true, force: true });
});
function open() {
  const store = new AgentWorkspace(root, data, { access: 'write', directories: [''], objectTypes: ['task', 'project', 'experiment', 'person', 'event'] });
  handles.push(store);
  return store;
}
function database() {
  return new DatabaseSync(join(data, 'agents', `${id}.sqlite`));
}

it('rejects unsupported formats on open and after a connected workspace changes format', () => {
  const store = open();
  const before = store.read('note.md');
  for (const format of [2, 0, -1, 1.5, '1', null]) {
    const config = JSON.stringify({ id, format });
    writeFileSync(join(root, '.tano/config.json'), config);
    expect(() => open()).toThrow('数据格式');
    expect(() => store.change('note.md', 'overwrite', before.sha256, 'self-reported')).toThrow('数据格式');
    expect(readFileSync(join(root, '.tano/config.json'), 'utf8')).toBe(config);
    expect(readFileSync(join(root, 'note.md'), 'utf8')).toBe(before.content);
  }
  writeFileSync(join(root, '.tano/config.json'), JSON.stringify({ id }));
  expect(open().id).toBe(id);
});

it('queues immutable proposals with stable document identity without writing Markdown', () => {
  const store = open();
  const snapshot = store.read('note.md');
  writeFileSync(join(root, '.tano/identities.json'), JSON.stringify({ format: 1, workspaceId: id,
    files: [{ path: 'note.md', id: 'a00001', deleted: false }] }));
  expect(store.readIdentity('note.md').fileId).toBe('a00001');
  const operationId = randomUUID();
  const response = store.propose(operationId, 'note.md', '# Revised\n', snapshot.sha256, '整理', 'self-reported');
  expect(response).toMatchObject({ written: false, status: 'awaiting_review' });
  expect(readFileSync(join(root, 'note.md'), 'utf8')).toBe(snapshot.content);
  expect(store.propose(operationId, 'note.md', '# Revised\n', snapshot.sha256, '整理', 'self-reported').proposalId).toBe(operationId);
  expect(() => store.propose(operationId, 'note.md', 'different', snapshot.sha256, '整理', 'self-reported')).toThrow('同一操作');
  const db = database();
  try {
    const row = db.prepare('SELECT body FROM agent_proposals WHERE id=?').get(operationId) as { body: string };
    const saved = JSON.parse(row.body);
    expect(saved.messages[0].proposals[0]).toMatchObject({ fileId: 'a00001', base: snapshot.content, status: 'ready' });
    db.prepare("UPDATE agent_proposals SET status='applied' WHERE id=?").run(operationId);
    expect(store.proposalStatus(operationId)).toMatchObject({ written: true, status: 'applied' });
  } finally { db.close(); }
  const newId = randomUUID();
  expect(store.propose(newId, 'new.md', '# New\n', null, '新增', 'client').written).toBe(false);
  expect(existsSync(join(root, 'new.md'))).toBe(false);
  expect(() => store.propose(randomUUID(), '../outside.md', 'x', null, '新增', 'client')).toThrow();
});
it('reads portable rules without exposing arbitrary hidden files', () => {
  const store = open();
  mkdirSync(join(root, '.tano/rules'));
  writeFileSync(join(root, '.tano/rules/assistant.md'), '保留术语');
  expect(store.rules().rules).toEqual([{ path: '.tano/rules/assistant.md', content: '保留术语' }]);
  expect(() => store.read('.tano/rules/assistant.md')).toThrow();
  writeFileSync(join(root, '.tano/rules/assistant.md'), 'x'.repeat(32_001));
  expect(() => store.rules()).toThrow('32 KB');
});

it('requires .tano identity even when another hidden directory contains the old identity', () => {
  const store = open();
  const original = readFileSync(join(root, '.tano/config.json'), 'utf8');
  renameSync(join(root, '.tano'), join(root, '.workspace'));
  expect(() => open()).toThrow('请先用 Tano 打开');
  expect(() => store.read('note.md')).toThrow('请先用 Tano 打开');
  expect(readFileSync(join(root, '.workspace/config.json'), 'utf8')).toBe(original);
  expect(existsSync(join(root, '.tano'))).toBe(false);
});

it('uses only .tano identity and leaves other hidden configuration untouched', () => {
  mkdirSync(join(root, '.workspace'));
  const oldConfig = JSON.stringify({ id: randomUUID(), format: 1 });
  writeFileSync(join(root, '.workspace/config.json'), oldConfig);
  const newConfig = readFileSync(join(root, '.tano/config.json'), 'utf8');
  expect(open().id).toBe(id);
  expect(readFileSync(join(root, '.workspace/config.json'), 'utf8')).toBe(oldConfig);
  expect(readFileSync(join(root, '.tano/config.json'), 'utf8')).toBe(newConfig);
  writeFileSync(join(root, '.workspace/config.json'), 'invalid JSON');
  expect(open().id).toBe(id);
});

it('runs the MCP handshake, tool discovery and conditional writes with client-channel attribution', async () => {
  const store = open(),
    server = createAgentServer(store);
  const client = new Client({ name: 'declared-test-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'tano_gateway_capabilities', 'tano_query_files', 'tano_read_file', 'tano_query_objects', 'tano_query_table', 'tano_query_relations', 'tano_propose_changes', 'tano_get_operation', 'tano_list_activity', 'tano_read_activity',
      'tano_list_documents',
      'tano_read_document',
      'tano_write_document',
      'tano_create_document',
      'tano_read_document_identity',
      'tano_propose_document',
      'tano_get_proposal',
      'tano_read_workspace_rules',
    ]);
    const read = await client.callTool({
      name: 'tano_read_document',
      arguments: { path: 'note.md' },
    });
    const snapshot = JSON.parse((read.content as { text: string }[])[0].text);
    const changed = await client.callTool({
      name: 'tano_write_document',
      arguments: { path: 'note.md', expectedHash: snapshot.sha256, content: '# Note\n\nAgent\n' },
    });
    expect(changed.isError).not.toBe(true);
    expect(readFileSync(join(root, 'note.md'), 'utf8')).toContain('Agent');
    const stale = await client.callTool({
      name: 'tano_write_document',
      arguments: { path: 'note.md', expectedHash: snapshot.sha256, content: 'stale replacement' },
    });
    expect(stale.isError).toBe(true);
    const db = database();
    const event = db.prepare('SELECT * FROM agent_changes').get()!;
    expect(event.client).toBe('declared-test-client (1)');
    expect(event.instance_id).toBe(store.instanceId);
    expect(event.instance_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(event.status).toBe('applied');
    expect(event.before_hash).toBe(snapshot.sha256);
    expect(event.after_hash).toBe(hash(readFileSync(join(root, 'note.md'))));
    db.close();
    expect(readdirSync(root).sort()).toEqual(['.tano', 'note.md']);
    const second = open();
    expect(second.instanceId).toBe(store.instanceId);
  } finally {
    await client.close();
    await server.close();
  }
});

it('shares one complete instance identity when another client starts during its first write', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  let concurrent: AgentWorkspace | undefined;
  vi.mocked(writeFileSync).mockImplementationOnce((...args) => {
    // Interleave the second constructor after exclusive create but before the
    // first UUID bytes are written. It must never observe an empty identity.
    concurrent = open();
    actual.writeFileSync(...args);
  });
  const first = open();
  expect(first.instanceId).toBe(concurrent!.instanceId);
  expect(readFileSync(join(data, 'agents', `${id}.instance`), 'utf8').trim()).toBe(
    first.instanceId,
  );
  expect(open().instanceId).toBe(first.instanceId);
});

it('can initialize after an interrupted identity write without repairing application data', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(writeFileSync).mockImplementationOnce((file) => {
    actual.writeFileSync(file, 'partial');
    throw new Error('instance write interrupted');
  });
  expect(open).toThrow('instance write interrupted');
  expect(existsSync(join(data, 'agents', `${id}.instance`))).toBe(false);
  const store = open();
  expect(store.instanceId).toBe(open().instanceId);
  expect(readdirSync(join(data, 'agents')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

it('releases a busy initialization connection and retries without hiding permanent database errors', () => {
  const close = vi.spyOn(DatabaseSync.prototype, 'close');
  const exec = vi.spyOn(DatabaseSync.prototype, 'exec');
  exec.mockImplementationOnce(() => {
    throw Object.assign(new Error('database is locked'), { errcode: 5 });
  });
  const store = open();
  expect(close).toHaveBeenCalledTimes(1);
  store.change('startup.md', '# Recovered initialization', null, 'retry-client');
  expect(store.read('startup.md').content).toBe('# Recovered initialization');
  const before = exec.mock.calls.length;
  exec.mockImplementationOnce(() => {
    throw Object.assign(new Error('file is not a database'), { errcode: 26 });
  });
  expect(open).toThrow('file is not a database');
  expect(exec.mock.calls.length).toBe(before + 1);
  expect(close).toHaveBeenCalledTimes(2);
  expect(open().instanceId).toBe(store.instanceId);
});

it('never replaces external changes or an existing file during create', () => {
  const a = open(),
    b = open();
  const first = a.read('note.md');
  b.change('note.md', 'newer content', first.sha256, 'B');
  expect(() => a.change('note.md', 'old content', first.sha256, 'A')).toThrow('内容已变化');
  expect(() => a.change('note.md', 'replacement', null, 'A')).toThrow('文件已存在');
  a.change('new.md', 'new document', null, 'A');
  expect(readFileSync(join(root, 'note.md'), 'utf8')).toBe('newer content');
  expect(readFileSync(join(root, 'new.md'), 'utf8')).toBe('new document');
});

it('migrates an older activity database and adds a stable instance id', () => {
  mkdirSync(join(data, 'agents'), { recursive: true });
  const legacy = new DatabaseSync(join(data, 'agents', `${id}.sqlite`));
  legacy.exec(
    `CREATE TABLE agent_changes (
      id TEXT PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL, client TEXT NOT NULL,
      operation TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
      before_hash TEXT, after_hash TEXT NOT NULL, before_content TEXT, after_content TEXT,
      error TEXT NOT NULL DEFAULT ''
    )`,
  );
  legacy.close();
  const store = open();
  const original = store.read('note.md');
  store.change('note.md', 'migrated', original.sha256, 'legacy-client');
  const db = database();
  expect(db.prepare('SELECT instance_id FROM agent_changes').get()).toMatchObject({
    instance_id: store.instanceId,
  });
  db.close();
  expect(store.instanceId).toBe(open().instanceId);
});

it('preserves BOM bytes and rejects malformed UTF-8, traversal, hidden paths and symlink escapes', () => {
  const store = open();
  writeFileSync(join(root, 'bom.md'), '\ufeff中文\r\n');
  const bom = store.read('bom.md');
  expect(bom.content).toBe('\ufeff中文\r\n');
  store.change('bom.md', '\ufeff更新\r\n', bom.sha256, 'client');
  expect(readFileSync(join(root, 'bom.md'), 'utf8')).toBe('\ufeff更新\r\n');
  writeFileSync(join(root, 'invalid.md'), Buffer.from([0xff, 0xfe]));
  expect(() => store.read('invalid.md')).toThrow();
  expect(() => store.change('bad.md', '\ud800', null, 'client')).toThrow('Unicode');
  for (const path of [
    '../outside.md',
    '.tano/config.json',
    'file.txt',
    'C:/escape.md',
    'x\\y.md',
  ])
    expect(() => store.read(path)).toThrow();
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 'outside');
  symlinkSync(outside, join(root, 'escape'), 'junction');
  expect(() => store.read('escape/secret.md')).toThrow('符号链接');
  expect(() => store.change('escape/new.md', 'no', null, 'client')).toThrow('符号链接');
  expect(store.list().some((file) => file.path.startsWith('escape'))).toBe(false);
  expect(() => new AgentWorkspace(root, root)).toThrow('工作区之外');
});

it('refuses writing if the audit preparation fails and preserves uncertain evidence if acknowledgement fails', () => {
  const store = open(),
    original = store.read('note.md'),
    db = database();
  db.exec(
    "CREATE TRIGGER deny_prepare BEFORE INSERT ON agent_changes BEGIN SELECT RAISE(ABORT,'disk failure'); END",
  );
  expect(() => store.change('note.md', 'unsaved', original.sha256, 'client')).toThrow(
    'disk failure',
  );
  expect(store.read('note.md').sha256).toBe(original.sha256);
  db.exec(
    "DROP TRIGGER deny_prepare; CREATE TRIGGER deny_ack BEFORE UPDATE OF status ON agent_changes WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'ack failure'); END",
  );
  expect(() => store.change('note.md', 'published', original.sha256, 'client')).toThrow(
    '可能已写入',
  );
  expect(store.read('note.md').content).toBe('published');
  expect(
    db.prepare('SELECT status,before_content,after_content FROM agent_changes').get(),
  ).toMatchObject({
    status: 'prepared',
    before_content: original.content,
    after_content: 'published',
  });
  db.close();
});

it('retains complete diff bodies and exact hashes for auditable writes', () => {
  const store = open(),
    large = 'a'.repeat(600 * 1024);
  store.change('large.md', large, null, 'client');
  const db = database();
  expect(db.prepare('SELECT after_content,after_hash FROM agent_changes').get()).toMatchObject({
    after_content: large,
    after_hash: hash(large),
  });
  expect(store.read('large.md').content).toBe(large);
  db.close();
});

it('rejects replaced workspace directories and changed workspace identities before reading or writing', () => {
  const store = open(),
    original = store.read('note.md');
  writeFileSync(join(root, '.tano/config.json'), JSON.stringify({ id: randomUUID() }));
  expect(() => store.read('note.md')).toThrow('标识已变化');
  expect(() => store.change('note.md', 'wrong workspace', original.sha256, 'client')).toThrow(
    '标识已变化',
  );
  writeFileSync(join(root, '.tano/config.json'), JSON.stringify({ id }));
  renameSync(root, join(directory, 'old-workspace'));
  mkdirSync(join(root, '.tano'), { recursive: true });
  writeFileSync(join(root, '.tano/config.json'), JSON.stringify({ id }));
  writeFileSync(join(root, 'note.md'), original.content);
  expect(() => store.list()).toThrow('路径已变化');
  expect(() => store.read('note.md')).toThrow('路径已变化');
  expect(() => store.change('note.md', 'wrong directory', original.sha256, 'client')).toThrow(
    '路径已变化',
  );
  expect(readFileSync(join(root, 'note.md'), 'utf8')).toBe(original.content);
});

it.skipIf(process.platform === 'win32')(
  'preserves existing POSIX access mode on replacement',
  () => {
    const store = open(),
      original = store.read('note.md');
    chmodSync(join(root, 'note.md'), 0o640);
    store.change('note.md', 'updated', original.sha256, 'client');
    expect(statSync(join(root, 'note.md')).mode & 0o777).toBe(0o640);
  },
);
