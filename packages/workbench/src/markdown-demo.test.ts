// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMarkdownDemo, markdownDemoStorageKey } from './markdown-demo';
import { markdownDemoLocaleFromPath, markdownDemoPath } from './markdown-demo-routes';
import { loadObjects } from './workspace-objects';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((_blob: Blob) => `blob:demo-${crypto.randomUUID()}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['zh-cn', 'en-us'] as const)('opens only the %s documents, resources, and object records', async locale => {
  const { adapter } = createMarkdownDemo(locale);
  const workspace = await adapter.open();
  expect(workspace.id).toBe(`demo-${locale}`);
  const documents = workspace.files.filter(file => file.kind === 'file' && /\.(md|markdown)$/.test(file.path));
  expect(documents).toHaveLength(11);
  expect(workspace.files.some(file => /^(zh-CN|en-US)(\/|$)/.test(file.path))).toBe(false);
  expect(documents.some(file => file.path.includes(locale === 'zh-cn' ? 'getting-started' : '从这里开始'))).toBe(false);
  const home = await adapter.read(locale === 'zh-cn' ? '00-从这里开始.md' : '00-getting-started.md');
  expect(home.content).not.toMatch(/\.\.\/(en-US|zh-CN|开始使用)/);
  const { records, errors } = await loadObjects(adapter, workspace);
  expect(errors).toEqual([]);
  expect(records).toHaveLength(4);
  const identities = new Set(records.map(record => record.object.id));
  expect([...identities].sort()).toEqual((locale === 'zh-cn'
    ? ['e82f91', 'f82f91', '182f91', '282f91'] : ['a82f91', 'b82f91', 'c82f91', 'd82f91']).sort());
  expect(workspace.files.filter(file => file.kind === 'file').every(file => !identities.has(file.id))).toBe(true);
});

it('isolates edits and sessions between demos, keeping both stable across reloads', async () => {
  const legacy = 'Preserve earlier bilingual drafts';
  localStorage.setItem('tano.demo.markdown.v1', legacy);
  localStorage.setItem('tano.demo.v2', legacy);
  const chinese = createMarkdownDemo('zh-cn').adapter;
  const english = createMarkdownDemo('en-us').adapter;
  const workspace = await chinese.open();
  const path = '00-从这里开始.md';
  const snapshot = await chinese.read(path);
  expect((await chinese.write(path, `${snapshot.content}\n我的笔记\n`, snapshot.hash)).status).toBe('saved');
  await chinese.create('我的文档.md', 'file');
  const file = workspace.files.find(file => file.path === path)!;
  const session = { version: 1 as const, activeId: file.id, documents: [] };
  await chinese.saveSession(workspace.id, session);
  const reloaded = createMarkdownDemo('zh-cn').adapter;
  expect((await reloaded.read(path)).content).toContain('我的笔记');
  expect((await reloaded.open()).files.find(file => file.path === path)?.id).toBe(file.id);
  expect(await reloaded.loadSession(workspace.id)).toEqual(session);
  expect(await english.loadSession('demo-en-us')).toBeNull();
  expect((await english.open()).files.some(file => file.path === '我的文档.md')).toBe(false);
  expect((await english.read('00-getting-started.md')).content).not.toContain('我的笔记');
  const englishId = (await english.open()).files.find(file => file.path === '00-getting-started.md')?.id;
  expect((await createMarkdownDemo('en-us').adapter.open()).files.find(file => file.path === '00-getting-started.md')?.id).toBe(englishId);
  expect(localStorage.getItem('tano.demo.v2')).toBe(legacy);
  expect(localStorage.getItem('tano.demo.markdown.v1')).toBe(legacy);
  expect(localStorage.getItem(markdownDemoStorageKey('zh-cn'))).not.toBeNull();
  expect(localStorage.getItem(markdownDemoStorageKey('en-us'))).not.toBeNull();
});

it('uses the selected locally compiled dataset supplied by the client', async () => {
  const { adapter } = createMarkdownDemo('en-us', {
    '00-getting-started.md': '# Local English guide\n',
    'nested/document.md': '# Local example\n',
  });
  const workspace = await adapter.open();
  expect(workspace.id).toBe('demo-en-us');
  expect(workspace.files.filter(file => file.kind === 'file')).toHaveLength(2);
  expect((await adapter.read('00-getting-started.md')).content).toBe('# Local English guide\n');
  expect(workspace.files.some(file => file.path === 'nested' && file.kind === 'directory')).toBe(true);
});

it.each(['zh-cn', 'en-us'] as const)('resolves %s images and attachment bytes without accessing the other demo', async locale => {
  const { adapter, attachments } = createMarkdownDemo(locale);
  const workspace = await adapter.open();
  const nested = locale === 'zh-cn' ? '子目录/目标文档.markdown' : 'nested-folder/target-document.markdown';
  const image = locale === 'zh-cn' ? '测试图片.png' : 'test-image.png';
  const attachment = locale === 'zh-cn' ? '示例 附件.txt' : 'sample attachment.txt';
  const original = attachments.imageUrl(workspace, nested, `../assets/${image}`);
  expect(original).toMatch(/^blob:/);
  expect((vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob).type).toBe('image/png');
  expect(attachments.imageUrl(workspace, nested, '../assets/missing.png')).toBeNull();
  expect(attachments.imageUrl(workspace, nested, '../../../outside.png')).toBeNull();
  expect(attachments.imageUrl(await createMarkdownDemo(locale === 'zh-cn' ? 'en-us' : 'zh-cn').adapter.open(), nested, `../assets/${image}`)).toBeNull();
  await adapter.move('assets', 'resources', 'directory');
  expect(attachments.imageUrl(await adapter.refresh(), nested, `../resources/${image}`)).toBe(original);
  expect(adapter.resource(`resources/${image}`)?.content).toMatch(/^data:image\/png;base64,iVBOR/);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await attachments.exportAttachment(workspace.id, `resources/${attachment}`);
  expect((click.mock.instances[0] as HTMLAnchorElement | undefined)?.download).toBe(attachment);
  await expect(attachments.importAttachment(workspace.id, '', new File(['x'], 'x.png'), true)).rejects.toThrow(locale === 'zh-cn' ? '桌面版' : 'desktop app');
});

it('keeps the language in entry URLs and document deep links', () => {
  for (const locale of ['zh-cn', 'en-us'] as const) {
    expect(markdownDemoLocaleFromPath(markdownDemoPath(locale))).toBe(locale);
    expect(markdownDemoLocaleFromPath(`/p/demo-${locale}/abc123`)).toBe(locale);
  }
  for (const path of ['/demo', '/p/demo/abc123', '/p/cloud-workspace/abc123', '/en-us/docs/demo', '/zh-cn/demo/unknown']) {
    expect(markdownDemoLocaleFromPath(path)).toBeUndefined();
  }
});
