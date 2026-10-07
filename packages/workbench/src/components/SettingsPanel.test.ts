// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import SettingsPanel from './SettingsPanel.vue';
import type { EditorPreferences } from '@tano/editor/runtime';
import type { SettingsPageContext } from '../runtime';
import { parsePageTitleSource, type PageTitleSource } from '../page-title-source';

vi.mock('./UpdatePanel.vue', () => ({
  default: { template: '<div class="update-panel-stub">应用更新</div>' },
}));

let app: App;
let root: HTMLDivElement;
let revealUpdates: boolean[];
let preferenceUpdates: EditorPreferences[];
let revealMarkdown = ref(true);
let theme = ref<'light' | 'dark' | 'system'>('system');
let visualFontChoice = ref<'system' | 'serif' | 'mono' | 'custom'>('system');
let customFontName = ref('');
let showPageTitle = ref(true);
let outlineOnLeft = ref(false);
let pageTitleSource = ref<PageTitleSource>(parsePageTitleSource(''));
let visualFontSize = ref(16);
let sourceFontSize = ref(14);
let toolbarMode = ref<'selection' | 'fixed' | 'left' | 'right'>('selection');
let workspaceMode = ref<'demo' | 'web' | 'local'>('local');
let hostWorkspace = ref<SettingsPageContext['workspace']>(null);
let hostFile = ref<SettingsPageContext['activeFile']>(null);
const ExtraSettings = defineComponent({
  props: ['mode', 'workspace', 'activeFile'],
  setup: props => () => h('div', { class: 'extra-settings-mode' },
    `${props.mode}:${props.workspace?.id ?? ''}:${props.activeFile?.id ?? ''}`),
});

async function openPage(label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('.settings-nav button')].find(
    (item) => item.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  button!.click();
  await nextTick();
}

beforeEach(() => {
  revealUpdates = [];
  preferenceUpdates = [];
  revealMarkdown = ref(true);
  theme = ref('system');
  visualFontChoice = ref('system');
  customFontName = ref('');
  showPageTitle = ref(true);
  outlineOnLeft = ref(false);
  pageTitleSource = ref(parsePageTitleSource(''));
  visualFontSize = ref(16);
  sourceFontSize = ref(14);
  toolbarMode = ref('selection');
  workspaceMode = ref('local');
  hostWorkspace = ref(null);
  hostFile = ref(null);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(
    defineComponent(() => () =>
      h(SettingsPanel, {
        workspace: hostWorkspace.value,
        workspaceDeletionSupported: true,
        activeFile: hostFile.value,
        mode: workspaceMode.value,
        extraPages: [{ id: 'extra', label: '扩展设置', group: '个人偏好', terms: '', component: ExtraSettings }],
        native: true,
        mobile: false,
        defaultSource: false,
        theme: theme.value,
        visualFontChoice: visualFontChoice.value,
        customFontName: customFontName.value,
        revealMarkdown: revealMarkdown.value,
        toolbarMode: toolbarMode.value,
        showPageTitle: showPageTitle.value,
        showOutline: true,
        outlineOnLeft: outlineOnLeft.value,
        pageTitleSource: pageTitleSource.value,
        visualFontSize: visualFontSize.value,
        sourceFontSize: sourceFontSize.value,
        historyEnabled: true,
        version: '1.2.3',
        initialPage: 'about',
        'onUpdate:revealMarkdown': (value: boolean) => revealUpdates.push(value),
        'onUpdate:toolbarMode': (value: 'selection' | 'fixed' | 'left' | 'right') => { toolbarMode.value = value; },
        'onUpdate:theme': (value: 'light' | 'dark' | 'system') => { theme.value = value; },
        'onUpdate:visualFontChoice': (value: 'system' | 'serif' | 'mono' | 'custom') => { visualFontChoice.value = value; },
        'onUpdate:customFontName': (value: string) => { customFontName.value = value; },
        'onUpdate:showPageTitle': (value: boolean) => { showPageTitle.value = value; },
        'onUpdate:outlineOnLeft': (value: boolean) => { outlineOnLeft.value = value; },
        'onUpdate:pageTitleSource': (value: PageTitleSource) => { pageTitleSource.value = value; },
        'onUpdate:editorPreferences': (value: EditorPreferences) => preferenceUpdates.push(value),
        'onUpdate:visualFontSize': (value: number) => { visualFontSize.value = value; },
        'onUpdate:sourceFontSize': (value: number) => { sourceFontSize.value = value; },
      }),
    ),
  );
  app.mount(root);
});

it('shows the Markdown reveal switch enabled and emits a change', async () => {
  await openPage('编辑设置');
  const toggle = root.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click();
  expect(revealUpdates).toEqual([false]);
});
it('shows registration-only deletion in local workspace settings and omits it from the browser demo', async () => {
  hostWorkspace.value = { id: 'local-workspace', name: '本地', path: 'C:/Notes', canDelete: true };
  await openPage('工作区');
  expect(root.querySelector('.workspace-deletion-settings')?.textContent).toContain('本地仓库注册');
  workspaceMode.value = 'demo'; await nextTick();
  expect(root.querySelector('.workspace-deletion-settings')).toBeNull();
});

it('passes host workspace identity and file context to extension pages and clears them when the host changes', async () => {
  workspaceMode.value = 'web';
  hostWorkspace.value = { id: 'online-workspace', name: '在线', path: 'web' };
  hostFile.value = { id: 'article-1', path: '文章.md' };
  await openPage('扩展设置');
  expect(root.querySelector('.extra-settings-mode')?.textContent).toBe('web:online-workspace:article-1');
  workspaceMode.value = 'local'; hostWorkspace.value = null; hostFile.value = null; await nextTick();
  expect(root.querySelector('.extra-settings-mode')?.textContent).toBe('local::');
});

it('offers all toolbar positions as a device preference even without a workspace', async () => {
  await openPage('编辑设置');
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="编辑工具栏"]')!;
  expect(select.disabled).toBe(false);
  expect(select.value).toBe('selection');
  expect([...select.options].map(option => option.textContent)).toEqual(['随选区显示（默认）', '固定在顶部', '靠左停靠', '靠右停靠']);
  for (const mode of ['fixed', 'left', 'right', 'selection']) {
    select.value = mode;
    select.dispatchEvent(new Event('change'));
    await nextTick();
    expect(toolbarMode.value).toBe(mode);
    expect(select.value).toBe(mode);
  }
});

it('offers light, dark, and system themes', async () => {
  await openPage('外观设置');
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="主题"]')!;
  expect([...select.options].map(({ textContent }) => textContent)).toEqual(['白天', '黑夜', '跟随系统']);
  expect(select.value).toBe('system');
  select.value = 'dark';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(theme.value).toBe('dark');
  expect(select.value).toBe('dark');
});

it('offers system, serif, mono, and a custom local font with a live preview', async () => {
  await openPage('外观设置');
  const fontSection = root.querySelector<HTMLElement>('section[aria-label="编辑字体与字号"]')!;
  expect(fontSection.querySelectorAll('.settings-font-preview-sample')).toHaveLength(2);
  expect(fontSection.querySelector('.settings-font-preview')?.textContent).not.toMatch(/预览|px/);
  expect(root.querySelector('section[aria-label="编辑字号"]')).toBeNull();
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="可视化编辑字体"]')!;
  expect([...select.options].map(({ textContent }) => textContent)).toEqual([
    '系统字体', '衬线字体', '等宽字体', '自定义字体',
  ]);
  select.value = 'serif';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(visualFontChoice.value).toBe('serif');
  expect(root.querySelector<HTMLElement>('.settings-visual-font-sample')?.style.fontFamily).toContain('Georgia');
  select.value = 'mono';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(visualFontChoice.value).toBe('mono');
  expect(root.querySelector<HTMLElement>('.settings-visual-font-sample')?.style.fontFamily).toContain('Maple Mono NF');
  select.value = 'custom';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  const input = root.querySelector<HTMLInputElement>('[aria-label="自定义字体名称"]')!;
  input.value = '霞鹜文楷';
  input.dispatchEvent(new Event('input'));
  await nextTick();
  expect(customFontName.value).toBe('霞鹜文楷');
  expect(root.querySelector<HTMLElement>('.settings-visual-font-sample')?.style.fontFamily).toContain('霞鹜文楷');
});

it('shows the formula preview setting and emits its change', async () => {
  await openPage('编辑设置');
  const content = root.querySelector<HTMLElement>('section[aria-label="编辑行为"]')!;
  expect(content.textContent).toContain('编辑时预览公式');
  expect(content.textContent).toContain('标题与列表折叠');
  expect(content.textContent).not.toContain('渲染数学公式');
  expect(content.textContent).not.toContain('同时显示公式源码');
  expect(content.querySelectorAll('[role="switch"]')).toHaveLength(2);
  const preview = content.querySelector<HTMLButtonElement>('[aria-label="编辑时预览公式"]')!;
  expect(preview.getAttribute('aria-checked')).toBe('true');
  preview.click();
  expect(preferenceUpdates).toEqual([{ previewMathWhileEditing: false, folding: true }]);
});

it('keeps the page title preference in sync with its current value', async () => {
  await openPage('外观设置');
  const toggle = root.querySelector<HTMLButtonElement>('[aria-label="页面内标题"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click();
  await nextTick();
  expect(showPageTitle.value).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  showPageTitle.value = true;
  await nextTick();
  expect(toggle.getAttribute('aria-checked')).toBe('true');
});

it('toggles the directory position preference', async () => {
  await openPage('外观设置');
  const toggle = root.querySelector<HTMLButtonElement>('[aria-label="目录显示在左侧"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  toggle.click();
  await nextTick();
  expect(outlineOnLeft.value).toBe(true);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click();
  await nextTick();
  expect(outlineOnLeft.value).toBe(false);
});

it('selects the page title source independently of title visibility', async () => {
  await openPage('外观设置');
  const select = root.querySelector<HTMLSelectElement>('[aria-label="页面标题来源"]')!;
  expect(select.value).toBe('frontmatter-first');
  expect([...select.options].map(option => option.textContent)).toEqual(['文件名', 'YAML title', 'YAML title 优先']);
  select.value = 'frontmatter';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(pageTitleSource.value).toBe('frontmatter');
  select.value = 'frontmatter-first';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(pageTitleSource.value).toBe('frontmatter-first');
  root.querySelector<HTMLButtonElement>('[aria-label="页面内标题"]')!.click();
  await nextTick();
  expect(select.disabled).toBe(false);
  expect(select.value).toBe('frontmatter-first');
  select.value = 'filename';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(pageTitleSource.value).toBe('filename');
});

it('adjusts each editor font size independently and restores its default', async () => {
  await openPage('外观设置');
  const visualPreview = root.querySelector<HTMLElement>('.settings-visual-font-sample')!;
  const sourcePreview = root.querySelector<HTMLElement>('.settings-source-font-sample')!;
  expect(visualPreview.style.fontSize).toBe('16px');
  expect(sourcePreview.style.fontSize).toBe('14px');
  root.querySelector<HTMLButtonElement>('[aria-label="增大可视化编辑字号"]')!.click();
  await nextTick();
  expect(visualFontSize.value).toBe(17);
  expect(sourceFontSize.value).toBe(14);
  expect(root.querySelector('output[aria-label="可视化编辑字号"]')?.textContent).toBe('17 px');
  expect(visualPreview.style.fontSize).toBe('17px');
  expect(sourcePreview.style.fontSize).toBe('14px');
  const visualReset = root.querySelectorAll<HTMLButtonElement>('.settings-font-reset')[0]!;
  visualReset.click();
  await nextTick();
  expect(visualFontSize.value).toBe(16);
  expect(visualReset.disabled).toBe(true);
  expect(visualPreview.style.fontSize).toBe('16px');
  root.querySelector<HTMLButtonElement>('[aria-label="减小 Markdown 源码字号"]')!.click();
  await nextTick();
  expect(sourceFontSize.value).toBe(13);
  expect(visualFontSize.value).toBe(16);
  expect(sourcePreview.style.fontSize).toBe('13px');
  expect(visualPreview.style.fontSize).toBe('16px');
});

it('disables formula preview when Markdown reveal is off and restores its saved choice', async () => {
  await openPage('编辑设置');
  const content = root.querySelector<HTMLElement>('section[aria-label="编辑行为"]')!;
  const preview = content.querySelector<HTMLButtonElement>('[aria-label="编辑时预览公式"]')!;
  const folding = content.querySelector<HTMLButtonElement>('[aria-label="标题与列表折叠"]')!;
  expect(preview.disabled).toBe(false);
  expect(preview.getAttribute('aria-checked')).toBe('true');

  revealMarkdown.value = false;
  await nextTick();
  expect(preview.disabled).toBe(true);
  expect(preview.getAttribute('aria-checked')).toBe('false');
  expect(content.textContent).toContain('公式面板仍会实时渲染');
  preview.click();
  expect(preferenceUpdates).toEqual([]);
  expect(folding.disabled).toBe(false);

  revealMarkdown.value = true;
  await nextTick();
  expect(preview.disabled).toBe(false);
  expect(preview.getAttribute('aria-checked')).toBe('true');
});

afterEach(() => {
  app.unmount();
  root.remove();
});

it('opens directly on the complete about page', () => {
  expect(root.querySelector('h2')?.textContent).toBe('关于同页');
  expect(root.querySelector('.settings-about-brand')?.textContent).toContain('Tano / 同页');
  expect(root.querySelector('.settings-version-pill')?.textContent).toBe('1.2.3');
  expect(root.textContent).toContain('Humans and agents, on the same page.');
  expect(root.textContent).toContain('这是你的本地 Markdown 工作台');
  expect(root.textContent).toContain('收起或展开侧栏（编辑区外） Ctrl B');
  expect(root.textContent).toContain('查找文档 Ctrl K');
  expect(root.textContent).not.toContain('版本与更新');
  expect(root.textContent).not.toContain('备份恢复与 Agent 工作流');
  expect(root.querySelector('.settings-brand-actions .update-panel-stub')).not.toBeNull();
});

it('keeps the about content inside settings navigation', async () => {
  await openPage('外观设置');
  expect(root.querySelector('h2')?.textContent).toBe('外观设置');
  await openPage('编辑设置');
  expect(root.querySelector('h2')?.textContent).toBe('编辑设置');
  await openPage('关于同页');
  expect(root.querySelector('h2')?.textContent).toBe('关于同页');
  expect(root.querySelector('.settings-about-brand')).not.toBeNull();
});

it('separates appearance and editing controls', async () => {
  await openPage('外观设置');
  expect(root.querySelector('select[aria-label="主题"]')).not.toBeNull();
  expect(root.querySelector('select[aria-label="默认编辑模式"]')).toBeNull();
  expect(root.querySelector('[aria-label="页面内标题"]')).not.toBeNull();
  await openPage('编辑设置');
  expect(root.querySelector('select[aria-label="主题"]')).toBeNull();
  expect(root.querySelector('select[aria-label="默认编辑模式"]')).not.toBeNull();
  expect(root.querySelector('[aria-label="页面内标题"]')).toBeNull();
});
