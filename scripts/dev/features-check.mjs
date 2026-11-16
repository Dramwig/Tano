// SPDX-License-Identifier: MIT
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseDefinitions(source) {
  const file = ts.createSourceFile('features.ts', source, ts.ScriptTarget.Latest, true);
  const definitions = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'features') {
      const object = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
      if (!object || !ts.isObjectLiteralExpression(object))
        throw Error('features must be a literal registry');
      for (const prop of object.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer))
          throw Error('Invalid feature definition');
        const id = prop.name.text;
        const values = Object.fromEntries(
          prop.initializer.properties.map((p) => {
            if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.initializer))
              throw Error('Use literal status and note');
            return [p.name.text, p.initializer.text];
          }),
        );
        if (
          Object.hasOwn(definitions, id) ||
          !['dev', 'stable'].includes(values.status) ||
          !values.note?.trim()
        )
          throw Error(`Invalid feature: ${id}`);
        definitions[id] = values;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return definitions;
}
export function scanReferences(source) {
  // Vue templates and scripts share the same literal call convention.
  return [
    ...source.matchAll(/\b(?:isFeatureEnabled|requireFeature)\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g),
  ].map((m) => m[2]);
}
export function compareReferences(definitions, references) {
  const used = new Set(references);
  return [...used]
    .filter((id) => !Object.hasOwn(definitions, id))
    .map((id) => `Unregistered feature: ${id}`)
    .concat(
      Object.keys(definitions)
        .filter((id) => !used.has(id))
        .map((id) => `Unused feature: ${id}`),
    );
}
export function unsafeChannel(source) {
  return /(?:VITE_TANO_CHANNEL|TANO_CHANNEL)["']?\s*[:=]\s*["']?dev\b/.test(source);
}
export function formatDevFeatures(definitions) {
  const entries = Object.entries(definitions).filter(([, value]) => value.status === 'dev');
  return entries.length
    ? entries.map(([id, value]) => `- ${id}: ${value.note}`).join('\n')
    : '- 无';
}
export function checkFeatures(root, registry = 'packages/workbench/src/features.ts') {
  const definitions = parseDefinitions(readFileSync(resolve(root, registry), 'utf8'));
  const references = [],
    errors = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        ['node_modules', '.git', 'dist', 'target', 'vendor', 'artifacts', 'coverage'].includes(
          entry.name,
        )
      )
        continue;
      const path = resolve(dir, entry.name),
        name = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const sourceFile =
        /\.(?:ts|tsx|js|mjs|vue)$/.test(name) &&
        !/\.(?:test|spec)\./.test(name) &&
        /^(apps|packages)\//.test(name);
      const releaseFile =
        name.startsWith('.github/workflows/') ||
        basename(name).startsWith('.env') ||
        /^apps\/client\/src-tauri\/tauri\.conf/.test(name) ||
        name.endsWith('package.json') ||
        /^scripts\/(?:release|build|deploy)\//.test(name);
      if (!sourceFile && !releaseFile) continue;
      const source = readFileSync(path, 'utf8');
      if (sourceFile) references.push(...scanReferences(source));
      if (releaseFile) {
        const text = name.endsWith('package.json')
          ? Object.entries(JSON.parse(source).scripts ?? {})
              .filter(([key]) => !/(?:^|:)dev$/.test(key))
              .map(([, value]) => value)
              .join('\n')
          : source;
        if (unsafeChannel(text))
          errors.push(`Development channel in release configuration: ${name}`);
      }
    }
  }
  walk(root);
  errors.push(...compareReferences(definitions, references));
  if (errors.length) throw Error(errors.join('\n'));
  return definitions;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(formatDevFeatures(checkFeatures(process.cwd(), process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
