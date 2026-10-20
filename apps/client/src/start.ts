import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { initializeLocaleSync, t, uiLocale } from '@tano/workbench/i18n';
import { watchEffect } from 'vue';
import { configureWorkbench, createLocalExtensions } from '@tano/workbench/runtime';
import { NativeAdapter, native } from '@tano/workbench/adapter';
import { markdownDemoLocaleFromPath } from '@tano/workbench/markdown-demo-routes';
import { initializePlatform, mobile } from '@tano/workbench/platform';
import '@tano/workbench/styles.css';
import { settingsWindowRequest } from '@tano/workbench/settings-window';
import { HttpPluginCatalog } from '@tano/workbench/plugins/catalog';
import { createNativePluginConnections, createNativePluginServices } from '@tano/workbench/plugins/native';
import { getCurrentWindow } from '@tauri-apps/api/window';

export async function start(signal?: AbortSignal) {
  await initializeLocaleSync(native);
  const settingsRoute = native && !!settingsWindowRequest();
  await initializePlatform();
  signal?.throwIfAborted();
  const windowLabel = native && !mobile ? getCurrentWindow().label : '';
  const standalone = windowLabel.startsWith('file-');
  const [view, desktopFrame, storage] = await Promise.all([
    settingsRoute
      ? import('@tano/workbench/components/SettingsWindow.vue')
      : standalone ? import('./StandaloneFile.vue')
      : windowLabel === 'main' ? import('./WorkspaceShell.vue') : import('@tano/workbench'),
    native && !settingsRoute
      ? import('@tano/workbench/components/DesktopWindow.vue')
      : null,
    native
      ? { adapter: new NativeAdapter() }
      : import('@tano/workbench/markdown-demo').then(({ createMarkdownDemo }) =>
        createMarkdownDemo(markdownDemoLocaleFromPath(window.location.pathname) ?? 'zh-cn')),
  ]);
  // A timed-out startup must not replace the recovery UI when imports finish late.
  signal?.throwIfAborted();
  const locale = markdownDemoLocaleFromPath(window.location.pathname) ?? 'zh-cn';
  const extensions = createLocalExtensions();
  const catalogUrl = import.meta.env.VITE_TANO_PLUGIN_CATALOG_URL?.trim();
  const plugins = { ...(catalogUrl ? { catalog: new HttpPluginCatalog(catalogUrl) } : {}),
    ...(native && !mobile ? { native: createNativePluginServices(), connections: createNativePluginConnections() } : {}) };
  const pinia = configureWorkbench(createPinia(), { ...storage, native, mobile, plugins, extensions: () => extensions });
  watchEffect(() => {
    document.documentElement.lang = uiLocale.value;
    document.title = native
      ? t('Tano / 同页 — 本地工作区')
      : locale === 'en-us' ? 'Tano — English Markdown demo' : 'Tano / 同页 — 中文 Markdown 演示';
  });
  const app = native && !mobile && !settingsRoute
    ? createApp(desktopFrame!.default, { view: view.default })
    : createApp(view.default);
  app.use(pinia).mount('#app');
  await nextTick();
}
