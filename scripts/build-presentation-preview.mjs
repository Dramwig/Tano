import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPlugin } from './plugin-build.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'examples/plugins/presentation-preview');
const destination = resolve(root, 'packages/workbench/src/plugins/presentation-preview');
const notices = ['Presentation Preview for Tano — MIT\n'];
for (const name of ['@web-ppt/core', 'fflate']) {
  const directory = resolve(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  notices.push(`${name}@${pkg.version}\n${await readFile(resolve(directory, 'LICENSE'), 'utf8')}`);
}
await writeFile(resolve(source, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
const result = await buildPlugin(source);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'bundle.tano-plugin.json'), result.canonical + '\n');
await writeFile(resolve(destination, 'manifest.json'), await readFile(resolve(source, 'manifest.json')));
console.log(`Presentation Preview: ${Buffer.byteLength(result.canonical)} bytes, SHA-256 ${result.integrity}`);
