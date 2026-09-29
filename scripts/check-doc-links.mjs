import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const docsDirectory = resolve('docs');
const files = [
  resolve('README.md'),
  resolve('README_ZH.md'),
  resolve('README_JA.md'),
  resolve('README_DE.md'),
];
const missing = [];
const markdownLink = /\]\(([^)]+)\)/g;

async function collectMarkdown(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectMarkdown(path);
    else if (entry.isFile() && extname(entry.name) === '.md') files.push(path);
  }
}

await collectMarkdown(docsDirectory);

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(markdownLink)) {
    const rawTarget = match[1].trim();
    const target = rawTarget.split('#', 1)[0].trim();
    if (!target || /^(?:https?:|mailto:|object:|#)/i.test(target)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      missing.push(`${relative('.', file)}: invalid URL encoding ${rawTarget}`);
      continue;
    }
    const path = resolve(dirname(file), decoded);
    if (!existsSync(path)) missing.push(`${relative('.', file)}: ${rawTarget}`);
  }
}

if (missing.length) {
  console.error(`Missing documentation targets (${missing.length}):`);
  for (const entry of missing) console.error(`- ${entry}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation links checked: ${files.length} Markdown files, no missing targets.`);
}
