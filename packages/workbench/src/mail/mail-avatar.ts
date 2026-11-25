// SPDX-License-Identifier: MIT
import type { MailAddress } from './types';

/** First visible character of a sender, upper-cased for Latin names. */
export function senderInitial(addr: MailAddress | undefined): string {
  const source = (addr?.name || addr?.address || '?').trim().replace(/^["'<(]+/, '');
  const first = Array.from(source)[0] ?? '?';
  return first.toLocaleUpperCase();
}

/** Stable hue per address so the same sender keeps the same (muted) tint. */
export function avatarHue(addr: MailAddress | undefined): number {
  const key = (addr?.address || addr?.name || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
