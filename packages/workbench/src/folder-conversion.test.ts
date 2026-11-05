// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';
import { convertFolderDocument, planFolderConversion, rewriteConversionLinks } from './folder-conversion';

beforeEach(() => localStorage.clear());
async function fixture(extra: Record<string, string> = {}) {
  const adapter = new DemoAdapter({ files: {
    '设计.md': '# 设计\n\n![图](assets/a.png)\n[同级](其他.md#标题)\n[[其他|别名]]\n[自己](设计.md#设计)\n',
    '其他.md': '# 其他\n\n[设计](设计.md#设计)\n[[设计#设计|方案]]\n[引用][ref]\n\n[ref]: <设计.md> "说明"\n',
    'assets/a.png': 'picture', ...extra,
  } });
  const workspace = await adapter.open();
  return { adapter, workspace, source: workspace.files.find(file => file.path === '设计.md')! };
}

it.each(['README.md', '_index.md', 'index.md'] as const)('round trips identity, attachments, incoming and outgoing references with %s', async filename => {
  const { adapter, workspace, source } = await fixture();
  const converted = await convertFolderDocument(adapter, workspace.id, source, filename, 'child');
  const homePath = `设计/${filename}`;
  expect(converted.workspace.files.find(file => file.id === source.id)?.path).toBe(homePath);
  expect((await adapter.read(homePath)).content).toContain('../assets/a.png');
  expect((await adapter.read(homePath)).content).toContain('../%E5%85%B6%E4%BB%96.md#标题');
  expect((await adapter.read('其他.md')).content).toContain(`%E8%AE%BE%E8%AE%A1/${filename}#设计`);
  expect((await adapter.read('其他.md')).content).toContain('|方案]]');
  const folder = converted.workspace.files.find(file => file.path === '设计')!;
  expect(() => planFolderConversion(converted.workspace.files, folder, filename, 'flatten')).toThrow('其他文件');
  await adapter.remove(converted.plan.childPath!);
  const restored = await convertFolderDocument(adapter, workspace.id, folder, filename, 'flatten');
  expect(restored.workspace.files.find(file => file.id === source.id)?.path).toBe('设计.md');
  expect(restored.workspace.files.some(file => file.path === '设计')).toBe(false);
  expect((await adapter.read('设计.md')).content).toContain('assets/a.png');
  expect((await adapter.read('其他.md')).content).toContain('%E8%AE%BE%E8%AE%A1.md#设计');
});

it('adds a child to an existing home without creating a nested README folder', async () => {
  const { adapter, workspace, source } = await fixture();
  const first = await convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child');
  const home = first.workspace.files.find(file => file.id === source.id)!;
  const second = await convertFolderDocument(adapter, workspace.id, home, 'README.md', 'child');
  expect(second.plan.childPath).toBe('设计/新建文档 2.md');
  expect(second.workspace.files.some(file => file.path === '设计/README')).toBe(false);
});

it('rejects collisions, disabled settings, readonly references and nonempty directories before changing files', async () => {
  const { adapter, workspace, source } = await fixture({ '设计/保留.md': 'keep' });
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('同名');
  await expect(convertFolderDocument(adapter, workspace.id, source, '', 'child')).rejects.toThrow('启用');
  expect(await adapter.read('设计/保留.md')).toMatchObject({ content: 'keep' });
  const refresh = adapter.refresh.bind(adapter);
  vi.spyOn(adapter, 'refresh').mockImplementation(async () => {
    const current = await refresh();
    current.files = current.files.filter(file => !file.path.startsWith('设计/'));
    current.files = current.files.filter(file => file.path !== '设计');
    current.files.find(file => file.path === '其他.md')!.readOnly = true;
    return current;
  });
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('引用文档为只读');
  expect((await adapter.read('设计.md')).content).toContain('# 设计');
});

it('rolls back a failed child creation including rewritten links without losing identity', async () => {
  const { adapter, workspace, source } = await fixture();
  const before = await adapter.read('其他.md');
  vi.spyOn(adapter, 'create').mockRejectedValueOnce(new Error('磁盘空间不足'));
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('已恢复原有结构');
  expect((await adapter.refresh()).files.find(file => file.id === source.id)?.path).toBe('设计.md');
  expect((await adapter.read('其他.md')).content).toBe(before.content);
  expect((await adapter.refresh()).files.some(file => file.path === '设计')).toBe(false);
});

it('preserves a child when creation committed but its acknowledgement was lost', async () => {
  const { adapter, workspace, source } = await fixture();
  const create = adapter.create.bind(adapter);
  vi.spyOn(adapter, 'create').mockImplementation(async (path, content) => {
    await create(path, content);
    if (path === '设计/新建文档.md') throw new Error('响应丢失');
  });
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('恢复记录');
  expect((await adapter.read('设计/新建文档.md')).content).toBe('');
  expect((await adapter.refresh()).files.find(file => file.id === source.id)?.path).toBe('设计.md');
});

it('keeps an external reference edit on a failed compare-and-write and restores the source', async () => {
  const { adapter, workspace, source } = await fixture();
  const write = adapter.write.bind(adapter);
  vi.spyOn(adapter, 'write').mockImplementation(async (path, content, hash) => {
    if (path === '其他.md' && content.includes('README.md')) {
      const now = await adapter.read(path);
      await write(path, '外部修改\n', now.hash);
    }
    return write(path, content, hash);
  });
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('已恢复原有结构');
  expect((await adapter.read('其他.md')).content).toBe('外部修改\n');
  expect((await adapter.refresh()).files.find(file => file.id === source.id)?.path).toBe('设计.md');
});

it('merges independent external edits and keeps them if a later step rolls back', async () => {
  const { adapter, workspace, source } = await fixture();
  const write = adapter.write.bind(adapter);
  let injected = false;
  vi.spyOn(adapter, 'write').mockImplementation(async (path, content, hash) => {
    if (!injected && path === '其他.md' && content.includes('README.md')) {
      injected = true;
      const now = await adapter.read(path);
      await write(path, now.content.replace('# 其他', '# 外部标题'), now.hash);
    }
    return write(path, content, hash);
  });
  vi.spyOn(adapter, 'create').mockRejectedValueOnce(new Error('创建失败'));
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('已恢复原有结构');
  const content = (await adapter.read('其他.md')).content;
  expect(content).toContain('# 外部标题');
  expect(content).toContain('[设计](设计.md#设计)');
  expect(content).not.toContain('README.md');
});

it('refuses a directory that gained unlisted content and rolls the home and links back', async () => {
  const { adapter, workspace, source } = await fixture();
  const first = await convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child');
  await adapter.remove(first.plan.childPath!);
  const removeEmpty = adapter.removeEmptyFolder.bind(adapter);
  vi.spyOn(adapter, 'removeEmptyFolder').mockImplementationOnce(async (id, path) => {
    await adapter.create(`${path}/外部新增.txt`, 'keep');
    return removeEmpty(id, path);
  });
  const folder = first.workspace.files.find(file => file.path === '设计')!;
  await expect(convertFolderDocument(adapter, workspace.id, folder, 'README.md', 'flatten')).rejects.toThrow('已恢复原有结构');
  expect((await adapter.read('设计/外部新增.txt')).content).toBe('keep');
  expect((await adapter.refresh()).files.find(file => file.id === source.id)?.path).toBe('设计/README.md');
  expect((await adapter.read('其他.md')).content).toContain('README.md');
});

it('preserves code, metadata, URLs, object references and reference titles while rewriting nested Markdown destinations', async () => {
  const { workspace, source } = await fixture();
  const input = '---\ncover: assets/a.png\n---\n`[x](设计.md)`\n```md\n[[设计]]\n```\n' +
    '[**设计**](<设计.md> "title") ![a](assets/a(1).png)\n[x][id]\n\n[id]: 设计.md "T"\n' +
    '[[设计|别名]] [[设计]] [web](https://example.com) [id](object://document/abcdef)\n';
  const result = rewriteConversionLinks(input, '其他.md', source, '设计/README.md', workspace.files);
  expect(result).toContain('`[x](设计.md)`');
  expect(result).toContain('```md\n[[设计]]\n```');
  expect(result).toContain('[**设计**](<%E8%AE%BE%E8%AE%A1/README.md> "title")');
  expect(result).toContain('[id]: %E8%AE%BE%E8%AE%A1/README.md "T"');
  expect(result).toContain('https://example.com');
  expect(result).toContain('object://document/abcdef');
  expect(result).toContain('![a](assets/a(1).png)');
  expect(result).toContain('[[%E8%AE%BE%E8%AE%A1/README.md|设计]]');
});

it('rebases a relative cover and rejects unsupported HTML paths before moving', async () => {
  const { adapter, workspace, source } = await fixture();
  const base = await adapter.read(source.path);
  await adapter.write(source.path, '---\ncover: assets/a.png\n---\n# 设计\n', base.hash);
  await convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child');
  expect((await adapter.read('设计/README.md')).content).toContain('../assets/a.png');
  expect(() => rewriteConversionLinks('<img src="assets/a.png">', source.path, source, '设计/README.md', workspace.files)).toThrow('HTML 路径');
});

it('keeps conflicting external edits and writes a recovery record if compensation cannot safely restore a link', async () => {
  const { adapter, workspace, source } = await fixture();
  const create = adapter.create.bind(adapter);
  vi.spyOn(adapter, 'create').mockImplementation(async (path, content) => {
    if (path === '设计/新建文档.md') {
      const now = await adapter.read('其他.md');
      await adapter.write('其他.md', now.content.replace('README.md', '外部改名.md'), now.hash);
      throw new Error('创建失败');
    }
    return create(path, content);
  });
  await expect(convertFolderDocument(adapter, workspace.id, source, 'README.md', 'child')).rejects.toThrow('恢复记录');
  expect((await adapter.read('其他.md')).content).toContain('外部改名.md');
  const current = await adapter.refresh();
  expect(current.files.find(file => file.id === source.id)?.path).toBe('设计.md');
  const backup = current.files.find(file => file.path.startsWith('.tano/conflicts/folder-conversion-'))!;
  const record = JSON.parse((await adapter.read(backup.path)).content);
  expect(record.homeBase.content).toContain('# 设计');
  expect(record.edits.find((edit: { path: string }) => edit.path === '其他.md').before.content).toContain('[设计](设计.md#设计)');
});
