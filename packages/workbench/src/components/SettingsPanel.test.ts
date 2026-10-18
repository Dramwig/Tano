// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import SettingsPanel from './SettingsPanel.vue';
import { defaultCapabilities, defaultEditorPreferences } from '@tano/editor/runtime';
import type { EditorPreferences } from '@tano/editor/runtime';
import type { CapabilityPatch } from '../workspace-capabilities';
import type { SettingsPageContext } from '../runtime';
import { defaultWorkspaceSettings } from '../workspace-settings';
import type { WorkspaceSettingsPatch } from '../workspace-settings';
import type { ToolbarMode } from '../toolbar-preference';
import { helpPreferenceKey, readHelpPreferences, useHelpPreferences } from '../help-guidance';
import { setUiLocale } from '../i18n';
import { localePreferenceKey, readUiLocale } from '../locale';

vi.mock('./UpdatePanel.vue', () => ({
  default: { template: '<div class="update-panel-stub">应用更新</div>' },
}));

let app: App;
let root: HTMLDivElement;
let revealUpdates: boolean[];
let preferenceUpdates: EditorPreferences[];
const editorPreferences = ref<EditorPreferences>({ ...defaultEditorPreferences });
let capabilityUpdates: CapabilityPatch[];
let capabilities = ref(structuredClone(defaultCapabilities));
let revealMarkdown = ref(true);
let theme = ref<'light' | 'dark' | 'system'>('system');
let visualFontChoice = ref<'system' | 'serif' | 'mono' | 'custom'>('system');
let customFontName = ref('');
let showPageTitle = ref(true);
let showDocumentProperties = ref(true);
let outlineOnLeft = ref(false);
let workspaceSettings = ref({ ...defaultWorkspaceSettings });
let workspaceSettingUpdates: { workspaceId: string; patch: WorkspaceSettingsPatch }[];
let visualFontSize = ref(16);
let sourceFontSize = ref(14);
let toolbarMode = ref<ToolbarMode>('selection');
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
  setUiLocale('zh-CN');
  localStorage.removeItem(helpPreferenceKey);
  revealUpdates = [];
  preferenceUpdates = [];
  capabilityUpdates = [];
  capabilities = ref(structuredClone(defaultCapabilities));
  revealMarkdown = ref(true);
  editorPreferences.value = { ...defaultEditorPreferences };
  theme = ref('system');
  visualFontChoice = ref('system');
  customFontName = ref('');
  showPageTitle = ref(true);
  showDocumentProperties = ref(true);
  outlineOnLeft = ref(false);
  workspaceSettings = ref({ ...defaultWorkspaceSettings });
  workspaceSettingUpdates = [];
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
        workspaceSettings: workspaceSettings.value,
        'onWorkspace-setting': (workspaceId: string, patch: WorkspaceSettingsPatch) => {
          workspaceSettingUpdates.push({ workspaceId, patch });
          workspaceSettings.value = { ...workspaceSettings.value, [patch.key]: patch.value };
        },
        workspaceDeletionSupported: true,
        activeFile: hostFile.value,
        capabilities: capabilities.value,
        editorPreferences: editorPreferences.value,
        onCapability: (patch: CapabilityPatch) => capabilityUpdates.push(patch),
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
        showDocumentProperties: showDocumentProperties.value,
        showDocumentDiscussion: true,
        showOutline: true,
        outlineOnLeft: outlineOnLeft.value,
        visualFontSize: visualFontSize.value,
        sourceFontSize: sourceFontSize.value,
        historyEnabled: true,
        version: '1.2.3',
        initialPage: 'about',
        'onUpdate:revealMarkdown': (value: boolean) => revealUpdates.push(value),
        'onUpdate:toolbarMode': (value: ToolbarMode) => { toolbarMode.value = value; },
        'onUpdate:theme': (value: 'light' | 'dark' | 'system') => { theme.value = value; },
        'onUpdate:visualFontChoice': (value: 'system' | 'serif' | 'mono' | 'custom') => { visualFontChoice.value = value; },
        'onUpdate:customFontName': (value: string) => { customFontName.value = value; },
        'onUpdate:showPageTitle': (value: boolean) => { showPageTitle.value = value; },
        'onUpdate:showDocumentProperties': (value: boolean) => { showDocumentProperties.value = value; },
        'onUpdate:outlineOnLeft': (value: boolean) => { outlineOnLeft.value = value; },
        'onUpdate:editorPreferences': (value: EditorPreferences) => { preferenceUpdates.push(value); editorPreferences.value = value; },
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

it('moves shortcuts out of About into a searchable preference page', async () => {
  expect(root.querySelector('.shortcut-settings')).toBeNull();
  expect(root.querySelector('.settings-about')!.textContent).not.toContain('键盘快捷键');
  await openPage('快捷键');
  expect(root.querySelector('#settings-title')!.textContent).toBe('快捷键');
  expect(root.querySelector('.shortcut-settings')).not.toBeNull();
  expect(root.querySelector('[aria-label="设置立即保存快捷键"]')).not.toBeNull();
  const input = root.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!;
  input.value = '快捷键'; input.dispatchEvent(new Event('input')); await nextTick();
  expect([...root.querySelectorAll('.settings-nav-items button')].map(item => item.textContent?.trim())).toEqual(['快捷键']);
});

it('keeps the searchable usage hint switch in appearance settings and preserves hint history', async () => {
  const saved = { ...readHelpPreferences(), seen: ['graph'], count: 1, day: '2026-10-8', lastShown: 1000, snoozedUntil: 5000 };
  localStorage.setItem(helpPreferenceKey, JSON.stringify(saved));
  const input = root.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!;
  input.value = '使用提示'; input.dispatchEvent(new Event('input')); await nextTick();
  expect(root.querySelector('#settings-title')?.textContent).toBe('外观设置');
  const toggle = root.querySelector<HTMLButtonElement>('[aria-label="偶尔显示使用提示"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click(); await nextTick();
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(readHelpPreferences()).toEqual({ ...saved, enabled: false });
  toggle.click(); await nextTick();
  expect(readHelpPreferences()).toEqual({ ...saved, enabled: true });
});

it('reflects opt-out from a help bubble and preferences changed in another window', async () => {
  await openPage('外观设置');
  let preferences!: ReturnType<typeof useHelpPreferences>;
  const host = document.createElement('div'); document.body.append(host);
  const preferenceApp = createApp({ setup() { preferences = useHelpPreferences(); return () => null; } });
  preferenceApp.mount(host);
  try {
    const toggle = root.querySelector<HTMLButtonElement>('[aria-label="偶尔显示使用提示"]')!;
    preferences.setEnabled(false); await nextTick();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click(); await nextTick();
    expect(preferences.preferences.value.enabled).toBe(true);
    localStorage.setItem(helpPreferenceKey, JSON.stringify({ ...readHelpPreferences(), enabled: false }));
    window.dispatchEvent(new StorageEvent('storage', { key: helpPreferenceKey })); await nextTick();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  } finally { preferenceApp.unmount(); host.remove(); }
});

it('offers workspace bullet markers under Markdown output and disables them without write access', async () => {
  await openPage('文档能力');
  const select = root.querySelector<HTMLSelectElement>('section[aria-label="Markdown 输出"] select[aria-label="无序列表标记"]')!;
  expect(select.disabled).toBe(true);
  expect([...select.options].map(option => option.value)).toEqual(['-', '+', '*']);
  hostWorkspace.value = { id: 'local-workspace', name: '本地', path: 'C:/Notes' };
  capabilities.value.bulletListMarker = '-';
  await nextTick();
  expect(select.disabled).toBe(false);
  expect(select.value).toBe('-');
  select.value = '+';
  select.dispatchEvent(new Event('change'));
  expect(capabilityUpdates).toEqual([{ bulletListMarker: '+' }]);
  hostWorkspace.value = { ...hostWorkspace.value, readOnly: true };
  await nextTick();
  expect(select.disabled).toBe(true);
});
it('shows registration-only deletion in local workspace settings and omits it from the browser demo', async () => {
  hostWorkspace.value = { id: 'local-workspace', name: '本地', path: 'C:/Notes', canDelete: true };
  await openPage('工作区');
  expect(root.querySelector('.workspace-deletion-settings')?.textContent).toContain('本地仓库注册');
  workspaceMode.value = 'demo'; await nextTick();
  expect(root.querySelector('.workspace-deletion-settings')).toBeNull();
});

it('requires management access for shared document rules while keeping personal preferences available', async () => {
  workspaceMode.value = 'web';
  hostWorkspace.value = { id: 'online', name: '在线', path: '', readOnly: false, canManageSettings: false };
  await openPage('文档能力');
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="无序列表标记"]')!;
  expect(select.disabled).toBe(true);
  expect(root.textContent).toContain('只有工作区所有者和管理者');
  hostWorkspace.value = { ...hostWorkspace.value, canManageSettings: true }; await nextTick();
  expect(select.disabled).toBe(false);
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
  expect([...select.options].map(option => option.textContent)).toEqual(['随选区显示（默认）', '固定在顶部', '吸附在底部', '靠左停靠', '靠右停靠']);
  for (const mode of ['fixed', 'bottom', 'left', 'right', 'selection']) {
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
  const ai = root.querySelector<HTMLElement>('section[aria-label="AI 功能"]')!;
  expect(ai.textContent).toContain('空白块按空格启动 AI');
  expect(content.textContent).not.toContain('渲染数学公式');
  expect(content.textContent).not.toContain('同时显示公式源码');
  expect(content.querySelectorAll('[role="switch"]')).toHaveLength(2);
  const preview = content.querySelector<HTMLButtonElement>('[aria-label="编辑时预览公式"]')!;
  expect(preview.getAttribute('aria-checked')).toBe('true');
  preview.click();
  expect(preferenceUpdates).toEqual([{ previewMathWhileEditing: false, folding: true, blankBlockAiShortcut: true }]);
});

it.each(['页面内标题', '文档属性'])('keeps the %s preference in sync with its current value', async (label) => {
  await openPage('外观设置');
  const preference = label === '页面内标题' ? showPageTitle : showDocumentProperties;
  const toggle = root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click();
  await nextTick();
  expect(preference.value).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  preference.value = true;
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

it('saves the page title source for the current workspace independently of title visibility', async () => {
  await openPage('外观设置');
  expect(root.querySelector('[aria-label="页面标题来源"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="页面内标题"]')!.click();
  await nextTick();
  expect(showPageTitle.value).toBe(false);
  hostWorkspace.value = { id: 'local-workspace', name: '本地', path: 'C:/Notes' };
  await openPage('工作区');
  const select = root.querySelector<HTMLSelectElement>('[aria-label="页面标题来源"]')!;
  expect(select.value).toBe('frontmatter-first');
  expect([...select.options].map(option => option.textContent)).toEqual(['文件名', 'YAML title', 'YAML title 优先']);
  expect(select.disabled).toBe(false);
  select.value = 'frontmatter';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(workspaceSettings.value.pageTitleSource).toBe('frontmatter');
  select.value = 'filename';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(workspaceSettings.value.pageTitleSource).toBe('filename');
  expect(workspaceSettingUpdates).toEqual([
    { workspaceId: 'local-workspace', patch: { key: 'pageTitleSource', value: 'frontmatter', previous: 'frontmatter-first' } },
    { workspaceId: 'local-workspace', patch: { key: 'pageTitleSource', value: 'filename', previous: 'frontmatter' } },
  ]);
});

it.each(['标题来源', 'YAML title', '文件名'])('finds the workspace title setting when searching for %s', async (query) => {
  const input = root.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!;
  input.value = query; input.dispatchEvent(new Event('input')); await nextTick();
  expect([...root.querySelectorAll('.settings-nav-items button')].map(item => item.textContent?.trim())).toEqual(['工作区']);
  expect(root.querySelector('[aria-label="页面标题来源"]')).not.toBeNull();
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
  setUiLocale('zh-CN');
  localStorage.removeItem(localePreferenceKey);
});

it('opens directly on the complete about page', () => {
  expect(root.querySelector('h2')?.textContent).toBe('关于同页');
  expect(root.querySelector('.settings-about-brand')?.textContent).toContain('Tano / 同页');
  expect(root.querySelector('.settings-version-pill')?.textContent).toBe('1.2.3');
  expect(root.textContent).toContain('Humans and agents, on the same page.');
  expect(root.textContent).toContain('这是你的本地 Markdown 工作台');
  expect(root.querySelector('.shortcut-settings')).toBeNull();
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

it('configures individual selection wrappers and disables them with the master switch', async () => {
  await openPage('编辑设置');
  const control = (label: string) => root.querySelector<HTMLButtonElement>('[role="switch"][aria-label="' + label + '"]')!;
  expect(control('输入符号包裹选区').getAttribute('aria-checked')).toBe('true');
  expect(control('高亮').getAttribute('aria-checked')).toBe('true');
  expect(control('上标（扩展）').getAttribute('aria-checked')).toBe('false');
  expect(control('中文 ￥ 映射为 $').getAttribute('aria-checked')).toBe('false');
  control('中文 ￥ 映射为 $').click();
  await nextTick();
  expect(editorPreferences.value.selectionWrapping?.yenToDollar).toBe(true);
  control('上标（扩展）').click();
  await nextTick();
  expect(editorPreferences.value.selectionWrapping?.superscript).toBe(true);
  control('高亮').click();
  await nextTick();
  expect(editorPreferences.value.selectionWrapping?.highlight).toBe(false);
  control('输入符号包裹选区').click();
  await nextTick();
  expect(control('上标（扩展）').disabled).toBe(true);
  expect(editorPreferences.value.selectionWrapping?.enabled).toBe(false);
  control('输入符号包裹选区').click();
  await nextTick();
  expect(control('上标（扩展）').getAttribute('aria-checked')).toBe('true');
  expect(control('高亮').getAttribute('aria-checked')).toBe('false');
});

it('switches open pages immediately, keeps workspace content and searches English settings', async () => {
  hostWorkspace.value = { id: 'test', name: '主题', path: '/notes' };
  await openPage('外观设置');
  const language = root.querySelector<HTMLSelectElement>('select[aria-label="界面语言"]')!;
  language.value = 'en-US';
  language.dispatchEvent(new Event('change'));
  await nextTick();
  expect(readUiLocale()).toBe('en-US');
  expect(document.documentElement.lang).toBe('en-US');
  expect(root.querySelector('h2')?.textContent).toBe('Appearance');
  expect(root.querySelector('select[aria-label="Theme"]')).not.toBeNull();
  expect(root.querySelector('.settings-nav-foot')?.textContent).toContain('主题');
  await openPage('Keyboard shortcuts');
  expect(root.querySelectorAll('.shortcut-settings-row')).toHaveLength(14);
  expect(root.textContent).toContain('Save now');
  await openPage('Document capabilities');
  expect(root.textContent).toContain('Math formulas');
  const search = root.querySelector<HTMLInputElement>('[aria-label="Search settings"]')!;
  search.value = 'language';
  search.dispatchEvent(new Event('input'));
  await nextTick();
  expect(root.querySelector('h2')?.textContent).toBe('Appearance');
  search.value = '';
  search.dispatchEvent(new Event('input'));
  await nextTick();
  const englishLanguage = root.querySelector<HTMLSelectElement>('select[aria-label="Language"]')!;
  englishLanguage.value = 'zh-CN';
  englishLanguage.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelector('h2')?.textContent).toBe('外观设置');
  expect(root.querySelector('select[aria-label="主题"]')).not.toBeNull();
});
