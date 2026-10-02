import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { configureWorkbench } from '@tano/workbench/runtime';
import { NativeAdapter, DemoAdapter, native } from '@tano/workbench/adapter';
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
  const pinia = configureWorkbench(createPinia(), { adapter: native ? new NativeAdapter() : new DemoAdapter(), native, mobile });
  document.title = native ? 'Tano / 同页 — 本地工作区' : 'Tano / 同页 — 浏览器演示';
  const app = native && !mobile && !settingsRoute
    ? createApp(desktopFrame!.default, { view: view.default })
    : createApp(view.default);
  app.use(pinia).mount('#app');
}
