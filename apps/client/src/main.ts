import { applyTheme, readThemePreference } from '@tano/workbench/theme';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { startupPaint } from './startup-paint';

// Resolve the saved theme before loading Vue or any workbench dependencies.
applyTheme(readThemePreference());

const root = document.getElementById('app')!;
const startup = document.getElementById('tano-startup')!;
const status = document.getElementById('tano-startup-status')!;
const detail = document.getElementById('tano-startup-detail')!;
const retry = document.getElementById('tano-startup-retry')!;

retry.addEventListener('click', () => window.location.reload());
const slowStartup = window.setTimeout(() => {
  status.textContent = '正在加载工作台，首次启动可能需要一些时间';
  retry.hidden = false;
}, 15_000);

async function boot() {
  const native = isTauri();
  const controller = new AbortController();
  async function initialize() {
    // A hidden WebView can suspend rAF. Native startup must not wait for a
    // frame or reveal an empty window while Vite is still loading modules.
    if (!native) await startupPaint();
    const { start } = await import('./start');
    controller.signal.throwIfAborted();
    await start(controller.signal);
  }
  let timeout: number | undefined;
  try {
    if (native) {
      await Promise.race([
        initialize(),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => {
            const error = new Error('打开同页超时，工作台加载已超过 30 秒，请重新加载。');
            controller.abort(error);
            reject(error);
          }, 30_000);
        }),
      ]);
      // start() resolves after Vue has mounted and flushed its DOM updates.
      await invoke('startup_ready');
    } else await initialize();
  } finally {
    window.clearTimeout(timeout);
  }
}

// Keep heavy dependencies behind this boundary so import failures have a recovery path.
void boot().catch(async error => {
  console.error('无法初始化 Tano', error);
  startup.setAttribute('aria-busy', 'false');
  status.textContent = '无法打开同页';
  detail.textContent = error instanceof Error ? error.message : String(error);
  detail.hidden = false;
  retry.hidden = false;
  root.replaceChildren(startup);
  if (isTauri()) {
    try {
      await invoke('startup_ready');
    } catch {
      // Keep recovery reachable if the host's reveal command itself failed.
      await import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        if (appWindow.label === 'main') await appWindow.show();
      }).catch(error => console.error('无法显示启动恢复界面', error));
    }
  }
}).finally(() => window.clearTimeout(slowStartup));

export {};
