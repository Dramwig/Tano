import { uiLocale } from '../i18n';

export function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (uiLocale.value !== 'zh-CN') {
    const format = new Intl.RelativeTimeFormat(uiLocale.value, { numeric: 'auto' });
    if (minutes < 1) return format.format(0, 'second');
    if (minutes < 60) return format.format(-minutes, 'minute');
    if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour');
    return new Date(timestamp).toLocaleDateString(uiLocale.value);
  }
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}
