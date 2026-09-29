// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import SettingsPanel from './SettingsPanel.vue';
import type { EditorPreferences } from '@tano/editor/runtime';

vi.mock('./UpdatePanel.vue', () => ({
  default: { template: '<div class="update-panel-stub">应用更新</div>' },
}));

let app: App;
let root: HTMLDivElement;
let revealUpdates: boolean[];
let preferenceUpdates: EditorPreferences[];
let revealMarkdown = ref(true);
let theme = ref<'light' | 'dark' | 'system'>('system');
let visualFontChoice = ref<'system' | 'serif' | 'custom'>('system');
let customFontName = ref('');
let showPageTitle = ref(true);
let visualFontSize = ref(16);
let sourceFontSize = ref(14);

beforeEach(() => {
  revealUpdates = [];
  preferenceUpdates = [];
  revealMarkdown = ref(true);
  theme = ref('system');
  visualFontChoice = ref('system');
  customFontName = ref('');
  showPageTitle = ref(true);
  visualFontSize = ref(16);
  sourceFontSize = ref(14);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(
    defineComponent(() => () =>
      h(SettingsPanel, {
        workspace: null,
        mode: 'local',
        native: true,
        mobile: false,
        defaultSource: false,
        theme: theme.value,
        visualFontChoice: visualFontChoice.value,
        customFontName: customFontName.value,
        revealMarkdown: revealMarkdown.value,
        showPageTitle: showPageTitle.value,
        visualFontSize: visualFontSize.value,
        sourceFontSize: sourceFontSize.value,
        historyEnabled: true,
        version: '1.2.3',
        initialPage: 'about',
        'onUpdate:revealMarkdown': (value: boolean) => revealUpdates.push(value),
        'onUpdate:theme': (value: 'light' | 'dark' | 'system') => { theme.value = value; },
        'onUpdate:visualFontChoice': (value: 'system' | 'serif' | 'custom') => { visualFontChoice.value = value; },
        'onUpdate:customFontName': (value: string) => { customFontName.value = value; },
        'onUpdate:showPageTitle': (value: boolean) => { showPageTitle.value = value; },
        'onUpdate:editorPreferences': (value: EditorPreferences) => preferenceUpdates.push(value),
        'onUpdate:visualFontSize': (value: number) => { visualFontSize.value = value; },
        'onUpdate:sourceFontSize': (value: number) => { sourceFontSize.value = value; },
      }),
    ),
  );
  app.mount(root);
});

it('shows the Markdown reveal switch enabled and emits a change', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  const toggle = root.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  toggle.click();
  expect(revealUpdates).toEqual([false]);
});

it('offers light, dark, and system themes', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="主题"]')!;
  expect([...select.options].map(({ textContent }) => textContent)).toEqual(['白天', '黑夜', '跟随系统']);
  expect(select.value).toBe('system');
  select.value = 'dark';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(theme.value).toBe('dark');
  expect(select.value).toBe('dark');
});

it('offers system, serif, and a custom local font with a live preview', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="可视化编辑字体"]')!;
  expect([...select.options].map(({ textContent }) => textContent)).toEqual([
    '系统字体', '衬线字体', '自定义字体',
  ]);
  select.value = 'serif';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(visualFontChoice.value).toBe('serif');
  expect(root.querySelector<HTMLElement>('.settings-font-preview')?.style.fontFamily).toContain('Georgia');
  select.value = 'custom';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  const input = root.querySelector<HTMLInputElement>('[aria-label="自定义字体名称"]')!;
  input.value = '霞鹜文楷';
  input.dispatchEvent(new Event('input'));
  await nextTick();
  expect(customFontName.value).toBe('霞鹜文楷');
  expect(root.querySelector<HTMLElement>('.settings-font-preview')?.style.fontFamily).toContain('霞鹜文楷');
});

it('shows the formula preview setting and emits its change', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  const content = root.querySelector<HTMLElement>('section[aria-label="内容显示"]')!;
  expect(content.textContent).toContain('编辑时预览公式');
  expect(content.textContent).toContain('标题与列表折叠');
  expect(content.textContent).not.toContain('渲染数学公式');
  expect(content.textContent).not.toContain('同时显示公式源码');
  expect(content.querySelectorAll('[role="switch"]')).toHaveLength(3);
  const preview = content.querySelector<HTMLButtonElement>('[aria-label="编辑时预览公式"]')!;
  expect(preview.getAttribute('aria-checked')).toBe('true');
  preview.click();
  expect(preferenceUpdates).toEqual([{ previewMathWhileEditing: false, folding: true }]);
});

it('keeps the page title preference in sync with its current value', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
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

it('adjusts each editor font size independently and restores its default', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="增大可视化编辑字号"]')!.click();
  await nextTick();
  expect(visualFontSize.value).toBe(17);
  expect(sourceFontSize.value).toBe(14);
  expect(root.querySelector('output[aria-label="可视化编辑字号"]')?.textContent).toBe('17 px');
  const visualReset = root.querySelectorAll<HTMLButtonElement>('.settings-font-reset')[0]!;
  visualReset.click();
  await nextTick();
  expect(visualFontSize.value).toBe(16);
  expect(visualReset.disabled).toBe(true);
  root.querySelector<HTMLButtonElement>('[aria-label="减小 Markdown 源码字号"]')!.click();
  await nextTick();
  expect(sourceFontSize.value).toBe(13);
  expect(visualFontSize.value).toBe(16);
});

it('disables formula preview when Markdown reveal is off and restores its saved choice', async () => {
  root.querySelectorAll<HTMLButtonElement>('.settings-nav button')[0]!.click();
  await nextTick();
  const content = root.querySelector<HTMLElement>('section[aria-label="内容显示"]')!;
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
  expect(root.textContent).toContain('收起或展开侧栏 Ctrl B');
  expect(root.textContent).toContain('查找文档 Ctrl K');
  expect(root.textContent).not.toContain('版本与更新');
  expect(root.textContent).not.toContain('备份恢复与 Agent 工作流');
  expect(root.querySelector('.settings-brand-actions .update-panel-stub')).not.toBeNull();
});

it('keeps the about content inside settings navigation', async () => {
  const preferences = [...root.querySelectorAll<HTMLButtonElement>('.settings-nav button')].find(
    (button) => button.textContent?.includes('偏好设置'),
  );
  preferences?.click();
  await nextTick();
  expect(root.querySelector('h2')?.textContent).toBe('偏好设置');

  const about = [...root.querySelectorAll<HTMLButtonElement>('.settings-nav button')].find(
    (button) => button.textContent?.includes('关于同页'),
  );
  about?.click();
  await nextTick();
  expect(root.querySelector('h2')?.textContent).toBe('关于同页');
  expect(root.querySelector('.settings-about-brand')).not.toBeNull();
});
