import type { ActivePluginContextProvider } from '../plugins/assistant-bridge';

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const triggerBoundaryPattern = /^[\s,，。；;（(]$/;
const mentionBodyPattern = /^[a-zA-Z0-9._:-]*$/;

/** Detect an active `@` plugin-context mention right before `caret`, ignoring email-like tokens. */
export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret < 1 || caret > text.length) return null;
  let index = caret - 1;
  while (index >= 0) {
    const ch = text[index]!;
    if (ch === '@') {
      if (index > 0 && !triggerBoundaryPattern.test(text[index - 1]!)) return null;
      const query = text.slice(index + 1, caret);
      if (!mentionBodyPattern.test(query)) return null;
      return { start: index, end: caret, query };
    }
    if (!mentionBodyPattern.test(ch)) return null;
    index--;
  }
  return null;
}

export function filterPluginContextProviders(
  providers: readonly ActivePluginContextProvider[],
  query: string,
): ActivePluginContextProvider[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...providers];
  return providers.filter(
    entry =>
      entry.provider.id.toLocaleLowerCase().includes(needle) ||
      entry.key.toLocaleLowerCase().includes(needle) ||
      entry.provider.label.toLocaleLowerCase().includes(needle) ||
      entry.provider.description.toLocaleLowerCase().includes(needle) ||
      entry.pluginName.toLocaleLowerCase().includes(needle),
  );
}

/** Disambiguate duplicate short provider IDs across plugins using `@pluginId:providerId`. */
export function formatPluginMentionToken(
  entry: ActivePluginContextProvider,
  allProviders: readonly ActivePluginContextProvider[],
): string {
  const id = entry.provider.id.toLowerCase();
  const duplicates = allProviders.filter(item => item.provider.id.toLowerCase() === id).length;
  return duplicates > 1 ? `@${entry.key}` : `@${entry.provider.id}`;
}

export function applyMentionSelection(
  text: string,
  trigger: MentionTrigger,
  entry: ActivePluginContextProvider,
  allProviders: readonly ActivePluginContextProvider[],
): { text: string; caret: number; token: string } {
  const token = formatPluginMentionToken(entry, allProviders);
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const suffix = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';
  const nextText = `${before}${token}${suffix}${after}`;
  const nextCaret = before.length + token.length + suffix.length;
  return { text: nextText, caret: nextCaret, token };
}
