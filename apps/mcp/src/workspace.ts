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
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMarkdown, validatePath, parseAssistantSession } from '@tano/protocol';

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
  constructor(root: string, dataDirectory: string) {
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
          i === parts.length - 1 &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return current;
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
        before && Buffer.byteLength(before.content) <= previewBytes ? before.content : null,
        bytes.length <= previewBytes ? content : null,
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
      this.db
        .prepare(
          "DELETE FROM agent_changes WHERE status!='prepared' AND id NOT IN (SELECT id FROM agent_changes ORDER BY created_at DESC LIMIT 200)",
        )
        .run();
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
