// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { connectionIcon, connectionIconOptions } from '../assistant/connection-icons';
import AssistantConnectionAvatar from './AssistantConnectionAvatar.vue';
import { agentIconOptions } from '../assistant/agent-icons';

it('renders bundled brand colors for explicit and automatically detected avatars', () => {
  const base = { name: '品牌', endpoint: 'https://api.deepseek.com/v1' };
  expect(connectionIcon(base).svg).toContain('#4D6BFE');
  expect(connectionIcon({ ...base, icon: 'gemini' }).svg).toContain('linearGradient');
  expect(connectionIcon({ ...base, icon: 'mistral' }).svg).toContain('#FF8205');
  expect(connectionIcon({ ...base, icon: 'groq' }).svg).toContain('#F55036');
  expect(connectionIcon({ ...base, kind: 'codex-cli' }).svg).toContain('Codex');
  expect(connectionIcon({ ...base, kind: 'claude-cli' }).svg).toContain('#D97757');
});

it('offers a separate colorful cast while rendering previously saved colorful avatars', () => {
  const colorful = agentIconOptions.filter(option => option.id.startsWith('agent-color-'));
  const outline = agentIconOptions.filter(option => !option.id.startsWith('agent-color-') && !option.id.startsWith('agent-pixel-'));
  expect(colorful).toHaveLength(24);
  for (const option of colorful) {
    expect(outline.some(other => other.label === option.label)).toBe(false);
    expect(outline.some(other => other.id === option.id.replace('agent-color-', 'agent-'))).toBe(false);
  }
  const legacy = connectionIcon({ name: '已有头像', endpoint: '', icon: 'agent-color-cat' });
  expect(legacy.svg).toContain('<svg');
  expect(legacy.favicon).toBeUndefined();
  expect(connectionIconOptions.some(option => option.id === 'agent-color-cat')).toBe(false);
});

it('uses bundled providers, explicit overrides and safe origin-only favicon fallback', () => {
  const base = { name: '测试', endpoint: 'https://api.siliconflow.cn/v1' };
  expect(connectionIcon(base).brand).toBe('siliconcloud');
  expect(connectionIcon({ ...base, kind: 'codex-cli' }).brand).toBe('codex');
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

it('distinguishes model providers from coding tools and preserves explicit choices', () => {
  const base = { name: '助手', endpoint: 'https://api.openai.com/v1' };
  const gpt = connectionIcon(base);
  const codex = connectionIcon({ ...base, kind: 'codex-cli' });
  const claude = connectionIcon({ ...base, endpoint: 'https://api.anthropic.com/v1' });
  const code = connectionIcon({ ...base, kind: 'claude-cli' });
  expect(gpt.brand).toBe('openai');
  expect(codex.brand).toBe('codex');
  expect(claude.brand).toBe('claude');
  expect(code.brand).toBe('claudecode');
  expect(codex.svg).not.toBe(gpt.svg);
  expect(code.svg).not.toBe(claude.svg);
  expect(connectionIcon({ ...base, kind: 'codex-cli', icon: 'openai' }).svg).toBe(gpt.svg);
  expect(connectionIcon({ ...base, kind: 'claude-cli', icon: 'agent-cat' }).brand).toBe('agent-cat');
});
