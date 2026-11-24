import type { Node } from '@milkdown/kit/prose/model';

// Custom icons are plain text metadata: emoji, icon:<builtin-id>, or none.
export const calloutMarker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|CUSTOM(?::[^\]\s]+)?)\](?=\s|$)/i;

export function isCalloutHeader(text: string): boolean {
  return calloutMarker.exec(text)?.[0] === text;
}

export function customCalloutIcon(marker: string): string {
  const value = /^\[!CUSTOM(?::([^\]\s]+))?\]$/i.exec(marker)?.[1];
  return value === 'none' ? '' : value ?? '💡';
}

export function customCalloutMarker(icon: string): string | null {
  if (!icon) return '[!CUSTOM:none]';
  // Keep metadata on one line and prevent Markdown syntax from becoming content.
  if (!/^icon:[a-z0-9-]+$/.test(icon) &&
      (!/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3#*0-9\u{e0020}-\u{e007f}]+$/u.test(icon) || icon.length > 64)) return null;
  return `[!CUSTOM:${icon}]`;
}

/** The Markdown marker is container metadata, never a movable body block. */
export function blockContentStart(node: Node): number {
  const first = node.firstChild;
  return node.type.name === 'blockquote' && first?.type.name === 'paragraph' &&
    first.childCount === 1 && first.firstChild?.isText &&
    isCalloutHeader(first.textContent) ? 1 : 0;
}
