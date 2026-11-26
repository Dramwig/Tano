import {
  assistantCatalog as protocolAssistantCatalog,
  type AssistantCopy,
} from '@tano/protocol/assistant-language';
import { localeDefinition, type UiLocale } from './locale-registry';
import type { PluralCatalog } from './plurals';

export type Messages = Readonly<Record<string, string>>;
export interface LocaleCatalogs { messages: Messages; icons: Messages; assistant: AssistantCopy; plurals: PluralCatalog }
const catalogs = new Map<UiLocale, LocaleCatalogs>();
const pending = new Map<UiLocale, Promise<void>>();

export function loadedLocale(locale: UiLocale) { return catalogs.get(locale); }
export function assistantCatalog(locale: UiLocale): AssistantCopy {
  return catalogs.get(locale)?.assistant ?? protocolAssistantCatalog(locale);
}

/** Deduplicate concurrent imports; a failed request remains retryable. */
export function loadLocaleCatalogs(locale: UiLocale): Promise<void> {
  if (catalogs.has(locale)) return Promise.resolve();
  const existing = pending.get(locale);
  if (existing) return existing;
  const entry = localeDefinition(locale);
  const loading = Promise.all([entry.loadMessages(), entry.loadIcons(), entry.loadAssistant(), entry.loadPlurals()])
    .then(([messages, icons, assistant, plurals]) => { catalogs.set(locale, { messages, icons, assistant, plurals }); })
    .finally(() => { pending.delete(locale); });
  pending.set(locale, loading);
  return loading;
}
