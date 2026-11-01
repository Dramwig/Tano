import { expect, it } from 'vitest';
import { modelIcon, modelIconBrand } from './model-icons';

it.each([
  ['gpt-5', 'openai'], ['openai/gpt-5', 'openai'], ['o3', 'openai'],
  ['codex', 'codex'], ['gpt-5-codex', 'codex'], ['openai/gpt-5.1-codex-max', 'codex'],
  ['claude-sonnet-4', 'claude'], ['anthropic/claude-opus-4', 'claude'],
  ['claudecode', 'claudecode'], ['Claude Code', 'claudecode'], ['claude-code', 'claudecode'],
  ['anthropic/claude_code', 'claudecode'], ['cli-default', undefined], ['codexing', undefined],
])('identifies %s as %s', (name, brand) => {
  expect(modelIconBrand(name)).toBe(brand);
});

it('uses distinct artwork for models and their coding tools', () => {
  expect(modelIcon('gpt-5')?.svg).not.toBe(modelIcon('gpt-5-codex')?.svg);
  expect(modelIcon('claude-sonnet-4')?.svg).not.toBe(modelIcon('Claude Code')?.svg);
});
