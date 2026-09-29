import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Workbench from '@tano/workbench';
import DesktopWindow from '@tano/workbench/components/DesktopWindow.vue';
import { configureWorkbench } from '@tano/workbench/runtime';
import { NativeAdapter, DemoAdapter, native } from '@tano/workbench/adapter';
import { initializePlatform, mobile } from '@tano/workbench/platform';
import { applyTheme, readThemePreference } from '@tano/workbench/theme';
import '@tano/workbench/styles.css';
applyTheme(readThemePreference());
async function start() {
  await initializePlatform();
  const pinia = configureWorkbench(createPinia(), { adapter: native ? new NativeAdapter() : new DemoAdapter(), native, mobile });
  document.title = native ? 'Tano / 同页 — 本地工作区' : 'Tano / 同页 — 浏览器演示';
  const app = native && !mobile ? createApp(DesktopWindow, {view: Workbench}) : createApp(Workbench);
  app.use(pinia).mount('#app');
}
void start().catch(error => { const root = document.getElementById('app'); if(root) root.textContent = '无法初始化 Tano：' + String(error); });
