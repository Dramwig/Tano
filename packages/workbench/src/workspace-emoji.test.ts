import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { workspaceEmojiGroups, workspaceBuiltinIconGroups, filterWorkspaceIconGroups } from './workspace-icons';
import { workspaceEmojiCodepoint } from './workspace-emoji-codepoint';
import { workspaceEmojiSprite } from './workspace-emoji';
import sprite from './assets/emoji/twemoji/sprite.json';

const directory = new URL('./assets/emoji/twemoji/', import.meta.url);

it('offers over 1800 unique base emoji across nine categories with Chinese and English search', () => {
  const icons = workspaceEmojiGroups.flatMap(group => group.icons);
  expect(icons.length).toBeGreaterThan(1800);
  expect(workspaceEmojiGroups).toHaveLength(9);
  expect(new Set(icons.map(icon => workspaceEmojiCodepoint(icon.value))).size).toBe(icons.length);
  for (const [query, value] of [['水母', '🪼'], ['jellyfish', '🪼'], ['豌豆', '🫛'], ['疲惫', '🫩'], ['中国', '🇨🇳'], ['🏳️‍🌈', '🏳️‍🌈']]) {
    const results = filterWorkspaceIconGroups(workspaceEmojiGroups, query).flatMap(group => group.icons);
    expect(results.some(icon => icon.value === value), query).toBe(true);
    expect(workspaceEmojiSprite(value), value).toBeTruthy();
  }
  expect(icons.find(icon => icon.label === '咖啡')?.value).toBe('☕');
  expect(icons.find(icon => icon.label === '程序员')?.value).toBe('🧑‍💻');
});

it('uses one local sprite with a distinct in-bounds cell for every catalog emoji and category', () => {
  const emojis = [
    ...workspaceEmojiGroups.flatMap(group => group.icons.map(icon => icon.value)),
    ...[...workspaceEmojiGroups, ...workspaceBuiltinIconGroups].map(group => group.symbol),
  ];
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  const images = new Set<string>();
  const cells = new Set<string>();
  for (const emoji of emojis) {
    const style = workspaceEmojiSprite(emoji)!;
    expect(style, emoji).toBeTruthy();
    expect(style.backgroundImage).not.toMatch(/https?:\/\//);
    images.add(style.backgroundImage);
    const cell = (sprite.cells as Record<string, number[]>)[workspaceEmojiCodepoint(emoji)];
    expect(cell[0]).toBeGreaterThanOrEqual(0); expect(cell[0]).toBeLessThan(sprite.columns);
    expect(cell[1]).toBeGreaterThanOrEqual(0); expect(cell[1]).toBeLessThan(sprite.rows);
    cells.add(cell.join(','));
    const filename = `${workspaceEmojiCodepoint(emoji)}.svg`;
    const bytes = readFileSync(new URL(filename, directory));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.assets[filename]);
  }
  expect(images.size).toBe(1);
  expect(cells.size).toBe(Object.keys(sprite.cells).length);
  const sheet = readFileSync(new URL(sprite.image, directory));
  expect(createHash('sha256').update(sheet).digest('hex')).toBe(sprite.sha256);
});

it('resolves presentation selectors and joined emoji without altering the saved Unicode', () => {
  expect(workspaceEmojiSprite('❤️')).toEqual(workspaceEmojiSprite('❤'));
  expect(workspaceEmojiSprite('☀️')).toBeTruthy();
  expect(workspaceEmojiSprite('🧑‍🔬')).toBeTruthy();
  expect(workspaceEmojiSprite('🧑‍🔬')?.backgroundPosition).not.toBe(workspaceEmojiSprite('☀️')?.backgroundPosition);
  expect(workspaceEmojiSprite('☁️')).toBeTruthy();
  expect(workspaceEmojiSprite('👁️‍🗨️')).toEqual(workspaceEmojiSprite('👁‍🗨'));
  expect(workspaceEmojiSprite('🌙🌿')).toBeUndefined();
});

it('crops original colored artwork without neighbors at the first, middle, and last sprite cells', async () => {
  const width = sprite.columns * sprite.cellSize;
  const height = sprite.rows * sprite.cellSize;
  const { data, info } = await sharp(readFileSync(new URL(sprite.image, directory))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height, info.channels]).toEqual([width, height, 4]);
  const ids = Object.keys(sprite.cells);
  for (const index of [0, Math.floor(ids.length / 2), ids.length - 1]) {
    const id = ids[index];
    const [column, row] = (sprite.cells as Record<string, number[]>)[id];
    const source = await sharp(readFileSync(new URL(`${id}.svg`, directory)), { density: 144 })
      .resize(sprite.artworkSize, sprite.artworkSize).ensureAlpha().raw().toBuffer();
    // Turn the CSS percentages back into source-pixel offsets, independently of the cell lookup.
    const emoji = id.split('-').map(part => String.fromCodePoint(parseInt(part, 16))).join('');
    const positions = workspaceEmojiSprite(emoji)!.backgroundPosition.split(' ').map(parseFloat);
    const left = Math.round(positions[0] / 100 * (width - sprite.artworkSize));
    const top = Math.round(positions[1] / 100 * (height - sprite.artworkSize));
    expect([left, top]).toEqual([column * sprite.cellSize + sprite.padding, row * sprite.cellSize + sprite.padding]);
    for (let y = 0; y < sprite.artworkSize; y++) {
      const start = ((top + y) * width + left) * 4;
      expect(data.subarray(start, start + sprite.artworkSize * 4).equals(source.subarray(y * sprite.artworkSize * 4, (y + 1) * sprite.artworkSize * 4)), id).toBe(true);
      expect(data[start - 1], `${id} left gutter`).toBe(0);
      expect(data[start + sprite.artworkSize * 4 + 3], `${id} right gutter`).toBe(0);
    }
  }
});
