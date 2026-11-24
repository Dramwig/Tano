/** Twemoji retains selectors in joined sequences except the selector-free eye/speech-bubble asset. */
export function workspaceEmojiCodepoint(emoji: string) {
  const withoutSelectors = emoji.replace(/\ufe0f/g, '');
  const normalized = emoji.includes('\u200d') && withoutSelectors !== '👁‍🗨' ? emoji : withoutSelectors;
  return Array.from(normalized, character => character.codePointAt(0)!.toString(16)).join('-');
}
