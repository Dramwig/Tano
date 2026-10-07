import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages/workbench/src/assets/emoji/emojibase');
const inputs = {};
for (const name of ['package.json', 'zh/data.json', 'en/data.json', 'LICENSE']) {
  inputs[name] = await readFile(fileURLToPath(import.meta.resolve(`emojibase-data/${name}`)));
}
const pkg = JSON.parse(inputs['package.json']);
const chinese = JSON.parse(inputs['zh/data.json']);
const english = new Map(JSON.parse(inputs['en/data.json']).map(emoji => [emoji.hexcode, emoji]));
const categories = [
  [0, 'faces', '表情与情绪', '😀'], [1, 'people', '人物与手势', '👋'],
  [3, 'nature', '动物与自然', '🌿'], [4, 'food', '食物与饮品', '🍎'],
  [6, 'activity', '活动与兴趣', '⚽'], [5, 'travel', '旅行与地点', '✈️'],
  [7, 'objects', '工作与物品', '💡'], [8, 'symbols', '符号与标记', '❤️'],
  [9, 'flags', '旗帜', '🏳️'],
];
const catalog = categories.map(([number, id, label, symbol]) => ({
  id, label, symbol,
  // Skin variants and standalone components stay out of the grid; base emoji include joined families and professions.
  icons: chinese.filter(emoji => emoji.group === number && Array.from(emoji.emoji).length <= 16)
    .sort((a, b) => a.order - b.order)
    .map(emoji => {
      const en = english.get(emoji.hexcode);
      return {
        value: emoji.emoji, label: emoji.label,
        keywords: [...new Set([emoji.label, ...(emoji.tags ?? []), en?.label, ...(en?.tags ?? [])].filter(Boolean))].join(' '),
      };
    }),
}));
const hashes = Object.fromEntries(Object.entries(inputs).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
const outputs = {
  'catalog.json': JSON.stringify(catalog, null, 2) + '\n',
  'manifest.json': JSON.stringify({
    package: pkg.name, version: pkg.version, source: 'https://github.com/milesj/emojibase',
    locales: ['zh', 'en'], emojiCount: catalog.reduce((count, group) => count + group.icons.length, 0),
    inputs: hashes,
  }, null, 2) + '\n',
  LICENSE: inputs.LICENSE,
  'README.md': `# Workspace emoji metadata

The localized names, search tags, and Unicode ordering in [catalog.json](catalog.json)
are derived from Emojibase Data ${pkg.version} (Simplified Chinese and English).
Copyright (c) 2017-2019 Miles Johnson. Licensed under [MIT](LICENSE).
Source: [Emojibase](https://github.com/milesj/emojibase).

Tano selects base emoji, omits standalone components and skin-tone duplicates,
maps them to nine categories, and combines their Chinese and English search tags.
Existing curated workspace names and Unicode values take precedence.
Artwork comes from the separately licensed [Twemoji sprite](../twemoji/README.md).

Run \`node scripts/build-workspace-emoji-catalog.mjs\` to regenerate offline from
the pinned npm package. Run it with \`--check\` to verify the generated subset.
Input SHA-256 hashes are retained in [manifest.json](manifest.json).
`,
};
if (process.argv.includes('--check')) {
  for (const [name, content] of Object.entries(outputs)) {
    if (!(await readFile(join(target, name))).equals(Buffer.from(content))) throw new Error(`Stale emoji metadata: ${name}. Run npm run emoji:generate.`);
  }
} else {
  await mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) await writeFile(join(target, name), content);
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${catalog.reduce((count, group) => count + group.icons.length, 0)} base emoji with Chinese/English search metadata.`);
