import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forbidden = new Set([
  '@tano/server',
  '@tano/sync',
  '@tano/cloud-contracts',
  '@tano/cloud-runtime',
  '@tano/cloud-ui',
  '@tano/collaboration',
  '@hocuspocus/provider',
  '@hocuspocus/server',
  '@milkdown/plugin-collab',
  'yjs',
  'y-prosemirror',
  'y-protocols',
]);

const workspaceDag = new Map([
  ['packages/protocol', new Set()],
  ['packages/markdown', new Set(['@tano/protocol'])],
  ['packages/editor', new Set(['@tano/protocol', '@tano/markdown'])],
  ['packages/workbench', new Set(['@tano/protocol', '@tano/markdown', '@tano/editor'])],
  ['apps/client', new Set(['@tano/protocol', '@tano/markdown', '@tano/editor', '@tano/workbench'])],
  ['apps/mcp', new Set(['@tano/protocol'])],
]);

const ignoredDirs = new Set(['node_modules', 'target', 'dist', 'gen', '.git', 'assets-src']);
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? ignoredDirs.has(entry.name)
            ? []
            : walk(path.join(dir, entry.name))
          : [path.join(dir, entry.name)],
      )
    : [];

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function isBareSpecifier(specifier) {
  return (
    !!specifier &&
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('http:') &&
    !specifier.startsWith('https:') &&
    !specifier.startsWith('data:') &&
    !specifier.startsWith('virtual:')
  );
}

function extractScriptBlocks(filePath, text) {
  if (!filePath.endsWith('.vue')) return [text];
  const blocks = [];
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) blocks.push(match[1]);
  return blocks;
}

function collectModuleSpecifiers(filePath, text) {
  const results = [];
  if (filePath.endsWith('.css')) {
    for (const match of text.matchAll(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1/g)) {
      results.push({ specifier: match[2], typeOnly: false });
    }
    return results;
  }
  for (const block of extractScriptBlocks(filePath, text)) {
    const source = ts.createSourceFile(filePath, block, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        results.push({
          specifier: node.moduleSpecifier.text,
          typeOnly: Boolean(node.importClause?.isTypeOnly),
        });
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        results.push({
          specifier: node.moduleSpecifier.text,
          typeOnly: Boolean(node.isTypeOnly),
        });
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        results.push({ specifier: node.arguments[0].text, typeOnly: false });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return results;
}

const failures = [];

// 1. Public-vs-private cloud boundary across apps, packages, crates.
for (const folder of ['apps', 'packages', 'crates']) {
  for (const f of walk(path.join(root, folder))) {
    const relative = path.relative(root, f).replaceAll('\\', '/');
    if (path.basename(f) === 'package.json') {
      const p = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const dep of Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies })) {
        if (forbidden.has(dep)) failures.push(`${relative}: private dependency ${dep}`);
      }
    }
    if (/\.(ts|vue|mjs)$/.test(f)) {
      const text = fs.readFileSync(f, 'utf8');
      const source = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
      const inspect = (n) => {
        if (ts.isStringLiteralLike(n)) {
          for (const dep of forbidden) {
            if (n.text === dep || n.text.startsWith(dep + '/')) failures.push(`${relative}: private module ${n.text}`);
          }
        }
        ts.forEachChild(n, inspect);
      };
      inspect(source);
      for (const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g)) {
        for (const dep of forbidden) {
          if (match[2] === dep || match[2].startsWith(dep + '/')) failures.push(`${relative}: private import ${match[2]}`);
        }
      }
    }
    if (path.basename(f) === 'Cargo.toml' && /tano-cloud|sync_storage/.test(fs.readFileSync(f, 'utf8'))) {
      failures.push(`${relative}: private native dependency`);
    }
  }
}

for (const p of [
  'apps/server',
  'packages/sync',
  'deploy',
  'compose.yaml',
  'compose.https.yaml',
  'packages/workbench/src/chat.ts',
  'packages/workbench/src/stores/chat.ts',
  'packages/workbench/src/components/ChatView.vue',
  'packages/workbench/src/components/SidebarChat.vue',
  'packages/workbench/src/components/ChatCreateDialog.vue',
]) {
  if (fs.existsSync(path.join(root, p))) failures.push(`Private product path: ${p}`);
}

// 2. Internal package DAG, phantom runtime dependencies, and protocol barrel cycle guard.
for (const [pkgRel, allowedInternal] of workspaceDag) {
  const pkgDir = path.join(root, pkgRel);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const declaredRuntime = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);

  for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (dep.startsWith('@tano/') && !allowedInternal.has(dep)) {
      failures.push(`${pkgRel}/package.json: disallowed internal dependency ${dep}`);
    }
  }

  if (pkgRel.startsWith('packages/') && manifest.exports && typeof manifest.exports === 'object') {
    for (const [exportKey, exportTarget] of Object.entries(manifest.exports)) {
      if (exportKey.includes('*')) {
        failures.push(`${pkgRel}/package.json: wildcard export "${exportKey}" is forbidden; declare explicit subpaths`);
      }
      if (typeof exportTarget === 'string' && !exportTarget.includes('*')) {
        const resolved = path.resolve(pkgDir, exportTarget);
        if (!fs.existsSync(resolved)) {
          failures.push(`${pkgRel}/package.json: export "${exportKey}" target does not exist (${exportTarget})`);
        }
      }
    }
  }

  for (const f of walk(path.join(pkgDir, 'src'))) {
    if (/\.(test|spec)(\.[^/\\]+)?\.(ts|tsx|mjs|js)$/.test(f)) continue;
    if (!/\.(ts|vue|mjs|css)$/.test(f)) continue;
    const relative = path.relative(root, f).replaceAll('\\', '/');
    const text = fs.readFileSync(f, 'utf8');
    for (const { specifier, typeOnly } of collectModuleSpecifiers(f, text)) {
      if (pkgRel === 'packages/protocol' && path.basename(f) !== 'index.ts' && (specifier === './index' || specifier === './index.ts')) {
        failures.push(`${relative}: internal protocol module must not import barrel ./index`);
      }
      if (!isBareSpecifier(specifier)) continue;
      const dep = packageName(specifier);
      if (dep.startsWith('@tano/') && !allowedInternal.has(dep)) {
        failures.push(`${relative}: disallowed internal import ${specifier}`);
      }
      if (!typeOnly && !declaredRuntime.has(dep)) {
        failures.push(`${relative}: undeclared runtime dependency ${dep} (from ${specifier})`);
      }
      if (pkgRel === 'packages/workbench' && dep.startsWith('@tauri-apps/') && relative !== 'packages/workbench/src/platform/native-bridge.ts') {
        failures.push(`${relative}: direct Tauri import ${specifier} must go through platform/native-bridge.ts`);
      }
      if (pkgRel === 'apps/client' && specifier.startsWith('@tano/workbench/components/')) {
        failures.push(`${relative}: use explicit @tano/workbench export instead of internal path ${specifier}`);
      }
    }
  }
}

// 3. Workbench stores static import cycle guard (both runtime and type-only imports).
const storesDir = path.join(root, 'packages/workbench/src/stores');
if (fs.existsSync(storesDir)) {
  const storeFiles = fs
    .readdirSync(storesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name))
    .map((entry) => path.join(storesDir, entry.name));
  const storeFileSet = new Set(storeFiles);
  const storeGraph = new Map();
  for (const f of storeFiles) {
    const deps = new Set();
    const text = fs.readFileSync(f, 'utf8');
    for (const { specifier } of collectModuleSpecifiers(f, text)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      const base = path.resolve(path.dirname(f), specifier);
      const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
      const hit = candidates.find((candidate) => storeFileSet.has(candidate));
      if (hit) deps.add(hit);
    }
    storeGraph.set(f, [...deps].sort());
  }

  const state = new Map(); // 0/undefined = unvisited, 1 = visiting, 2 = visited
  const stack = [];
  const visitStore = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of storeGraph.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) {
        const start = stack.indexOf(next);
        const chain = [...stack.slice(start), next]
          .map((item) => path.relative(storesDir, item).replaceAll('\\', '/'))
          .join(' -> ');
        failures.push(`packages/workbench/src/stores: cyclic import detected (${chain})`);
      } else if (nextState === 0) {
        visitStore(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const f of storeFiles.sort()) {
    if ((state.get(f) ?? 0) === 0) visitStore(f);
  }
}

if (failures.length) throw new Error([...new Set(failures)].join('\n'));
console.log('Public, DAG, explicit-exports, phantom-dependency, store-acyclic, and protocol-barrel boundaries verified.');
