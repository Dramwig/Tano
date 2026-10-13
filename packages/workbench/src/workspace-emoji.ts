import { workspaceEmojiCodepoint } from './workspace-emoji-codepoint';
import spriteUrl from './assets/emoji/twemoji/sprite.webp';
import sprite from './assets/emoji/twemoji/sprite.json';

/** Pixel crop of the same local artwork used by the picker and document icons. */
export function workspaceEmojiArtwork(emoji: string) {
  const cell = (sprite.cells as Record<string, number[]>)[workspaceEmojiCodepoint(emoji)];
  return cell ? {
    url: spriteUrl, x: cell[0]! * sprite.cellSize + sprite.padding,
    y: cell[1]! * sprite.cellSize + sprite.padding, size: sprite.artworkSize,
  } : undefined;
}

/** Use local artwork when available; keep unknown custom symbols readable. */
export function workspaceEmojiSprite(emoji: string) {
  const artwork = workspaceEmojiArtwork(emoji);
  if (!artwork) return undefined;
  const width = sprite.columns * sprite.cellSize;
  const height = sprite.rows * sprite.cellSize;
  // CSS percentages refer to the sheet minus the viewport, which crops off each cell's gutter.
  return {
    backgroundImage: `url("${spriteUrl}")`,
    backgroundSize: `${width / sprite.artworkSize * 100}% ${height / sprite.artworkSize * 100}%`,
    backgroundPosition: `${artwork.x / (width - sprite.artworkSize) * 100}% ${artwork.y / (height - sprite.artworkSize) * 100}%`,
  };
}
