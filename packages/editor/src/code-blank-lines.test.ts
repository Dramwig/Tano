import { expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';

it.each([
  '```aba\n```\n',
  '```aba\n\n```\n',
  '```aba\n\n\n```\n',
  '```aba\nx\n\n```\n',
])('keeps fenced code body rows across Markdown parsing: %s', async (source) => {
  const codec = await createHeadlessMarkdown();
  try {
    expect(codec.normalize(source)).toBe(source);
  } finally {
    await codec.destroy();
  }
});
