// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { AssistantMessage, AssistantSession } from '@tano/protocol';
import AssistantUsage from './AssistantUsage.vue';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function message(id: string, usage?: { input: number; output: number }, age = 0): AssistantMessage {
  const date = new Date(); date.setDate(date.getDate() - age);
  return { id, role: 'assistant', content: '', createdAt: date.getTime(), model: 'model-a', state: 'completed', usage };
}
function session(messages: AssistantMessage[]): AssistantSession {
  return { id: 'session-1', version: 1, workspaceId: 'workspace', revision: 1, title: '测试会话', createdAt: 0, updatedAt: 0, messages };
}
function mount(sessions: AssistantSession[], activeSession?: AssistantSession) {
  const props = reactive({ sessions, activeSession });
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantUsage, props)); app.mount(root);
  return props;
}
it('deduplicates the active session and excludes user messages and out-of-range records', () => {
  mount([session([message('old', { input: 999, output: 999 })])], session([
    message('new', { input: 120, output: 30 }), message('unknown'), message('old', { input: 900, output: 90 }, 8),
    { ...message('user'), role: 'user' },
  ]));
  expect([...root.querySelectorAll('.usage-metrics strong')].map(node => node.textContent)).toEqual(['2', '120', '30', '150']);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(root.querySelector('tbody')!.textContent).toContain('未报告');
});
it('filters the chart and details together and resets pagination', async () => {
  mount([session([...Array.from({ length: 12 }, (_, index) => message(String(index), { input: 10, output: 5 })),
    { ...message('older', { input: 200, output: 100 }, 10), model: 'model-b' }])]);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(10);
  const buttons = () => [...root.querySelectorAll('button')];
  buttons().find(button => button.textContent === '下一页')!.click(); await nextTick();
  expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
  const selects = [root.querySelector<HTMLSelectElement>('[aria-label="筛选模型"]')!];
  buttons().find(button => button.textContent === '近 30 天')!.click(); await nextTick();
  expect(root.querySelectorAll('.usage-day')).toHaveLength(30);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(10);
  selects[0].value = 'model-b'; selects[0].dispatchEvent(new Event('change')); await nextTick();
  expect([...root.querySelectorAll('.usage-metrics strong')].map(node => node.textContent)).toEqual(['1', '200', '100', '300']);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
});
it('shows missing usage distinctly from a reported zero and reacts to session deletion', async () => {
  const props = mount([session([message('unknown')])]);
  expect(root.querySelectorAll('.usage-metrics strong')[3].textContent).toBe('—');
  props.sessions[0].messages[0].usage = { input: 0, output: 0 }; await nextTick();
  expect(root.querySelectorAll('.usage-metrics strong')[3].textContent).toBe('0');
  props.sessions = []; await nextTick();
  expect(root.querySelector('tbody')!.textContent).toContain('所选范围暂无使用记录');
});

it('filters by recorded connection without attributing historical replies to the current session connection', async () => {
  const saved = session([
    { ...message('a', { input: 10, output: 5 }), connectionId: 'api', connectionName: 'API 渠道' },
    { ...message('b', { input: 30, output: 15 }), connectionId: 'cli', connectionName: 'CLI 渠道', model: 'model-b' },
    message('legacy', { input: 100, output: 50 }),
  ]);
  saved.connectionId = 'cli';
  mount([saved]);
  const channel = root.querySelector<HTMLSelectElement>('[aria-label="筛选连接渠道"]')!;
  const model = root.querySelector<HTMLSelectElement>('[aria-label="筛选模型"]')!;
  model.value = 'model-a'; model.dispatchEvent(new Event('change')); await nextTick();
  channel.value = 'cli'; channel.dispatchEvent(new Event('change')); await nextTick();
  expect(model.value).toBe('');
  expect([...root.querySelectorAll('.usage-metrics strong')].map(node => node.textContent)).toEqual(['1', '30', '15', '45']);
  expect(root.querySelector('tbody')!.textContent).toContain('CLI 渠道');
  channel.value = '__unrecorded__'; channel.dispatchEvent(new Event('change')); await nextTick();
  expect([...root.querySelectorAll('.usage-metrics strong')].map(node => node.textContent)).toEqual(['1', '100', '50', '150']);
  expect(root.querySelector('tbody')!.textContent).toContain('未记录渠道');
});
