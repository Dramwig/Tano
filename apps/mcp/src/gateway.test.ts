import { afterEach, beforeEach, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentGatewayClient, defaultObjectViewQuery, defaultFileDatabaseQuery } from '@tano/protocol';
import { AgentWorkspace, hash } from './workspace';
import { createAgentServer } from './server';

let directory: string, root: string, store: AgentWorkspace;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tano-gateway-')); root = join(directory, 'workspace');
  cpSync('examples/workspaces/ai-research', root, { recursive: true });
  store = new AgentWorkspace(root, join(directory, 'data'));
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
it('uses the shared MCP SDK for file, object, relation and formula-aware table queries', async () => {
  const server = createAgentServer(store), client = new Client({ name: 'gateway-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const sdk = AgentGatewayClient.fromMcp(client);
    expect(await sdk.capabilities()).toMatchObject({ version: 1, policy: { access: 'review' } });
    expect(await sdk.files('.csv')).toMatchObject({ total: 1, items: [{ fileId: '444444', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(await sdk.read('222222')).toMatchObject({ encoding: 'base64', path: 'papers/methods.pdf' });
    expect(await sdk.files('', 0, 100, { ...defaultFileDatabaseQuery(), filters: [{ field: 'property:owner', operator: 'equals', value: '研究组' }] })).toMatchObject({ total: 1, items: [{ fileId: '222222', metadataHash: expect.any(String) }] });
    expect(await sdk.objects()).toMatchObject({ total: 3 });
    expect(await sdk.table('777777', undefined, 0, 2)).toMatchObject({ total: 3, nextOffset: 2, items: [{ computed: expect.any(Object) }, { computed: expect.any(Object) }] });
    expect(await sdk.relations()).toMatchObject({ relations: expect.arrayContaining([expect.objectContaining({ type: 'contains' })]) });
  } finally { await client.close(); await server.close(); }
});
it('refuses hidden configuration and duplicate identities instead of inventing resource identity', () => {
  const path = join(root, '.tano/identities.json'), manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.files.push({ path: '.tano/config.json', id: 'f10001', deleted: false }); writeFileSync(path, JSON.stringify(manifest));
  expect(() => store.readFile('f10001')).toThrow();
  manifest.files.push({ path: 'other.md', id: '111111', deleted: false }); writeFileSync(path, JSON.stringify(manifest));
  expect(() => store.readFile('111111')).toThrow('重复');
});
it('queries Markdown frontmatter through MCP with the same typed properties as the workbench', async () => {
  const snapshot = store.readFile('111111');
  writeFileSync(join(root, snapshot.path), '---\nowner: Alice\n状态: Review\nenabled: false\ncount: 0\nempty: null\ntags: [paper, review, paper]\n---\n# Overview\n');
  // Legacy sidecars must not shadow Markdown source properties.
  writeFileSync(join(root, '.tano/files/111111.tano.json'), JSON.stringify({ version: 1, fileId: '111111', properties: { owner: 'Bob' }, tags: ['stale'] }));
  const server = createAgentServer(store), client = new Client({ name: 'frontmatter-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const sdk = AgentGatewayClient.fromMcp(client);
    const result = await sdk.files('', 0, 100, { ...defaultFileDatabaseQuery(), filters: [{ field: 'property:owner', operator: 'equals', value: 'Alice' }] });
    expect(result).toMatchObject({ complete: true, total: 1, items: [{ fileId: '111111', metadataHash: null,
      metadata: { properties: { owner: 'Alice', status: 'Review', enabled: false, count: 0, empty: null }, tags: ['paper', 'review'] } }] });
    expect(result.items[0]!.sha256).toBe(hash(readFileSync(join(root, snapshot.path))));
  } finally { await client.close(); await server.close(); }
});
it('reports unreadable Markdown metadata as an incomplete query', () => {
  const snapshot = store.readFile('111111');
  writeFileSync(join(root, snapshot.path), Buffer.from([0xff, 0xfe]));
  expect(store.queryFiles('', 0, 100, { ...defaultFileDatabaseQuery(), filters: [{ field: 'property:owner', operator: 'equals', value: 'Alice' }] }))
    .toMatchObject({ complete: false, total: 0, errors: [{ path: snapshot.path, error: expect.any(String) }] });
});
it('bounds Markdown metadata reads and reports oversized sources as incomplete', () => {
  const snapshot = store.readFile('111111');
  writeFileSync(join(root, snapshot.path), Buffer.alloc(8 * 1024 ** 2 + 1, 'a'));
  expect(store.queryFiles()).toMatchObject({ complete: false, errors: [{ path: snapshot.path, error: expect.stringContaining('8 MiB') }] });
});
it('queues a cross-resource batch atomically, keeps source bytes and returns per-item outcomes', () => {
  const snapshots = ['111111', 'e30001', '777777'].map(id => store.readFile(id));
  const operationId = randomUUID();
  const batch = { operationId, edits: snapshots.map((snapshot, index) => ({ fileId: snapshot.fileId, path: snapshot.path, expectedHash: snapshot.sha256, reason: '跨文件更新',
    content: index ? JSON.stringify({ ...JSON.parse(snapshot.content), name: 'Revised name' }) : snapshot.content + '\nNew note\n' })) };
  const receipt = store.proposeChanges(batch, 'client');
  expect(receipt).toMatchObject({ atomic: false, written: false }); expect(receipt.items).toHaveLength(3);
  for (const snapshot of snapshots) expect(readFileSync(join(root, snapshot.path), 'utf8')).toBe(snapshot.content);
  expect(store.proposeChanges(batch, 'client').items.map(item => item.proposalId)).toEqual(receipt.items.map(item => item.proposalId));
  expect(() => store.proposeChanges({ ...batch, edits: [{ ...batch.edits[0], content: 'different' }] }, 'client')).toThrow('同一操作');
  const db = new DatabaseSync(join(directory, 'data/agents', `${store.id}.sqlite`));
  try {
    db.prepare("UPDATE agent_proposals SET status='applied' WHERE id=?").run(receipt.items[0].proposalId);
    expect(store.operation(operationId).items[0]).toMatchObject({ status: 'unknown', written: false });
    const row = db.prepare('SELECT body FROM agent_proposals WHERE id=?').get(receipt.items[0].proposalId) as { body: string };
    const body = JSON.parse(row.body), proposal = body.messages[0].proposals[0]; proposal.status = 'applied';
    proposal.applied = { before: proposal.base, after: proposal.content, hash: hash(proposal.content), fileId: snapshots[0].fileId };
    db.prepare('UPDATE agent_proposals SET body=? WHERE id=?').run(JSON.stringify(body), receipt.items[0].proposalId);
  } finally { db.close(); }
  const partial = store.operation(operationId); expect(partial.written).toBe(false); expect(partial.items[0].written).toBe(true); expect(partial.items[1].written).toBe(false);
  expect(store.activity().items).toHaveLength(1);
});
it('refuses stale batches without queuing their other edits and requires explicit direct-write grants', () => {
  const a = store.readFile('111111'), b = store.readFile('e30001');
  writeFileSync(join(root, b.path), b.content + ' ');
  expect(() => store.proposeChanges({ operationId: randomUUID(), edits: [a, b].map(snapshot => ({ fileId: snapshot.fileId, path: snapshot.path, expectedHash: snapshot.sha256, content: snapshot.content, reason: 'test' })) }, 'client')).toThrow('revision');
  expect(store.activity().items).toHaveLength(0);
  expect(() => store.change(a.path, 'overwrite', a.sha256, 'client')).toThrow('直接写入');
});
it('enforces host scopes on legacy and new interfaces and follows catalog moves by stable ID', () => {
  store.close(); store = new AgentWorkspace(root, join(directory, 'data'), { access: 'read', directories: ['papers'], objectTypes: ['task'] });
  expect(store.queryFiles().items.every(file => file.path.startsWith('papers/'))).toBe(true);
  expect(() => store.readFile('444444')).toThrow('授权');
  expect(() => store.read('README.md')).toThrow('授权');
  expect(() => store.readFile('e30001')).toThrow('授权');
  expect(store.queryObjects({ ...defaultObjectViewQuery(), types: [] }).items.map(record => record.object.type)).toEqual(['task']);
  expect(() => store.propose(randomUUID(), 'papers/new.md', 'x', null, 'test', 'client')).toThrow('读取权限');
  expect(() => store.proposeChanges({ operationId: randomUUID(), edits: [] }, 'client')).toThrow('读取权限');
  const before = store.readFile('111111'); renameSync(join(root, before.path), join(root, 'papers/moved.md'));
  const manifestPath = join(root, '.tano/identities.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files.find((file: { id: string }) => file.id === '111111').path = 'papers/moved.md'; writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(store.readFile('111111')).toMatchObject({ fileId: '111111', path: 'papers/moved.md', sha256: before.sha256 });
});
