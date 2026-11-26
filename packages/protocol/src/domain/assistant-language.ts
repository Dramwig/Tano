import type { AssistantRequest } from '../assistant';
// Small synchronous fallbacks also serve non-UI consumers of assistantCopy().
import chineseAssistant from './locales/zh-CN.json';
import englishAssistant from './locales/en-US.json';
import taskPrompts from './assistant-task-prompts.json';

export type AssistantCopy = typeof chineseAssistant;

const assistantLocaleEntries = [
  {
    value: 'zh-CN',
    language: 'Simplified Chinese',
    load: async () => chineseAssistant,
  },
  {
    value: 'en-US',
    language: 'English',
    load: async () => englishAssistant,
  },
  {
    value: 'zh-TW',
    language: 'Traditional Chinese',
    load: () => import('./locales/zh-TW.json').then(module => module.default),
  },
  {
    value: 'ja-JP',
    language: 'Japanese',
    load: () => import('./locales/ja-JP.json').then(module => module.default),
  },
  {
    value: 'es-ES',
    language: 'Spanish',
    load: () => import('./locales/es-ES.json').then(module => module.default),
  },
  {
    value: 'de-DE',
    language: 'German',
    load: () => import('./locales/de-DE.json').then(module => module.default),
  },
] as const;

export type AssistantLocale = (typeof assistantLocaleEntries)[number]['value'];
export const assistantLocales: readonly AssistantLocale[] = assistantLocaleEntries.map(entry => entry.value);
export const assistantClipboardSeparator = '\n\nClipboard attachments (reference data):\n';

const loaded = new Map<AssistantLocale, AssistantCopy>();
const pending = new Map<AssistantLocale, Promise<AssistantCopy>>();

export function parseAssistantLocale(value: unknown): AssistantLocale {
  return assistantLocales.includes(value as AssistantLocale) ? (value as AssistantLocale) : 'zh-CN';
}

export function assistantLocaleLanguage(locale: AssistantLocale): string {
  return assistantLocaleEntries.find(entry => entry.value === locale)!.language;
}

/** Deduplicate concurrent imports; a failed request remains retryable. */
export function loadAssistantLocale(locale: AssistantLocale): Promise<AssistantCopy> {
  const normalized = parseAssistantLocale(locale);
  const cached = loaded.get(normalized);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(normalized);
  if (existing) return existing;
  const entry = assistantLocaleEntries.find(item => item.value === normalized)!;
  const loading = entry
    .load()
    .then(copy => {
      loaded.set(normalized, copy);
      return copy;
    })
    .finally(() => {
      pending.delete(normalized);
    });
  pending.set(normalized, loading);
  return loading;
}

export function assistantCatalog(locale: AssistantLocale): AssistantCopy {
  const normalized = parseAssistantLocale(locale);
  return loaded.get(normalized) ?? (normalized === 'zh-CN' ? chineseAssistant : englishAssistant);
}

export const assistantCopy = (locale: AssistantLocale) => assistantCatalog(parseAssistantLocale(locale));
export const assistantTaskPrompts = taskPrompts;
export type AssistantPromptOrigin = 'builtin' | 'user';

/** Interpolate values verbatim; user text must never become a translation key. */
export function formatAssistantText(template: string, values: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}

export function assistantLanguagePolicy(locale: AssistantLocale, origin: AssistantPromptOrigin = 'user'): string {
  const normalized = parseAssistantLocale(locale);
  const language = assistantLocaleLanguage(normalized);
  return `[tano-response-locale:${normalized}]\n${formatAssistantText(taskPrompts.languagePolicy, [language, normalized])}\n${taskPrompts.inputOrigin[origin]}`;
}

/** The demo follows the same request snapshot as real transports, never the live UI locale. */
export function assistantRequestLocale(request: AssistantRequest): AssistantLocale {
  return assistantLocales.find(locale => request.messages.some(message => message.role === 'system' &&
    (message.content?.includes(assistantLanguagePolicy(locale, 'user')) ||
      message.content?.includes(assistantLanguagePolicy(locale, 'builtin'))))) ?? 'zh-CN';
}

export const assistantSourceSeparator = () => `\n${taskPrompts.sourceDataHeader}\n`;

export function assistantDiscussionPrompt(quote: string | undefined,
  messages: readonly { author: string; body: string }[]): string {
  const copy = taskPrompts;
  return `${copy.commentInstruction}\n\n${copy.commentDataHeader}\n${JSON.stringify({ quote: quote ?? '', messages })}`;
}
