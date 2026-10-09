import type { TanoPluginApi } from '@tano/workbench/plugin-sdk';
import { emptySummary, summarize, type Filters } from './model';

export default async function activate(tano: TanoPluginApi) {
  let filters: Filters = { query: '', includeArchived: false }, requested = 0;
  let running: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    requested++;
    return running ??= (async () => {
      let completed = -1;
      while (completed !== requested) {
        const ticket = requested, current = { ...filters };
        await tano.views.renderCustom('dashboard', { ...emptySummary(), ...current, loading: true, error: '' });
        try {
          const summary = await summarize(tano, current);
          if (ticket === requested) await tano.views.renderCustom('dashboard', { ...summary, ...current, loading: false, error: '' });
        } catch (error) {
          if (ticket === requested) await tano.views.renderCustom('dashboard', { ...emptySummary(), ...current, loading: false,
            error: error instanceof Error ? error.message : '无法读取任务，请刷新重试。' });
        }
        completed = ticket;
      }
    })().finally(() => { running = undefined; });
  };
  tano.views.onMessage('dashboard', async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('统计请求无效');
    if (message.type === 'filter') {
      if (typeof message.query !== 'string' || message.query.length > 200 || typeof message.includeArchived !== 'boolean') throw new Error('筛选条件无效');
      filters = { query: message.query.trim(), includeArchived: message.includeArchived };
    } else if (message.type !== 'refresh') throw new Error('不支持此统计操作');
    clearTimeout(timer); await refresh();
  });
  tano.events.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh().catch(() => {}); }, 250);
  }, { types: ['objects.changed'] });
  await tano.commands.register('open', async () => { await refresh(); await tano.views.open('dashboard'); });
  await refresh();
}
