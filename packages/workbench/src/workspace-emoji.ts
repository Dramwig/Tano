import { workspaceEmojiCodepoint } from './workspace-emoji-codepoint';
import spriteUrl from './assets/emoji/twemoji/sprite.webp';
import sprite from './assets/emoji/twemoji/sprite.json';

/** Use local artwork when available; keep unknown custom symbols readable. */
export function workspaceEmojiSprite(emoji: string) {
  const cell = (sprite.cells as Record<string, number[]>)[workspaceEmojiCodepoint(emoji)];
  if (!cell) return undefined;
  const width = sprite.columns * sprite.cellSize;
  const height = sprite.rows * sprite.cellSize;
  // CSS percentages refer to the sheet minus the viewport, which crops off each cell's gutter.
  return {
    backgroundImage: `url("${spriteUrl}")`,
    backgroundSize: `${width / sprite.artworkSize * 100}% ${height / sprite.artworkSize * 100}%`,
    backgroundPosition: `${(cell[0] * sprite.cellSize + sprite.padding) / (width - sprite.artworkSize) * 100}% ${(cell[1] * sprite.cellSize + sprite.padding) / (height - sprite.artworkSize) * 100}%`,
  };
}
