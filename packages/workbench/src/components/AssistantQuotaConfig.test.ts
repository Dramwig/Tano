// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import AssistantQuotaConfig from './AssistantQuotaConfig.vue';
const saveQuota = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../assistant/store', () => ({ useAssistantStore: () => ({ saveQuota }) }));
let dispose = () => {};
afterEach(() => { dispose(); vi.clearAllMocks(); });
it('offers templates, saves independent credentials and never modifies the connection', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const connection = { id: 'connection', name: '中转站', endpoint: 'https://example.com/v1', hasKey: true, tools: true, maxOutputTokens: 4096 };
  const app = createApp(() => h(AssistantQuotaConfig, { connection })); app.mount(root);
  dispose = () => { app.unmount(); root.remove(); };
  root.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); await nextTick();
  const template = [...root.querySelectorAll<HTMLButtonElement>('.quota-templates button')].find(b => b.textContent === 'NewAPI')!;
  template.click(); await nextTick();
  expect(root.textContent).toContain('用户 ID');
  const secret = root.querySelector<HTMLInputElement>('input[type="password"]')!;
  secret.value = 'query-only-secret'; secret.dispatchEvent(new Event('input'));
  const user = root.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
  user.value = '123'; user.dispatchEvent(new Event('input')); await nextTick();
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(saveQuota).toHaveBeenCalledWith('connection', expect.objectContaining({ mode: 'newapi', userId: '123' }), 'query-only-secret'));
  await nextTick(); expect(secret.value).toBe('');
  expect(connection.endpoint).toBe('https://example.com/v1');
});
