import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { englishMessages } from './locales/en-US';
import { uiLocales } from './locale';
import { startupCopy } from './startup-copy';
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const tokens = (text: string) => [...text.matchAll(/\{\d+\}|\[来源:S\d+\]/g)].map(match => match[0]).sort();
function check(source: unknown, target: unknown, path: string) {
  if (typeof source === 'string') {
    expect(typeof target, path).toBe('string');
    expect((target as string).trim().length, path).toBeGreaterThan(0);
    expect(tokens(target as string), path).toEqual(tokens(source));
  } else {
    expect(Object.keys(target as object).sort(), path).toEqual(Object.keys(source as object).sort());
    for (const [key, value] of Object.entries(source as object)) check(value, (target as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
for (const locale of uiLocales.filter(locale => !['zh-CN', 'en-US'].includes(locale))) {
  it(`keeps ${locale} UI, assistant, icons and startup complete`, () => {
    // UI placeholders follow Chinese keys; translations may reorder them.
    check(Object.fromEntries(Object.keys(englishMessages).map(key => [key, key])), read(`./locales/${locale}.json`), locale);
    check(read('./assistant/locales/en-US.json'), read(`./assistant/locales/${locale}.json`), `assistant.${locale}`);
    check(read('./locales/icon-labels-en.json'), read(`./locales/icon-labels-${locale}.json`), `icons.${locale}`);
    for (const text of Object.values(startupCopy(locale))) expect(text.trim().length).toBeGreaterThan(0);
  });
}
