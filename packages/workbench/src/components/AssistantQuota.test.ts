// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import AssistantQuota from './AssistantQuota.vue';
import { setUiLocale } from '../i18n';
const queryQuota = vi.hoisted(() => vi.fn());
const connectionQuotaResults = vi.hoisted(() => ({}));
vi.mock('../assistant/store', () => ({ useAssistantStore: () => ({ queryQuota, connectionQuotaResults }) }));
let dispose = () => {};
afterEach(async () => { dispose(); vi.resetAllMocks(); await setUiLocale('zh-CN'); });
it('queries official quota on demand, preserves last result on failure and never fabricates zero', async () => {
  const root = document.createElement('div');
  const request = ref(0);
  const render = () => h(AssistantQuota, { request: request.value, connection: { id: 'codex', name: 'Codex', kind: 'codex-cli', endpoint: '', tools: true, maxOutputTokens: 4096, hasKey: false } });
  const app = createApp(render);
  app.mount(root); dispose = () => app.unmount();
  expect(queryQuota).not.toHaveBeenCalled();
  queryQuota.mockResolvedValueOnce({ checkedAt: Date.now(), items: [{ label: '5 小时', remaining: 75, used: 25, total: 100, unit: '%' }] });
  expect(root.querySelector('button')).toBeNull();
  request.value++; await nextTick(); await nextTick(); await nextTick();
  expect(root.querySelector('.connection-status-summary')?.textContent).toContain('剩余 75%');
  const trigger = root.querySelector<HTMLButtonElement>('.connection-status-summary')!;
  trigger.dispatchEvent(new FocusEvent('focus'));
  await nextTick();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  trigger.dispatchEvent(escape);
  await nextTick();
  expect(escape.defaultPrevented).toBe(true);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  queryQuota.mockRejectedValueOnce(new Error('HTTP 401'));
  request.value++; await nextTick(); await nextTick(); await nextTick();
  expect(root.textContent).toContain('HTTP 401');
  expect(root.textContent).toContain('保留上次结果');
  expect(root.querySelector('.connection-status-summary')?.textContent).toContain('剩余 75%');
  app.unmount();
  const reopened = createApp(render); reopened.mount(root); dispose = () => reopened.unmount();
  expect(root.querySelector('.connection-status-summary')?.textContent).toContain('剩余 75%');
  expect(queryQuota).toHaveBeenCalledTimes(2);

});

it('switches quota labels and number/date formatting with the UI locale', async () => {
  await setUiLocale('en-US');
  const root = document.createElement('div');
  const request = ref(0);
  const checkedAt = new Date('2026-11-09T02:00:00Z').getTime();
  queryQuota.mockResolvedValueOnce({ checkedAt, items: [{ label: 'Provider label', remaining: 1234.5, total: 2000, unit: 'USD' }] });
  const app = createApp(() => h(AssistantQuota, { request: request.value,
    connection: { id: 'localized-quota', name: 'Codex', kind: 'codex-cli', endpoint: '', tools: true, maxOutputTokens: 4096, hasKey: false } }));
  app.mount(root); dispose = () => app.unmount();
  request.value++;
  await vi.waitFor(() => expect(root.textContent).toContain('Remaining'));
  expect(root.textContent).toContain('1,234.5');
  await setUiLocale('de-DE'); await nextTick();
  expect(root.textContent).toContain('Verbleibend');
  expect(root.textContent).toContain('1.234,5');
  expect(root.textContent).toContain(new Date(checkedAt).toLocaleString('de-DE'));
  expect(root.textContent).toContain('Provider label');
});
