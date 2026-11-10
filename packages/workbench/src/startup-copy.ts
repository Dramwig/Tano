import { localeDefinition, type UiLocale } from './locale-registry';

// Recovery does not import Vue or execute any catalog loaders.
export function startupCopy(locale: UiLocale) { return localeDefinition(locale).startup; }
