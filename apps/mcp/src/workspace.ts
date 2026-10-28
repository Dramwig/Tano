import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMarkdown, validatePath, validateStoragePath, parseAssistantSession, fileHandlers, parseObject, parseRelations, parseDataTable, isDataTableFilePath, validateObjectProperties, defaultObjectViewQuery, viewEngine, dataEvaluator, dataViewRows, AGENT_GATEWAY_VERSION, parseFileMetadata, emptyFileMetadata, queryFileDatabase, defaultFileDatabaseQuery } from '@tano/protocol';
import { markdownFileMetadata } from '@tano/protocol/markdown-file-metadata';
import type { AgentGatewayPolicy, GatewayBatch, ObjectViewQuery, AssistantProposal, FileDatabaseQuery } from '@tano/protocol';

const maxBytes = 8 * 1024 ** 2;
const previewBytes = 512 * 1024;
export const hash = (content: string | Uint8Array) =>
  createHash('sha256').update(content).digest('hex');
const text = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function loadInstanceId(directory: string, workspaceId: string) {
  const path = join(directory, `${workspaceId}.instance`);
  const read = () => {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Agent 实例标识不能是符号链接');
    const value = readFileSync(path, 'utf8').trim();
    if (!uuid.test(value)) throw new Error('Agent 实例标识无效，请删除后重新连接');
    return value;
  };
  if (existsSync(path)) return read();
  const value = randomUUID();
  const temporary = join(directory, `${workspaceId}.${randomUUID()}.instance.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, `${value}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Publish only complete, durable bytes. Exclusive creation of the final
    // path itself would expose an empty/partial UUID to concurrent MCP clients.
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return read();
    }
    return value;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // An orphaned temporary is never treated as the published identity.
    }
  }
}
function openActivityDatabase(path: string) {
  const deadline = performance.now() + 5000;
  const waiting = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      // WAL activation can return SQLITE_BUSY immediately when another first
      // connection is changing the journal, even with a busy timeout installed.
      db.exec(`PRAGMA busy_timeout=250; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS agent_changes (
          id TEXT PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL, client TEXT NOT NULL,
          instance_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
          before_hash TEXT, after_hash TEXT NOT NULL, before_content TEXT, after_content TEXT,
          error TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS agent_proposals (
          id TEXT PRIMARY KEY, root TEXT NOT NULL, root_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
          body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready'
        );`);
      const columns = db.prepare("PRAGMA table_info('agent_changes')").all() as { name: string }[];
      if (!columns.some((column) => column.name === 'instance_id')) {
        try {
          db.exec("ALTER TABLE agent_changes ADD COLUMN instance_id TEXT NOT NULL DEFAULT ''");
        } catch (error) {
          if (!String(error).toLowerCase().includes('duplicate column name')) throw error;
        }
      }
      db.exec('PRAGMA busy_timeout=5000');
      return db;
    } catch (error) {
      db?.close();
      const code = (error as { errcode?: number }).errcode;
      if (code === undefined || (code & 0xff) !== 5 || performance.now() >= deadline) throw error;
      // Retry with a fresh connection so a failed initialization cannot retain
      // a lock. This is bounded startup work in the standalone MCP process.
      Atomics.wait(waiting, 0, 0, Math.min(25, Math.max(0, deadline - performance.now())));
    }
  }
}
function workspaceIdentity(root: string) {
  const folder = join(root, '.tano');
  const stat = lstatSync(folder, { throwIfNoEntry: false });
  if (!stat) throw new Error('请先用 Tano 打开此工作文件夹');
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('工作区配置不能是符号链接或非目录');
  const file = join(folder, 'config.json');
  const metadata = lstatSync(file, { throwIfNoEntry: false });
  if (!metadata) throw new Error('请先用 Tano 打开此工作文件夹');
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new Error('工作区配置不能是符号链接或非文件');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config && Object.hasOwn(config, 'format') && config.format !== 1)
    throw new Error('此工作区的数据格式不受当前版本支持，请升级 Tano 或 Tano Local；已停止打开和写入，原文件已保留');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.id))
    throw new Error('请先用 Tano 打开此工作文件夹');
  return config.id as string;
}

export class AgentWorkspace {
  readonly root: string;
  readonly id: string;
  readonly instanceId: string;
  private db: DatabaseSync;
  private rootIdentity: { dev: bigint; ino: bigint };
  readonly policy: AgentGatewayPolicy;
  constructor(root: string, dataDirectory: string, policy: AgentGatewayPolicy = { access: 'review', directories: [''], objectTypes: ['task', 'project', 'experiment', 'person', 'event'] }) {
    if (!['read', 'review', 'write'].includes(policy.access) || !Array.isArray(policy.directories) || policy.directories.some(path => path !== '' && !!validatePath(`${path}/scope.md`)) || !Array.isArray(policy.objectTypes) || policy.objectTypes.some(type => !/^[a-z][a-z0-9.-]{0,79}$/.test(type))) throw new Error('Agent 授权范围无效');
    this.policy = Object.freeze({ ...policy, directories: Object.freeze([...policy.directories]) as unknown as string[], objectTypes: Object.freeze([...policy.objectTypes]) as unknown as string[] });
    if (lstatSync(root).isSymbolicLink()) throw new Error('工作区不能是符号链接');
    this.root = realpathSync(root);
    this.rootIdentity = lstatSync(this.root, { bigint: true });
    if (!lstatSync(this.root).isDirectory()) throw new Error('请选择工作文件夹');
    this.id = workspaceIdentity(this.root);
    const directory = resolve(dataDirectory, 'agents');
    // Agent records and SQLite must never appear among user notes.
    const prefix = this.root.toLowerCase() + '/';
    if (
      (directory.replaceAll('\\', '/').toLowerCase() + '/').startsWith(prefix.replaceAll('\\', '/'))
    )
      throw new Error('活动缓存必须位于工作区之外');
    mkdirSync(directory, { recursive: true });
    if (
      (realpathSync(directory).replaceAll('\\', '/').toLowerCase() + '/').startsWith(
        prefix.replaceAll('\\', '/'),
      )
    )
      throw new Error('活动缓存必须位于工作区之外');
    this.instanceId = loadInstanceId(directory, this.id);
    this.db = openActivityDatabase(join(directory, `${this.id}.sqlite`));
    this.db.exec('CREATE TABLE IF NOT EXISTS gateway_operations (id TEXT PRIMARY KEY, root TEXT NOT NULL, root_key TEXT NOT NULL, fingerprint TEXT NOT NULL, items TEXT NOT NULL, created_at INTEGER NOT NULL)');
  }
  close() {
    this.db.close();
  }
  private assertWorkspace() {
    const stat = lstatSync(this.root, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      realpathSync(this.root) !== this.root ||
      stat.dev !== this.rootIdentity.dev ||
      stat.ino !== this.rootIdentity.ino
    )
      throw new Error('工作区路径已变化，请重新连接');
    if (workspaceIdentity(this.root) !== this.id) throw new Error('工作区标识已变化，请重新连接');
  }
  private target(path: string, mustExist = true) {
    const invalid = validatePath(path);
    if (invalid) throw new Error(invalid);
    if (!isMarkdown(path)) throw new Error('MCP 只读写 Markdown 文档');
    this.authorizePath(path);
    return this.resourceTarget(path, mustExist);
  }
  private authorizePath(path: string) {
    if (!path.startsWith('.tano/') && !this.policy.directories.some(prefix => !prefix || path.startsWith(`${prefix}/`))) throw new Error('文件不在 Agent 授权范围');
  }
  private resourceTarget(path: string, mustExist = true) {
    const internal = /^\.tano\/objects\/.+\.tano\.json$/.test(path) || path === '.tano/relations.tano-relations.json' || /^\.tano\/files\/[a-f0-9]{6}\.tano\.json$/.test(path);
    const invalid = internal ? validateStoragePath(path) : validatePath(path);
    if (invalid) throw new Error(invalid);
    this.authorizePath(path);
    this.assertWorkspace();
    let current = this.root;
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error('不跟随符号链接');
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('父路径不是目录');
        if (i === parts.length - 1 && !stat.isFile()) throw new Error('路径不是文件');
      } catch (error) {
        if (
          !mustExist &&
          (i === parts.length - 1 || internal) &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return join(this.root, path);
        throw error;
      }
    }
    return current;
  }
  read(path: string) {
    const target = this.target(path);
    if (lstatSync(target).size > maxBytes) throw new Error('文档超过 8 MiB');
    const bytes = readFileSync(target);
    if (bytes.length > maxBytes) throw new Error('文档超过 8 MiB');
    return { path, content: text(bytes), sha256: hash(bytes) };
  }
  readIdentity(path: string) {
    const snapshot = this.read(path);
    const file = join(this.root, '.tano/identities.json');
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 ** 2) throw new Error('工作区身份清单无效');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(manifest.files) ? manifest.files.filter((entry: { path: string; deleted: boolean }) => entry.path === path && !entry.deleted) : [];
    if (manifest.format !== 1 || manifest.workspaceId !== this.id || entries.length !== 1 || !/^[a-f0-9]{6}$/.test(entries[0].id))
      throw new Error('文档尚未有稳定身份，请在 Tano 中刷新工作区后重新读取');
    return { ...snapshot, workspaceId: this.id, fileId: entries[0].id as string };
  }
  capabilities() {
    return { version: AGENT_GATEWAY_VERSION, workspaceId: this.id, policy: this.policy, review: 'Tano desktop', batchAtomic: false,
      resources: ['files', 'objects', 'tables', 'relations'], writes: 'Reviewed proposals; explicit write access additionally enables legacy Markdown CAS writes' };
  }
  private manifest() {
    this.assertWorkspace();
    const path = join(this.root, '.tano/identities.json');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 ** 2) throw new Error('身份清单无效');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value.format !== 1 || value.workspaceId !== this.id || !Array.isArray(value.files)) throw new Error('身份清单无效');
    const files = value.files.filter((file: { deleted?: boolean }) => !file.deleted) as { path: string; id: string }[];
    if (files.some(file => typeof file.path !== 'string' || !/^[a-f0-9]{6}$/.test(file.id)) || new Set(files.map(file => file.id)).size !== files.length || new Set(files.map(file => file.path)).size !== files.length) throw new Error('身份清单包含重复或无效身份');
    return files;
  }
  private page<T>(rows: T[], offset: number, limit: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('分页参数无效');
    return { items: rows.slice(offset, offset + limit), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  queryFiles(query = '', offset = 0, limit = 100, database: FileDatabaseQuery = defaultFileDatabaseQuery()) {
    if (typeof query !== 'string' || query.length > 200) throw new Error('文件查询无效');
    const errors: { path: string; error: string }[] = [];
    const rows = this.manifest().filter(file => !file.path.startsWith('.') && this.policy.directories.some(prefix => !prefix || file.path.startsWith(`${prefix}/`)) && file.path.toLowerCase().includes(query.toLowerCase())).flatMap(file => {
      try {
        const target = this.resourceTarget(file.path), stat = lstatSync(target);
        const markdown = isMarkdown(file.path);
        if (markdown && stat.size > maxBytes) throw new Error('Markdown 属性读取超过 8 MiB');
        const fd = openSync(target, 'r'); const digest = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024);
        const chunks: Buffer[] = []; let total = 0;
        try {
          let size;
          while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            digest.update(buffer.subarray(0, size));
            if (markdown) {
              total += size;
              if (total > maxBytes) throw new Error('Markdown 属性读取超过 8 MiB');
              chunks.push(Buffer.from(buffer.subarray(0, size)));
            }
          }
        } finally { closeSync(fd); }
        let metadataContent: string | null = null;
        let metadata;
        if (markdown) metadata = markdownFileMetadata(file.id, text(Buffer.concat(chunks)));
        else {
          const metadataPath = this.resourceTarget('.tano/files/' + file.id + '.tano.json', false);
          if (existsSync(metadataPath) && lstatSync(metadataPath).size > previewBytes) throw new Error('文件元数据超过大小限制');
          metadataContent = existsSync(metadataPath) ? text(readFileSync(metadataPath)) : null;
          metadata = metadataContent === null ? emptyFileMetadata(file.id) : parseFileMetadata(metadataContent, file.id);
        }
        return [{ workspaceId: this.id, fileId: file.id, path: file.path, sha256: digest.digest('hex'), size: stat.size, modified: stat.mtimeMs, handler: fileHandlers.resolve(file.path).id, metadata, metadataHash: metadataContent === null ? null : hash(metadataContent) }];
      } catch (error) { errors.push({ path: file.path, error: String(error) }); return []; }
    });
    const filtered = queryFileDatabase(rows.map(row => ({ file: { ...row, id: row.fileId, name: row.path.split('/').at(-1)!, kind: 'file' as const, mimeType: fileHandlers.resolve(row.path).mimeType, handlerId: row.handler }, metadata: row.metadata })), database);
    return { ...this.page(filtered.map(row => rows.find(item => item.fileId === row.file.id)!), offset, limit), complete: !errors.length, errors, identitySource: '.tano/identities.json' };
  }
  readFile(fileId: string) {
    if (!/^[a-f0-9]{6}$/.test(fileId)) throw new Error('File ID 无效');
    const file = this.manifest().find(file => file.id === fileId);
    if (!file) throw new Error('File ID 不存在，请刷新工作区');
    const target = this.resourceTarget(file.path);
    if (lstatSync(target).size > maxBytes) throw new Error('读取超过 8 MiB');
    const bytes = readFileSync(target); if (bytes.length > maxBytes) throw new Error('读取超过 8 MiB');
    const revision = { workspaceId: this.id, fileId, path: file.path, sha256: hash(bytes) };
    if (file.path.startsWith('.tano/objects/')) {
      const object = parseObject(text(bytes));
      if (!this.policy.objectTypes.includes(object.type)) throw new Error('对象类型未授权');
      return { ...revision, encoding: 'utf8' as const, content: text(bytes) };
    }
    if (file.path.startsWith('.tano/')) throw new Error('请使用授权关系查询');
    const handler = fileHandlers.resolve(file.path);
    const binary = ['binary', 'image', 'pdf', 'audio', 'video'].includes(handler.preview);
    return { ...revision, encoding: binary ? 'base64' as const : 'utf8' as const, content: binary ? bytes.toString('base64') : text(bytes) };
  }
  queryObjects(query: ObjectViewQuery = defaultObjectViewQuery(), offset = 0, limit = 100) {
    const records = this.manifest().filter(file => /^\.tano\/objects\/.+\.tano\.json$/.test(file.path)).flatMap(file => {
      const target = this.resourceTarget(file.path); if (lstatSync(target).size > maxBytes) throw new Error('对象超过 8 MiB');
      const content = text(readFileSync(target)), object = parseObject(content);
      return this.policy.objectTypes.includes(object.type) ? [{ workspaceId: this.id, fileId: file.id, path: file.path, sha256: hash(content), object }] : [];
    });
    const projection = viewEngine.query(records.map(record => record.object), query, this.queryRelations().relations);
    return this.page(projection.rows.map(object => records.find(record => record.object === object)!), offset, limit);
  }
  queryRelations() {
    const path = '.tano/relations.tano-relations.json';
    const target = this.resourceTarget(path, false);
    if (!existsSync(target)) return { workspaceId: this.id, sha256: null, relations: [] };
    if (lstatSync(target).size > maxBytes) throw new Error('关系超过 8 MiB');
    const content = text(readFileSync(target));
    const files = this.manifest();
    const allowed = (endpoint: { type: string; id: string }) => ['document', 'asset'].includes(endpoint.type)
      ? files.some(file => file.id === endpoint.id && !file.path.startsWith('.') && this.policy.directories.some(prefix => !prefix || file.path.startsWith(`${prefix}/`)))
      : this.policy.objectTypes.includes(endpoint.type);
    return { workspaceId: this.id, sha256: hash(content), relations: parseRelations(content).relations.filter(edge => allowed(edge.source) && allowed(edge.target)) };
  }
  queryTable(fileId: string, viewId?: string, offset = 0, limit = 100) {
    const snapshot = this.readFile(fileId);
    if (!isDataTableFilePath(snapshot.path) || snapshot.encoding !== 'utf8') throw new Error('目标不是数据表');
    const table = parseDataTable(snapshot.content), view = viewId ? table.views.find(view => view.id === viewId) : table.views[0];
    if (!view) throw new Error('数据表视图不存在');
    const evaluate = dataEvaluator(table), rows = dataViewRows(table, view, '', evaluate);
    const { content: _, ...revision } = snapshot;
    return { ...revision, tableId: table.id, name: table.name, fields: table.fields, view,
      ...this.page(rows.map(row => ({ ...row, computed: Object.fromEntries(table.fields.map(field => [field.id, evaluate(row, field.id)])) })), offset, limit) };
  }
  proposeChanges(batch: GatewayBatch, client: string) {
    this.assertWorkspace();
    if (this.policy.access === 'read') throw new Error('Agent 只有读取权限');
    if (!uuid.test(batch.operationId) || !Array.isArray(batch.edits) || !batch.edits.length || batch.edits.length > 20 || Buffer.byteLength(JSON.stringify(batch)) > 1_000_000) throw new Error('跨文件提案格式或大小无效');
    const fingerprint = hash(JSON.stringify(batch)), rootKey = `${this.rootIdentity.dev}:${this.rootIdentity.ino}`;
    const existing = this.db.prepare('SELECT fingerprint FROM gateway_operations WHERE id=? AND root=? AND root_key=?').get(batch.operationId, this.root, rootKey) as { fingerprint: string } | undefined;
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error('同一操作标识不能对应不同建议'); return this.operation(batch.operationId); }
    const paths = new Set<string>();
    const sessions = batch.edits.map(edit => {
      if (!edit || typeof edit.path !== 'string' || paths.has(edit.path.toLowerCase()) || typeof edit.content !== 'string' || text(Buffer.from(edit.content)) !== edit.content || Buffer.byteLength(edit.content) > previewBytes || typeof edit.reason !== 'string' || !edit.reason.trim() || edit.reason.length > 4000 || (edit.expectedHash !== null && !/^[a-f0-9]{64}$/.test(edit.expectedHash))) throw new Error('建议内容、路径或 revision 无效');
      paths.add(edit.path.toLowerCase()); this.resourceTarget(edit.path, edit.expectedHash !== null);
      const before = edit.expectedHash === null ? null : this.readFile(edit.fileId ?? '');
      if (before && (before.path !== edit.path || before.sha256 !== edit.expectedHash || before.encoding !== 'utf8')) throw new Error('身份或 revision 已变化，请重新读取');
      if (!before && (edit.fileId !== undefined || existsSync(join(this.root, edit.path)))) throw new Error('新建路径已存在或 File ID 无效');
      let kind: AssistantProposal['kind'] = before ? 'edit' : 'create';
      if (edit.path.startsWith('.tano/objects/')) {
        const object = parseObject(edit.content); validateObjectProperties(object.type, object.properties);
        if (!this.policy.objectTypes.includes(object.type) || (!before && edit.path !== `.tano/objects/${object.id}.tano.json`)) throw new Error('对象类型或路径未授权');
        if (before) { const base = parseObject(before.content); if (base.id !== object.id || base.type !== object.type) throw new Error('对象身份不能改变'); }
        kind = 'object';
      } else if (isDataTableFilePath(edit.path)) parseDataTable(edit.content, before ? parseDataTable(before.content).id : undefined);
      else if (!isMarkdown(edit.path)) throw new Error('此格式当前仅支持查询；可提交 Markdown、对象或数据表修改');
      const id = randomUUID(), now = Date.now();
      return parseAssistantSession({ version: 1, external: true, id, workspaceId: this.id, title: `[${batch.operationId.slice(0, 8)}] ${edit.reason.slice(0, 40)}`, revision: 0, createdAt: now, updatedAt: now,
        messages: [{ id, role: 'assistant', content: `跨文件操作 ${batch.operationId} · ${client.slice(0, 120)}（客户端自报名称）。逐项审阅，非原子事务。`, createdAt: now, state: 'completed',
          proposals: [{ id, runId: batch.operationId, workspaceId: this.id, kind, path: edit.path, ...(before ? { fileId: before.fileId } : {}), base: before?.content ?? '', content: edit.content, reason: edit.reason, status: 'ready' }] }] });
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const session of sessions) this.db.prepare('INSERT INTO agent_proposals(id,root,root_key,fingerprint,body) VALUES(?,?,?,?,?)').run(session.id, this.root, rootKey, fingerprint, JSON.stringify(session));
      this.db.prepare('INSERT INTO gateway_operations VALUES(?,?,?,?,?,?)').run(batch.operationId, this.root, rootKey, fingerprint, JSON.stringify(sessions.map(session => session.id)), Date.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.operation(batch.operationId);
  }
  operation(operationId: string) {
    this.assertWorkspace();
    const record = this.db.prepare('SELECT items FROM gateway_operations WHERE id=? AND root=? AND root_key=?').get(operationId, this.root, `${this.rootIdentity.dev}:${this.rootIdentity.ino}`) as { items: string } | undefined;
    if (!record) throw new Error('操作不存在于当前工作区');
    const ids: unknown = JSON.parse(record.items);
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) throw new Error('操作记录损坏，请保留记录并核对');
    const items = (ids as string[]).map(id => {
      const row = this.db.prepare('SELECT status,body FROM agent_proposals WHERE id=?').get(id) as { status: string; body: string };
      const session = parseAssistantSession(JSON.parse(row.body)), proposal = session.messages[0].proposals![0];
      this.authorizePath(proposal.path);
      if (proposal.kind === 'object' && !this.policy.objectTypes.includes(parseObject(proposal.content).type)) throw new Error('对象类型未授权');
      const verified = row.status === 'applied' && proposal.status === 'applied' && proposal.applied && hash(proposal.applied.after) === proposal.applied.hash;
      return { proposalId: id, status: row.status === 'ready' ? 'awaiting_review' : row.status === 'applied' && !verified ? 'unknown' : row.status, written: !!verified, proposal };
    });
    return { operationId, atomic: false as const, written: items.every(item => item.written), items };
  }
  activity(offset = 0, limit = 100) {
    this.assertWorkspace();
    const operations = this.db.prepare('SELECT id,created_at FROM gateway_operations WHERE root=? AND root_key=? ORDER BY created_at DESC').all(this.root, `${this.rootIdentity.dev}:${this.rootIdentity.ino}`);
    const writes = this.db.prepare('SELECT id,path,status,before_hash,after_hash,created_at,error FROM agent_changes WHERE root=? ORDER BY created_at DESC').all(this.root).filter(row => this.policy.directories.some(prefix => !prefix || String(row.path).startsWith(`${prefix}/`)));
    const page = this.page([...operations.map(row => ({ ...row, id: String(row.id), created_at: Number(row.created_at), kind: 'proposal_batch' })), ...writes.map(row => ({ ...row, id: String(row.id), created_at: Number(row.created_at), kind: 'direct_write' }))].sort((a, b) => b.created_at - a.created_at), offset, limit);
    return page;
  }
  activityDetail(id: string) {
    this.assertWorkspace();
    if (!uuid.test(id)) throw new Error('活动标识无效');
    const row = this.db.prepare('SELECT id,path,status,before_hash,after_hash,before_content,after_content,created_at,error FROM agent_changes WHERE id=? AND root=?').get(id, this.root);
    if (!row) throw new Error('活动不存在于当前工作区');
    this.authorizePath(String(row.path));
    return row;
  }
  rules() {
    this.assertWorkspace();
    const rules: { path: string; content: string }[] = [];
    for (const path of ['AGENTS.md', '.tano/rules/assistant.md']) {
      let current = this.root;
      let missing = false;
      const parts = path.split('/');
      for (let index = 0; index < parts.length; index++) {
        current = join(current, parts[index]);
        const metadata = lstatSync(current, { throwIfNoEntry: false });
        if (!metadata) { missing = true; break; }
        if (metadata.isSymbolicLink() || (index < parts.length - 1 ? !metadata.isDirectory() : !metadata.isFile())) throw new Error('工作区规则必须是普通工作区文件');
        if (index === parts.length - 1 && metadata.size > 32_000) throw new Error('工作区规则超过 32 KB');
      }
      if (missing) continue;
      const bytes = readFileSync(current);
      if (bytes.length > 32_000) throw new Error('工作区规则超过 32 KB');
      rules.push({ path, content: text(bytes) });
    }
    return { workspaceId: this.id, rules };
  }
  propose(operationId: string, path: string, content: string, expectedHash: string | null, reason: string, client: string) {
    if (this.policy.access === 'read') throw new Error('Agent 只有读取权限');
    this.assertWorkspace();
    if (!uuid.test(operationId) || !reason.trim() || reason.length > 4000 || Buffer.byteLength(content) > previewBytes || text(Buffer.from(content)) !== content)
      throw new Error('建议身份、正文或理由无效');
    const fingerprint = hash(JSON.stringify([path, content, expectedHash, reason]));
    const rootKey = `${this.rootIdentity.dev}:${this.rootIdentity.ino}`;
    const existing = this.db.prepare('SELECT root,root_key,fingerprint,body,status FROM agent_proposals WHERE id=?').get(operationId) as
      { root: string; root_key: string; fingerprint: string; body: string; status: string } | undefined;
    if (existing) {
      if (existing.root !== this.root || existing.root_key !== rootKey || existing.fingerprint !== fingerprint) throw new Error('同一操作标识不能对应不同建议');
      return { proposalId: operationId, status: existing.status, written: existing.status === 'applied' };
    }
    this.target(path, expectedHash !== null);
    const before = expectedHash === null ? null : this.readIdentity(path);
    if (before && before.sha256 !== expectedHash) throw new Error('内容已变化，请重新读取并审阅');
    if (before && Buffer.byteLength(before.content) > previewBytes) throw new Error('建议基线超过 512 KB');
    if (!before && existsSync(join(this.root, path))) throw new Error('新建建议的同名文件已存在');
    const now = Date.now();
    const session = parseAssistantSession({ version: 1, external: true, id: operationId, workspaceId: this.id, title: reason.slice(0, 50), revision: 0,
      createdAt: now, updatedAt: now, messages: [{ id: operationId, role: 'assistant', content: `外部 Agent 建议：${client.slice(0, 120)}（客户端自报名称）`,
        createdAt: now, state: 'completed', proposals: [{ id: operationId, runId: operationId, workspaceId: this.id,
          kind: before ? 'edit' : 'create', ...(before ? { fileId: before.fileId } : {}), path, base: before?.content ?? '', content, reason, status: 'ready' }] }] });
    this.db.prepare('INSERT INTO agent_proposals(id,root,root_key,fingerprint,body) VALUES(?,?,?,?,?)')
      .run(operationId, this.root, rootKey, fingerprint, JSON.stringify(session));
    return { proposalId: operationId, status: 'awaiting_review', written: false };
  }
  proposalStatus(operationId: string) {
    this.assertWorkspace();
    if (!uuid.test(operationId)) throw new Error('建议标识无效');
    const row = this.db.prepare('SELECT status FROM agent_proposals WHERE id=? AND root=? AND root_key=?')
      .get(operationId, this.root, `${this.rootIdentity.dev}:${this.rootIdentity.ino}`) as { status: string } | undefined;
    if (!row) throw new Error('建议不存在于当前工作区');
    return { proposalId: operationId, status: row.status, written: row.status === 'applied' };
  }
  list(query = '') {
    const files: { path: string; size: number }[] = [];
    let scanned = 0;
    const walk = (relative: string) => {
      let directory = this.root;
      for (const part of relative.split('/').filter(Boolean)) {
        directory = join(directory, part);
        if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) return;
      }
      this.assertWorkspace();
      for (const entry of readdirSync(join(this.root, relative), { withFileTypes: true })) {
        if (++scanned > 50_000) throw new Error('工作区扫描超过 50,000 项，请缩小范围');
        if (
          entry.name.startsWith('.') ||
          ['node_modules', 'target', 'dist'].includes(entry.name) ||
          entry.isSymbolicLink()
        )
          continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path);
        else if (
          entry.isFile() &&
          isMarkdown(path) &&
          path.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ) {
          try {
            const target = this.target(path);
            files.push({ path, size: lstatSync(target).size });
          } catch {
            /* Entries may disappear while scanning. */
          }
        }
      }
    };
    walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  change(path: string, content: string, expectedHash: string | null, client: string) {
    if (this.policy.access !== 'write') throw new Error('Agent 未获直接写入权限，请提交提案供审阅');
    const bytes = Buffer.from(content);
    if (text(bytes) !== content) throw new Error('正文包含无效 Unicode 字符');
    if (bytes.length > maxBytes) throw new Error('文档超过 8 MiB');
    const creating = expectedHash === null;
    this.target(path, !creating);
    const before = creating ? null : this.read(path);
    if (creating && existsSync(join(this.root, path)))
      throw new Error('文件已存在，请先读取并使用条件写入');
    if (before && before.sha256 !== expectedHash)
      throw new Error('内容已变化：请重新读取并合并，不要覆盖最新修改');
    if (before?.content === content) return { path, sha256: before.sha256, changed: false };
    const id = randomUUID(),
      afterHash = hash(bytes);
    this.db
      .prepare(
        `INSERT INTO agent_changes
      (id,root,path,client,instance_id,operation,created_at,status,before_hash,after_hash,before_content,after_content)
      VALUES (?,?,?,?,?,?,?,'prepared',?,?,?,?)`,
      )
      .run(
        id,
        this.root,
        path,
        client.slice(0, 120),
        this.instanceId,
        creating ? 'create' : 'write',
        Date.now(),
        before?.sha256 ?? null,
        afterHash,
        before?.content ?? null,
        content,
      );
    let temporary: string | undefined;
    let changed = false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const target = this.target(path, !creating);
      if (!creating && this.read(path).sha256 !== expectedHash)
        throw new Error('内容已变化，请重新读取并合并');
      temporary = join(dirname(target), `.tano-agent-${id}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, bytes);
        if (!creating) fchmodSync(fd, lstatSync(target).mode & 0o777);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.target(path, !creating);
      if (creating) {
        // Hard-link publication is atomic and fails if the destination exists.
        linkSync(temporary, target);
        changed = true;
        unlinkSync(temporary);
      } else {
        if (this.read(path).sha256 !== expectedHash)
          throw new Error('内容已变化，请重新读取并合并');
        renameSync(temporary, target);
        changed = true;
      }
      temporary = undefined;
      this.db.prepare("UPDATE agent_changes SET status='applied' WHERE id=?").run(id);
      this.db.exec('COMMIT');
      return { path, sha256: afterHash, changed: true, activityId: id };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* A commit might already have completed. */
      }
      if (!changed)
        this.db
          .prepare("UPDATE agent_changes SET status='failed',error=? WHERE id=?")
          .run(String(error).slice(0, 500), id);
      // If publication happened but acknowledgement failed, keep prepared status
      // for human inspection; never claim that the write did not happen.
      throw new Error(`${changed ? '文件可能已写入，请读取核对；' : ''}${String(error)}`);
    } finally {
      if (temporary) {
        try {
          unlinkSync(temporary);
        } catch {
          /* Keep original failure. */
        }
      }
    }
  }
}
