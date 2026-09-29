import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { configureWorkbench } from '@tano/workbench/runtime';
import { NativeAdapter, DemoAdapter, native } from '@tano/workbench/adapter';
import { initializePlatform, mobile } from '@tano/workbench/platform';
import { applyTheme, readThemePreference } from '@tano/workbench/theme';
import '@tano/workbench/styles.css';
import { settingsWindowRequest } from '@tano/workbench/settings-window';
applyTheme(readThemePreference());
async function start() {
  const settingsRoute = native && !!settingsWindowRequest();
  const view = settingsRoute
    ? import('@tano/workbench/components/SettingsWindow.vue')
    : import('@tano/workbench');
  const desktopFrame = native && !settingsRoute
    ? import('@tano/workbench/components/DesktopWindow.vue')
    : null;
  await initializePlatform();
  const pinia = configureWorkbench(createPinia(), { adapter: native ? new NativeAdapter() : new DemoAdapter(), native, mobile });
  document.title = native ? 'Tano / 同页 — 本地工作区' : 'Tano / 同页 — 浏览器演示';
  const content = (await view).default;
  const app = native && !mobile && !settingsRoute
    ? createApp((await desktopFrame!).default, { view: content })
    : createApp(content);
  app.use(pinia).mount('#app');
}
void start().catch(error => { const root = document.getElementById('app'); if(root) root.textContent = '无法初始化 Tano：' + String(error); });
