// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { connectionIcon, connectionIconOptions } from '../assistant/connection-icons';
import AssistantConnectionAvatar from './AssistantConnectionAvatar.vue';

it('uses bundled providers, explicit overrides and safe origin-only favicon fallback', () => {
  const base = { name: '测试', endpoint: 'https://api.siliconflow.cn/v1' };
  expect(connectionIcon(base).brand).toBe('siliconcloud');
  expect(connectionIcon({ ...base, kind: 'codex-cli' }).brand).toBe('openai');
  expect(connectionIcon({ ...base, icon: 'openrouter' }).brand).toBe('openrouter');
  expect(connectionIcon({ ...base, icon: 'initials' }).favicon).toBeUndefined();
  expect(connectionIcon({ ...base, endpoint: 'https://api.siliconflow.cn.evil.test/v1?key=secret' }).favicon).toBe('https://api.siliconflow.cn.evil.test/favicon.ico');
  for (const endpoint of ['javascript:alert(1)', 'file:///secret', 'https://user:secret@example.com'])
    expect(connectionIcon({ ...base, endpoint }).favicon).toBeUndefined();
  for (const option of connectionIconOptions)
    expect(connectionIcon({ ...base, icon: option.id }).svg, option.id).toContain('<svg');
});

it('falls back after image errors and retries when the endpoint changes', async () => {
  const connection = reactive({ name: '示例助手', endpoint: 'https://example.test/v1' });
  const root = document.createElement('div');
  const app = createApp(() => h(AssistantConnectionAvatar, { connection }));
  app.mount(root);
  try {
    expect(root.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    root.querySelector('img')!.dispatchEvent(new Event('error'));
    await nextTick();
    expect(root.textContent).toBe('示例');
    connection.endpoint = 'https://other.test/v1';
    await nextTick();
    expect(root.querySelector('img')?.src).toBe('https://other.test/favicon.ico');
  } finally { app.unmount(); }
});
