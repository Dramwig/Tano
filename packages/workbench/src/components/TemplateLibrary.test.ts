// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import TemplateLibrary from './TemplateLibrary.vue';
import type { DocumentTemplate } from '../workspace-templates';

const mock = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => mock.store }));
vi.mock('@tano/editor', () => ({ default: defineComponent({ props: ['modelValue'], setup: props => () => h('div', { class: 'preview-stub' }, props.modelValue) }) }));
let app: App, root: HTMLDivElement;
const onClose = vi.fn();
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }
function button(label: string) {
  const result = [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label);
  expect(result, label).toBeDefined(); return result!;
}
async function click(label: string) { button(label).click(); await settle(); }
async function fill(label: string, value: string) {
  const input = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find(item => item.getAttribute('aria-label') === label || item.closest('label')?.textContent?.trim() === label);
  expect(input, label).toBeDefined(); input!.value = value; input!.dispatchEvent(new Event('input', { bubbles: true })); await settle();
}
async function mount(props = {}) {
  root = document.createElement('div'); document.body.append(root);
  app = createApp(TemplateLibrary, { ...props, onClose }); app.mount(root); await settle();
}
beforeEach(() => {
  onClose.mockReset();
  mock.store = reactive({
    workspace: { id: 'workspace', name: '测试工作区', files: [{ id: 'weekly', name: '周报.md', path: '周报.md', kind: 'file' }], readOnly: false },
    templates: vi.fn().mockResolvedValue({ templates: [], errors: [] }),
    writeTemplate: vi.fn(), create: vi.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => { app?.unmount(); root?.remove(); });

it('uses workspace breadcrumbs for page navigation and does not dismiss on Escape', async () => {
  const onOpenFile = vi.fn();
  await mount({ onOpenFile });
  const breadcrumb = () => root.querySelector('nav[aria-label="当前位置"]')!;
  expect(breadcrumb().textContent).toContain('测试工作区');
  expect(breadcrumb().querySelector('[aria-current="page"]')?.textContent).toContain('模板库');
  await click('查看会议纪要模板');
  expect(breadcrumb().querySelector('[aria-current="page"]')?.textContent).toBe('会议纪要');
  expect([...root.querySelectorAll('button')].some(item => item.textContent?.includes('返回'))).toBe(false);
  await click('预览模板');
  expect(breadcrumb().querySelector('[aria-current="page"]')?.textContent).toBe('预览');
  root.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  expect(breadcrumb().querySelector('[aria-current="page"]')?.textContent).toBe('预览');
  expect(onClose).not.toHaveBeenCalled();
  await click('模板库');
  expect(root.querySelector('.template-grid')).not.toBeNull();
  await click('浏览工作区：测试工作区');
  const entry = document.querySelector<HTMLButtonElement>('.breadcrumb-menu-entry')!;
  expect(entry.textContent).toContain('周报');
  entry.click(); await settle();
  expect(onOpenFile).toHaveBeenCalledWith(mock.store.workspace.files[0]);
});

it('opens details and a rendered read-only preview without creating or modifying documents', async () => {
  await mount();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  await click('查看会议纪要模板');
  expect(button('添加到工作区').disabled).toBe(true);
  await click('预览模板');
  expect(root.querySelector('.preview-stub')?.textContent).toContain('参与人：待补充');
  expect(root.querySelector('aside')).toBeNull();
  await click('会议纪要');
  await fill('参与人 / 接手人', '张三');
  expect(button('添加到工作区').disabled).toBe(false);
  expect(mock.store.create).not.toHaveBeenCalled();
  expect(mock.store.writeTemplate).not.toHaveBeenCalled();
});

it('applies to the captured blank document and keeps errors visible if the document changes', async () => {
  const apply = vi.fn().mockImplementationOnce(() => { throw new Error('文档已变化，现有内容已保留'); });
  await mount({ initialize: { title: '我的标题', apply } });
  await click('查看会议纪要模板'); await fill('参与人 / 接手人', '张三');
  await click('添加到当前文档');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('现有内容已保留');
  expect(onClose).not.toHaveBeenCalled();
  await click('添加到当前文档');
  expect(apply).toHaveBeenLastCalledWith(expect.stringContaining('# 我的标题'));
  expect(apply).toHaveBeenLastCalledWith(expect.stringContaining('参与人：张三'));
  expect(mock.store.create).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

it('creates a new document with an unused suggested path and prevents repeated submissions', async () => {
  let complete!: () => void;
  mock.store.create.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  await mount(); await click('查看周报模板');
  await click('添加到工作区');
  expect(button('正在添加…').disabled).toBe(true);
  expect(mock.store.create).toHaveBeenCalledWith('周报 2.md', false, expect.stringContaining('测试工作区'), 'workspace');
  button('正在添加…').click();
  expect(mock.store.create).toHaveBeenCalledOnce();
  complete(); await settle(); expect(onClose).toHaveBeenCalledOnce();
});

it('filters the gallery, reports empty results and restores browsing', async () => {
  await mount(); await click('学习');
  expect(root.querySelectorAll('.template-card')).toHaveLength(1);
  await fill('搜索模板', '找不到的模板');
  expect(root.textContent).toContain('没有找到匹配的模板');
  await click('查看全部模板');
  expect(root.querySelectorAll('.template-card').length).toBeGreaterThan(3);
});

it('preserves the custom template base and draft when saving reports an external conflict', async () => {
  const custom: DocumentTemplate = { id: 'custom', name: '团队记录', content: '# {{title}}\n\n原模板', path: '.tano/templates/abc123.md', snapshot: { content: '# {{title}}\n\n原模板', hash: 'base' } as DocumentTemplate['snapshot'] };
  mock.store.templates.mockResolvedValue({ templates: [custom], errors: [] });
  mock.store.writeTemplate.mockRejectedValue(new Error('模板已被外部修改，当前草稿已保留'));
  await mount(); await click('我的模板'); await click('查看团队记录模板'); await click('编辑模板');
  await fill('模板 Markdown', '# {{title}}\n\n我的改动'); await click('保存模板');
  expect(mock.store.writeTemplate).toHaveBeenCalledWith(expect.stringContaining('我的改动'), 'workspace', custom);
  expect(root.querySelector('textarea')?.value).toContain('我的改动');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('外部修改');
  expect(onClose).not.toHaveBeenCalled();
});

it('blocks writes when the original workspace becomes read-only', async () => {
  await mount(); await click('查看周报模板');
  mock.store.workspace.readOnly = true; await settle();
  expect(button('添加到工作区').disabled).toBe(true);
  await click('添加到工作区'); expect(mock.store.create).not.toHaveBeenCalled();
});
