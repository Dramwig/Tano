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

// Keep the entry dependency-free so even a failed module import has a visible recovery path.
void import('./start').then(({ start }) => start()).catch(error => {
  console.error('无法初始化 Tano', error);
  startup.setAttribute('aria-busy', 'false');
  status.textContent = '无法打开同页';
  detail.textContent = error instanceof Error ? error.message : String(error);
  detail.hidden = false;
  retry.hidden = false;
  root.replaceChildren(startup);
}).finally(() => window.clearTimeout(slowStartup));

export {};
