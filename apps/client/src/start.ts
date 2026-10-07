import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { configureWorkbench, createLocalExtensions } from '@tano/workbench/runtime';
import { NativeAdapter, native } from '@tano/workbench/adapter';
import { createMarkdownDemo } from '@tano/workbench/markdown-demo';
import { markdownDemoLocaleFromPath } from '@tano/workbench/markdown-demo-routes';
import { initializePlatform, mobile } from '@tano/workbench/platform';
import { applyTheme, readThemePreference } from '@tano/workbench/theme';
import '@tano/workbench/styles.css';
import { settingsWindowRequest } from '@tano/workbench/settings-window';

export async function start() {
  applyTheme(readThemePreference());
  const settingsRoute = native && !!settingsWindowRequest();
  const [view, desktopFrame] = await Promise.all([
    settingsRoute
      ? import('@tano/workbench/components/SettingsWindow.vue')
      : import('@tano/workbench'),
    native && !settingsRoute
      ? import('@tano/workbench/components/DesktopWindow.vue')
      : null,
    initializePlatform(),
  ]);
  const locale = markdownDemoLocaleFromPath(window.location.pathname) ?? 'zh-cn';
  const extensions = createLocalExtensions();
  const storage = native ? { adapter: new NativeAdapter() } : createMarkdownDemo(locale);
  const pinia = configureWorkbench(createPinia(), { ...storage, native, mobile, extensions: () => extensions });
  document.documentElement.lang = !native && locale === 'en-us' ? 'en-US' : 'zh-CN';
  document.title = native ? 'Tano / 同页 — 本地工作区' : locale === 'en-us' ? 'Tano — English Markdown demo' : 'Tano / 同页 — 中文 Markdown 演示';
  const app = native && !mobile && !settingsRoute
    ? createApp(desktopFrame!.default, { view: view.default })
    : createApp(view.default);
  app.use(pinia).mount('#app');
}
