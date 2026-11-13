/* Fades freshly typed text in: opacity and a touch of blur, one short clock
 * per keystroke.
 *
 * Progress belongs to the moment the text was typed (`data-typed-at`), not to
 * a DOM node, so when ProseMirror redraws a span on the next keystroke the new
 * node picks up where the old one was instead of restarting. The opacity is a
 * paused WAAPI animation whose `currentTime` is set each frame: it never
 * touches DOM attributes, which ProseMirror's DOM observer would have to read.
 * A held key is not animated at all (see typing-motion.ts). */

const TIMED_FADE = 190;
const TIMED_FADE_IME = 240;
/** Never keep text hidden longer than this. */
const MAX_REVEAL = 420;
const SCRUB = 1000;

type Entry = { progress: number; at: number; ime: boolean };
type Live = { at: number; animation: Animation };

export class TypedReveal {
  /** Progress per typing moment, shared by every node that renders it. */
  private entries = new Map<number, Entry>();
  private live = new Map<HTMLElement, Live>();

  /** Called after each view update: adopt new or redrawn spans. */
  sync(root: HTMLElement, now = performance.now()) {
    for (const [span, live] of this.live) {
      if (!span.isConnected || Number(span.dataset.typedAt) !== live.at) { live.animation.cancel(); this.live.delete(span); }
    }
    for (const span of root.querySelectorAll<HTMLElement>('.tano-typed[data-typed-at]')) {
      if (this.live.has(span) || typeof span.animate !== 'function') continue;
      const at = Number(span.dataset.typedAt);
      let entry = this.entries.get(at);
      if (!entry) {
        if (now - at > MAX_REVEAL) continue;
        entry = { progress: 0, at, ime: span.classList.contains('tano-typed-ime') };
        this.entries.set(at, entry);
      }
      if (entry.progress >= 1) continue;
      const animation = span.animate(entry.ime
        ? [{ opacity: 0.45, filter: 'blur(0.8px)' }, { opacity: 1, filter: 'blur(0px)' }]
        : [{ opacity: 0, filter: 'blur(1.2px)', offset: 0 }, { opacity: 0.85, filter: 'blur(0px)', offset: 0.7 }, { opacity: 1, filter: 'blur(0px)' }],
      { duration: SCRUB, fill: 'both' });
      animation.pause();
      animation.currentTime = entry.progress * SCRUB;
      this.live.set(span, { at, animation });
    }
  }

  /** Frame task: advance every live span on its own clock. */
  frame(now: number): boolean {
    // A finished moment must stay finished if its span is redrawn later.
    for (const [at, entry] of this.entries) if (now - at > MAX_REVEAL + 200 && entry.progress >= 1) this.entries.delete(at);
    if (!this.live.size) return false;
    for (const [span, live] of this.live) {
      const entry = this.entries.get(live.at)!;
      entry.progress = Math.min(1, Math.max(entry.progress, this.timed(entry, now)));
      if (entry.progress >= 1) {
        live.animation.cancel();
        this.live.delete(span);
      } else live.animation.currentTime = entry.progress * SCRUB;
    }
    return this.live.size > 0;
  }

  clear() {
    for (const live of this.live.values()) live.animation.cancel();
    this.live.clear();
    this.entries.clear();
  }

  private timed(entry: Entry, now: number) {
    const duration = entry.ime ? TIMED_FADE_IME : TIMED_FADE;
    const elapsed = now - entry.at;
    // Ease-out on time, and a hard ceiling so nothing stays hidden.
    if (elapsed >= MAX_REVEAL) return 1;
    const linear = Math.min(1, Math.max(0, elapsed / duration));
    return 1 - (1 - linear) * (1 - linear);
  }
}
