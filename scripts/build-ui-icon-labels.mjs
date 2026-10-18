import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { workspaceEmojiGroups, builtinWorkspaceIcons } from '../packages/workbench/src/workspace-icons.ts';

const require = createRequire(import.meta.url);
const english = require('emojibase-data/en/data.json');
const identity = value => value.replaceAll('\ufe0f', '');
const labels = new Map(english.map(item => [identity(item.emoji), item.label]));
const result = Object.fromEntries([
  ...workspaceEmojiGroups.flatMap(group => group.icons.map(icon => [icon.value, labels.get(identity(icon.value)) ?? icon.value])),
  ...builtinWorkspaceIcons.map(icon => {
    const label = icon.keywords.split(' ')[0];
    return [icon.value, label[0].toUpperCase() + label.slice(1)];
  }),
]);
const path = new URL('../packages/workbench/src/locales/icon-labels-en.json', import.meta.url);
const output = JSON.stringify(result, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) throw new Error('English icon labels need regeneration');
} else writeFileSync(path, output);
console.log(`Verified ${Object.keys(result).length} English icon labels.`);
