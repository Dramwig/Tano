import type { UiLocale } from './locale';

// Keep startup recovery independent of Vue and the full workbench catalogs.
const startupMessages = {
  'zh-CN': { opening: '正在打开同页...', loading: '正在加载工作台，首次启动可能需要一些时间', retry: '重新加载', failure: '无法打开同页', timeout: '打开同页超时，工作台加载已超过 30 秒，请重新加载。' },
  'en-US': { opening: 'Opening Tano...', loading: 'Loading the workbench. The first launch may take a moment.', retry: 'Reload', failure: 'Unable to open Tano', timeout: 'Opening Tano timed out after 30 seconds. Please reload.' },
  'zh-TW': { opening: '正在開啟同頁...', loading: '正在載入工作臺，首次啟動可能需要一些時間', retry: '重新載入', failure: '無法開啟同頁', timeout: '開啟同頁已超過 30 秒，請重新載入。' },
  'ja-JP': { opening: 'Tano を開いています...', loading: 'ワークスペースを読み込んでいます。初回起動には時間がかかることがあります。', retry: '再読み込み', failure: 'Tano を開けませんでした', timeout: 'Tano の起動が 30 秒でタイムアウトしました。再読み込みしてください。' },
  'es-ES': { opening: 'Abriendo Tano...', loading: 'Cargando el espacio de trabajo. El primer inicio puede tardar un momento.', retry: 'Recargar', failure: 'No se pudo abrir Tano', timeout: 'Tano no se ha abierto en 30 segundos. Recarga la página.' },
  'de-DE': { opening: 'Tano wird geöffnet...', loading: 'Der Arbeitsbereich wird geladen. Der erste Start kann einen Moment dauern.', retry: 'Neu laden', failure: 'Tano konnte nicht geöffnet werden', timeout: 'Tano konnte innerhalb von 30 Sekunden nicht geöffnet werden. Bitte neu laden.' },
} satisfies Record<UiLocale, Record<'opening' | 'loading' | 'retry' | 'failure' | 'timeout', string>>;

export function startupCopy(locale: UiLocale) { return startupMessages[locale]; }
