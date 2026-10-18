import type { AssistantRequest } from '@tano/protocol';
import { parseUiLocale } from '../locale';
import type { UiLocale } from '../locale';
import chinese from './locales/zh-CN.json';
import english from './locales/en-US.json';
import taskPrompts from './task-prompts.json';

const catalogs: Record<UiLocale, typeof chinese> = { 'zh-CN': chinese, 'en-US': english };
export const assistantCopy = (locale: UiLocale) => catalogs[parseUiLocale(locale)];
export const assistantTaskPrompts = taskPrompts;
export type AssistantPromptOrigin = 'builtin' | 'user';

/** Interpolate values verbatim; user text must never become a translation key. */
export function formatAssistantText(template: string, values: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}

export function assistantLanguagePolicy(locale: UiLocale, origin: AssistantPromptOrigin = 'user'): string {
  const normalized = parseUiLocale(locale);
  const language = normalized === 'en-US' ? 'English' : 'Simplified Chinese';
  return `[tano-response-locale:${normalized}]\n${formatAssistantText(taskPrompts.languagePolicy, [language, normalized])}\n${taskPrompts.inputOrigin[origin]}`;
}

/** The demo follows the same request snapshot as real transports, never the live UI locale. */
export function assistantRequestLocale(request: AssistantRequest): UiLocale {
  return request.messages.some(message => message.role === 'system' &&
    (message.content?.includes(assistantLanguagePolicy('en-US', 'user')) ||
      message.content?.includes(assistantLanguagePolicy('en-US', 'builtin')))) ? 'en-US' : 'zh-CN';
}

export const assistantSourceSeparator = () => `\n${taskPrompts.sourceDataHeader}\n`;

export function assistantDiscussionPrompt(quote: string | undefined,
  messages: readonly { author: string; body: string }[]): string {
  const copy = taskPrompts;
  return `${copy.commentInstruction}\n\n${copy.commentDataHeader}\n${JSON.stringify({ quote: quote ?? '', messages })}`;
}
