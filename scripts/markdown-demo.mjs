import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(root, 'markdown-test-workspace');
const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
const cloud = args.length === 2 && args[0] === '--cloud' ? resolve(args[1]) : null;
if (args.length && !check && !cloud) throw new Error('Usage: node scripts/markdown-demo.mjs [--check | --cloud <Tano-cloud directory>]');
if (cloud && JSON.parse(await readFile(join(cloud, 'package.json'), 'utf8')).name !== 'tano-cloud')
  throw new Error('The destination must be the Tano-cloud repository.');

const names = {
  'zh-CN': ['00-从这里开始.md', '01-基础块与行内.md', '02-YAML-属性字段.md', '03-公式图表与脚注.md', '04-增强块.md', '05-链接图片与附件.md', '06-对象引用.md', '07-原文保留边界.md', '08-未知指令与嵌入.md', '09-TOML-属性.md', '子目录/目标文档.markdown', 'assets/示例 附件.txt'],
  'en-US': ['00-getting-started.md', '01-basic-blocks-and-inline.md', '02-yaml-properties.md', '03-math-diagrams-and-footnotes.md', '04-enhanced-blocks.md', '05-links-images-and-attachments.md', '06-object-references.md', '07-source-preservation-boundaries.md', '08-unknown-directives-and-embeds.md', '09-toml-frontmatter.md', 'nested-folder/target-document.markdown', 'assets/sample attachment.txt'],
};
const imagePaths = ['zh-CN/assets/测试图片.png', 'en-US/assets/test-image.png'];
const objectIds = ['a82f91', 'b82f91', 'c82f91', 'd82f91', 'e82f91', 'f82f91', '182f91', '282f91'];
const paths = ['开始使用.md', ...Object.entries(names).flatMap(([locale, files]) => files.map(file => `${locale}/${file}`)), ...objectIds.map(id => `.tano/objects/${id}.tano.json`)];
const bytes = new Map();
async function safeRead(path) {
  const relative = path.slice(workspace.length + 1);
  let directory = workspace;
  if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Symlink is not a fixture: ${directory}`);
  for (const part of relative.split(/[\\/]/)) {
    directory = join(directory, part);
    if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Symlink is not a fixture: ${directory}`);
  }
  return readFile(path);
}
for (const path of paths) bytes.set(path, await safeRead(join(workspace, path)));
const image = await safeRead(join(workspace, 'en-US/assets/test-image.png'));
for (const path of imagePaths) bytes.set(path, image);

// Validate actual Markdown links and definitions; examples inside code are not links.
const parser = unified().use(remarkParse);
function visit(node, action) {
  action(node);
  for (const child of node.children ?? []) visit(child, action);
}
for (const [path, content] of bytes) {
  if (!/\.(md|markdown)$/.test(path)) continue;
  const source = content.toString('utf8');
  visit(parser.parse(source), node => {
    if (!['link', 'image', 'definition'].includes(node.type)) return;
    const url = node.url;
    if (url.startsWith('object://')) {
      const match = /^object:\/\/([a-z]+)\/([0-9a-f]{6})$/.exec(url);
      const object = match && bytes.get(`.tano/objects/${match[2]}.tano.json`);
      if (!object || JSON.parse(object.toString('utf8')).type !== match[1]) throw new Error(`${path}: unresolved object ${url}`);
    } else if (!/^[a-z]+:|^#/i.test(url)) {
      const target = resolve(workspace, dirname(path), decodeURIComponent(url.split('#')[0]));
      const relative = target.slice(workspace.length + 1).replaceAll('\\', '/');
      if (!target.startsWith(workspace + '/') && !target.startsWith(workspace + '\\') || !bytes.has(relative))
        throw new Error(`${path}: missing fixture link ${url}`);
    }
  });
}

// Each demo has its own root, resources and object records. The physical workspace
// retains its bilingual navigation; compiled demos link only within their language.
const workspaces = {};
for (const [locale, directory, ids] of [
  ['zh-cn', 'zh-CN', ['e82f91', 'f82f91', '182f91', '282f91']],
  ['en-us', 'en-US', ['a82f91', 'b82f91', 'c82f91', 'd82f91']],
]) {
  const files = {};
  for (const [path, content] of bytes) {
    const localized = path.startsWith(`${directory}/`);
    if (!localized && !ids.some(id => path === `.tano/objects/${id}.tano.json`)) continue;
    let source = path.endsWith('.png') ? `data:image/png;base64,${content.toString('base64')}` : content.toString('utf8').replaceAll('\r\n', '\n');
    if (/\.(md|markdown)$/.test(path)) {
      source = source.replace(/^\[(?:English|简体中文)\]\([^\n]+?\) · (.+)$/gm,
        (_line, guide) => /\]\(\.\.\/开始使用\.md\)/.test(guide) ? '' : guide);
    }
    files[localized ? path.slice(directory.length + 1) : path] = source;
  }
  // Recheck links after flattening, including navigation and nested attachments.
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(md|markdown)$/.test(path)) continue;
    visit(parser.parse(source), node => {
      if (!['link', 'image', 'definition'].includes(node.type) || /^[a-z]+:|^#/i.test(node.url)) return;
      const target = resolve(workspace, dirname(path), decodeURIComponent(node.url.split('#')[0]));
      const relative = target.slice(workspace.length + 1).replaceAll('\\', '/');
      if (!Object.hasOwn(files, relative)) throw new Error(`${locale}/${path}: missing compiled demo link ${node.url}`);
    });
  }
  workspaces[locale] = files;
}
const generated = '// Generated by scripts/markdown-demo.mjs from Markdown fixtures. Do not edit directly.\n' +
  `export const markdownDemoWorkspaces: Record<'zh-cn' | 'en-us', Record<string, string>> = ${JSON.stringify(workspaces, null, 2)};\n`;
const output = join(root, 'packages/workbench/src/markdown-demo-content.ts');
const planned = [
  [output, Buffer.from(generated), true],
  ...imagePaths.map(path => [join(workspace, path), image, false]),
];
if (cloud) {
  const destination = join(cloud, 'Markdown-功能验收工作区');
  for (const [path, content] of bytes) planned.push([join(destination, path), content, false]);
}

const sha = value => createHash('sha256').update(value).digest('hex');
async function existing(path) {
  // Do not follow workspace symlinks when copying portable fixtures.
  let ancestor = path;
  while (ancestor !== dirname(ancestor)) {
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`Symlink destination: ${ancestor}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    ancestor = dirname(ancestor);
  }
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// Preflight the entire copy so an edited destination never gets silently replaced.
const changes = [];
for (const [path, content, generatedFile] of planned) {
  const base = await existing(path);
  if (base?.equals(content)) continue;
  if (check) throw new Error(`Fixture output is stale or missing: ${path}`);
  if (base && !generatedFile) throw new Error(`Existing fixture differs; preserve it before syncing: ${path}`);
  changes.push({ path, content, base: base && sha(base) });
}
for (const { path, content, base } of changes) {
  await mkdir(dirname(path), { recursive: true });
  const current = await existing(path);
  if ((current && sha(current)) !== base) throw new Error(`File changed during generation: ${path}`);
  await writeFile(path, content, { flag: base === null ? 'wx' : 'w' });
}
console.log(`Markdown QA: 11 documents per language; links and 8 object records verified. ${check ? 'Generated demo is current.' : `${changes.length} files written.`}`);
