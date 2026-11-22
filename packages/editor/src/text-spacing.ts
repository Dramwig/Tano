const han = /\p{Script=Han}/u;
const western = /[\p{Script=Latin}0-9]/u;
const combining = /\p{Mark}/u;

export type SpacingKind = 'han' | 'western' | 'object' | 'other';
export interface SpacingSpan {
  from: number;
  to: number;
  kind: SpacingKind;
}

export function needsTextSpace(left: SpacingKind, right: SpacingKind) {
  return (left === 'han' && (right === 'western' || right === 'object')) ||
    (right === 'han' && (left === 'western' || left === 'object'));
}

/** Unparsed syntax can still be in progress while a user types. */
const unfinishedSyntax = new RegExp([
  /(?:https?:\/\/|www\.)[^\s<>]+/,
  /(?<!\\)`+[^\r\n`]*(?:`+|$)/,
  /(?<!\\)\$+[^\r\n$]*(?:\$+|$)/,
  /(?<!\\)\\\([^\r\n]*?(?:\\\)|$)/,
  /(?<!\\)\[\[?[^\r\n\]]*(?:\]\]|\]\([^\r\n)]*(?:\)|$)|\]|$)/,
  /(?<!\\)<[a-z!/][^\r\n>]*(?:>|$)/,
].map(pattern => pattern.source).join('|'), 'gim');

export function* textSpacingSpans(text: string, start: number, protectSyntax = false): Iterable<SpacingSpan> {
  const opaque = protectSyntax ? text.matchAll(unfinishedSyntax) : undefined;
  let match = opaque?.next().value;
  let from = start;
  let previous: SpacingSpan | undefined;
  for (const character of text) {
    const to = from + character.length;
    while (match && match.index + match[0].length <= from - start) match = opaque!.next().value;
    if (combining.test(character)) {
      // Only insertion ranges need to include the whole grapheme. The
      // display decoration starts on the base character as before.
      if (previous && protectSyntax) previous.to = to;
    } else {
      if (previous) yield previous;
      const protectedCharacter = match && match.index <= from - start;
      const kind = protectedCharacter ? 'other' : han.test(character) ? 'han' : western.test(character) ? 'western' : 'other';
      previous = { from, to, kind };
    }
    from = to;
  }
  if (previous) yield previous;
}

export function spacingTouchesEdit(left: SpacingSpan, right: SpacingSpan, from: number, to: number) {
  return (left.from < to && left.to > from) || (right.from < to && right.to > from);
}
