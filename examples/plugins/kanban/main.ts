import type { PluginJson, TanoPluginApi } from '@tano/workbench/plugin-sdk';

export default async function activate(tano: TanoPluginApi) {
  const lanes = ['todo', 'doing', 'done'];
  async function refresh() {
    const tasks = await tano.objects.query({ type: 'event', archived: false, properties: { checkable: true }, limit: 100, sort: 'name' });
    await tano.views.renderCustom('board', { total: tasks.total ?? tasks.items.length, cards: tasks.items.map(({ object }) => ({ id: object.id, title: object.name,
      lane: object.properties.completed === true ? 'done' : object.properties.kanbanLane === 'doing' ? 'doing' : 'todo' })) });
  }
  let queue = Promise.resolve();
  const enqueue = (run: () => Promise<void>) => { const next = queue.then(run); queue = next.catch(() => {}); return next; };
  tano.views.onMessage('board', (message: PluginJson) => enqueue(async () => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('看板消息无效');
    if (message.type === 'create') {
      if (typeof message.title !== 'string' || !message.title.trim() || message.title.length > 200) throw new Error('请输入 1–200 字的任务名称');
      await tano.objects.create({ type: 'event', name: message.title.trim(), description: '', archived: false, properties: { checkable: true, completed: false } });
    } else if (message.type === 'move') {
      if (typeof message.id !== 'string' || typeof message.lane !== 'string' || !lanes.includes(message.lane)) throw new Error('移动目标无效');
      const { object, hash } = await tano.objects.read(message.id);
      if (object.type !== 'event' || object.properties.checkable !== true || object.archived) throw new Error('任务已不可用');
      await tano.objects.update({ ...object, properties: { ...object.properties, completed: message.lane === 'done', kanbanLane: message.lane } }, hash);
    } else if (message.type !== 'refresh') throw new Error('不支持此看板操作');
    await refresh();
  }));
  tano.events.subscribe(() => enqueue(refresh), { types: ['objects.changed'] });
  await tano.commands.register('open', async () => { await enqueue(refresh); await tano.views.open('board'); });
  await enqueue(refresh);
}
