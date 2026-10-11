// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { webcrypto } from 'node:crypto';
import { DemoAdapter } from './adapter';
import { createDataTableController } from './data-table-controller';
import { copyTable, newDataTable } from './data-tables';
import { createAndSelectDataOption } from './data-table-properties';
import { parseDataTable, dataTablePath } from '@tano/protocol';
import type { Workspace } from '@tano/protocol';

const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    configurable: true,
  });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (name: string, action: () => unknown) => {
        const next = (queues.get(name) ?? Promise.resolve()).then(action);
        queues.set(
          name,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
});
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});
async function setup() {
  const adapter = new DemoAdapter({ files: { 'note.md': '正文' } });
  let workspace: Workspace = await adapter.open();
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = chain.then(action, action);
    chain = next.catch(() => {});
    return next;
  };
  const scope = effectScope();
  scopes.push(scope);
  const controller = scope.run(() =>
    createDataTableController({
      adapter,
      workspace: () => workspace,
      serial,
      refresh: async () => {
        workspace = await adapter.refresh();
      },
    }),
  )!;
  await controller.reload();
  return {
    adapter,
    controller,
    refresh: async () => {
      workspace = await adapter.refresh();
      await controller.reload();
    },
    setReadonly: () => {
      workspace.readOnly = true;
    },
  };
}
it('undoes and redoes option creation with its selection as one saved change', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create('parts');
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { category: ['CPU'] } }));
  const before = copyTable(controller.records.value[0].draft);
  controller.edit(id, (table) =>
    createAndSelectDataOption(table, 'r1', 'category', '外设', ['CPU']),
  );
  const after = copyTable(controller.records.value[0].draft);
  controller.undo(id);
  expect(controller.records.value[0].draft).toEqual(before);
  controller.undo(id, true);
  expect(controller.records.value[0].draft).toEqual(after);
  expect(await controller.persistAll()).toBe(true);
  expect(parseDataTable((await adapter.read(controller.records.value[0].path)).content)).toEqual(
    after,
  );
});
it('creates no Markdown row documents, persists and reopens typed cells and views', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create('parts');
  controller.edit(id, (table) => {
    table.rows.push({ id: 'r1', values: { name: '处理器', price: 1200, status: '选择' } });
    table.views[0].widths.price = 240;
  });
  expect(await controller.persistAll()).toBe(true);
  const stored = parseDataTable(
    (await adapter.read(controller.records.value.find((record) => record.fileId === id)!.path))
      .content,
  );
  expect(stored.rows[0].values.price).toBe(1200);
  expect(stored.views[0].widths.price).toBe(240);
  expect((await adapter.refresh()).files.filter((file) => file.path.endsWith('.md'))).toHaveLength(
    1,
  );
  controller.reset();
  await controller.reload();
  expect(controller.records.value[0].draft).toEqual(stored);
});
it('journals unfinished drafts, restores and merges a concurrent external edit', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create('parts');
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { name: 'A', price: 100 } }));
  await controller.persistAll();
  controller.edit(id, (table) => {
    table.rows[0].values.name = '未保存名称';
  });
  const drafts = controller.drafts();
  const base = await adapter.read(
      controller.records.value.find((record) => record.fileId === id)!.path,
    ),
    remote = JSON.parse(base.content);
  remote.rows[0].values.price = 200;
  await adapter.write(
    controller.records.value.find((record) => record.fileId === id)!.path,
    JSON.stringify(remote),
    base.hash,
  );
  controller.reset();
  await controller.reload();
  await controller.restore(drafts);
  expect(controller.records.value[0].draft.rows[0].values).toMatchObject({
    name: '未保存名称',
    price: 200,
  });
  expect(controller.drafts()).toEqual([]);
});
it('keeps the draft and a recovery file on conflicting edits, and refuses readonly writes', async () => {
  const { adapter, controller, setReadonly } = await setup();
  const id = await controller.create('parts');
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { price: 100 } }));
  await controller.persistAll();
  controller.edit(id, (table) => {
    table.rows[0].values.price = 200;
  });
  const base = await adapter.read(
      controller.records.value.find((record) => record.fileId === id)!.path,
    ),
    remote = JSON.parse(base.content);
  remote.rows[0].values.price = 300;
  await adapter.write(
    controller.records.value.find((record) => record.fileId === id)!.path,
    JSON.stringify(remote),
    base.hash,
  );
  expect(await controller.persistAll()).toBe(false);
  expect(controller.records.value[0].error).toContain('重叠修改');
  expect(controller.records.value[0].draft.rows[0].values.price).toBe(200);
  expect(
    (await adapter.refresh()).files.some((file) => file.path.startsWith('.tano/conflicts/table-')),
  ).toBe(true);
  await controller.discard(id);
  expect(controller.records.value[0].draft.rows[0].values.price).toBe(300);
  setReadonly();
  expect(() =>
    controller.edit(id, (table) => {
      table.name = '不允许';
    }),
  ).toThrow('只读');
});
it('does not lose edits that arrive while saving, and undo preserves confirmed content', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create('parts');
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { price: 100 } }));
  await controller.persistAll();
  const write = adapter.write.bind(adapter);
  vi.spyOn(adapter, 'write').mockImplementationOnce(async (...args) => {
    controller.edit(id, (table) => {
      table.rows[0].values.name = '保存期间输入';
    });
    return write(...args);
  });
  controller.edit(id, (table) => {
    table.rows[0].values.price = 200;
  });
  await controller.persistAll();
  await controller.persistAll();
  expect(controller.records.value[0].draft.rows[0].values).toMatchObject({
    price: 200,
    name: '保存期间输入',
  });
  controller.undo(id);
  await controller.persistAll();
  expect(controller.records.value[0].draft.rows[0].values).toEqual({ price: 200 });
  controller.undo(id, true);
  await controller.persistAll();
  expect(controller.records.value[0].draft.rows[0].values.name).toBe('保存期间输入');
});
it('browser instances serialize table writes, reject stale hashes and retain unrelated documents', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create();
  const other = new DemoAdapter();
  const base = await adapter.read(
    controller.records.value.find((record) => record.fileId === id)!.path,
  );
  const a = copyTable(controller.records.value[0].table),
    b = copyTable(a);
  a.name = 'A';
  b.name = 'B';
  const results = await Promise.all([
    adapter.write(
      controller.records.value.find((record) => record.fileId === id)!.path,
      JSON.stringify(a),
      base.hash,
    ),
    other.write(
      controller.records.value.find((record) => record.fileId === id)!.path,
      JSON.stringify(b),
      base.hash,
    ),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'saved']);
  const document = await other.read('note.md');
  await other.write('note.md', '外部正文', document.hash);
  expect(
    parseDataTable(
      (await other.read(controller.records.value.find((record) => record.fileId === id)!.path))
        .content,
    ).name,
  ).toBe('A');
  const current = await adapter.read(
    controller.records.value.find((record) => record.fileId === id)!.path,
  );
  await adapter.write(
    controller.records.value.find((record) => record.fileId === id)!.path,
    JSON.stringify(b),
    current.hash,
  );
  expect((await new DemoAdapter().read('note.md')).content).toBe('外部正文');
});

it('creates visible table files in a chosen directory and avoids overwriting names', async () => {
  const { adapter, controller } = await setup();
  await adapter.createFolder('研究');
  await controller.create('parts', undefined, '研究');
  await controller.create('parts', undefined, '研究');
  expect(controller.records.value.map((record) => record.path)).toEqual([
    '研究/配件选择.table.json',
    '研究/配件选择 2.table.json',
  ]);
  await expect(controller.create('parts', undefined, '不存在')).rejects.toThrow('目标文件夹不存在');
  expect(
    (await adapter.refresh()).files.some((file) => file.path.startsWith('.tano/tables/')),
  ).toBe(false);
});

it('migrates legacy tables without changing file identity and keeps the original bytes', async () => {
  const { adapter, controller, refresh } = await setup();
  const original = JSON.stringify(newDataTable('a12345', 'parts'));
  await adapter.create(dataTablePath('a12345'), original);
  const id = (await adapter.refresh()).files.find(
    (file) => file.path === dataTablePath('a12345'),
  )!.id;
  await refresh();
  expect(controller.records.value[0]).toMatchObject({ fileId: id, path: '配件选择.table.json' });
  expect(
    (await adapter.refresh()).files.some((file) => file.path === dataTablePath('a12345')),
  ).toBe(false);
  const backup = (await adapter.refresh()).files.find((file) =>
    file.path.startsWith('.tano/conflicts/table-migration-'),
  )!;
  expect((await adapter.read(backup.path)).content).toBe(original);
  await refresh();
  expect(controller.records.value).toHaveLength(1);
});

it('follows external file and parent-folder moves while saving dirty cells', async () => {
  const { adapter, controller, refresh } = await setup();
  const id = await controller.create('parts');
  await adapter.createFolder('研究');
  const other = new DemoAdapter();
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { name: '移动期间输入' } }));
  await other.move('配件选择.table.json', '研究/候选.table.json', 'file');
  expect(await controller.persistAll()).toBe(true);
  expect(controller.records.value[0].path).toBe('研究/候选.table.json');
  await other.move('研究', '归档', 'directory');
  await refresh();
  controller.edit(id, (table) => {
    table.rows[0].values.price = 100;
  });
  expect(await controller.persistAll()).toBe(true);
  expect(parseDataTable((await other.read('归档/候选.table.json')).content).rows[0].values).toEqual(
    { name: '移动期间输入', price: 100 },
  );
  expect((await adapter.refresh()).files.some((file) => file.path === '配件选择.table.json')).toBe(
    false,
  );
});

it('opens byte-identical copied files independently and restores drafts by file identity', async () => {
  const { adapter, controller, refresh } = await setup();
  const firstId = await controller.create('parts');
  const original = await adapter.read('配件选择.table.json');
  await adapter.create('副本.table.json', original.content);
  await refresh();
  const secondId = controller.records.value.find(
    (record) => record.path === '副本.table.json',
  )!.fileId;
  expect(secondId).not.toBe(firstId);
  controller.edit(firstId, (table) => table.rows.push({ id: 'r1', values: { name: '原表' } }));
  controller.edit(secondId, (table) => table.rows.push({ id: 'r1', values: { name: '副本' } }));
  const drafts = controller.drafts();
  controller.reset();
  await controller.reload();
  await controller.restore(drafts);
  expect(
    parseDataTable((await adapter.read('配件选择.table.json')).content).rows[0].values.name,
  ).toBe('原表');
  expect(parseDataTable((await adapter.read('副本.table.json')).content).rows[0].values.name).toBe(
    '副本',
  );
});

it('does not resurrect removed files or overwrite a new file occupying the old path', async () => {
  const { adapter, controller } = await setup();
  const id = await controller.create('parts');
  const original = await adapter.read('配件选择.table.json');
  controller.edit(id, (table) => table.rows.push({ id: 'r1', values: { name: '待恢复' } }));
  const other = new DemoAdapter();
  await other.remove('配件选择.table.json');
  await other.create('配件选择.table.json', original.content);
  expect(await controller.persistAll()).toBe(false);
  expect((await other.read('配件选择.table.json')).content).toBe(original.content);
  expect(controller.records.value[0].error).toContain('原数据表文件已不存在');
  expect(controller.records.value[0].draft.rows[0].values.name).toBe('待恢复');
});
