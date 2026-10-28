import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { expect, it } from 'vitest';
import { englishMessages } from './locales/en-US';
import { blockTypes, inlineTypes } from '@tano/editor/selection-context';
import { featureDefinitions, selectionWrappingOptions } from '@tano/editor/runtime';
import { dataFieldTypes } from '@tano/protocol';

it('covers UI message calls, shared editor labels and interpolation parameters', () => {
  const missing = new Set<string>();
  const directory = fileURLToPath(new URL('.', import.meta.url));
  function inspect(code: string) {
    const source = ts.createSourceFile('ui.ts', code, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!(key in englishMessages)) missing.add(key);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'assets' || entry.name === 'locales') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.vue')) {
        const { descriptor } = parse(readFileSync(path, 'utf8'));
        if (descriptor.scriptSetup) inspect(descriptor.scriptSetup.content);
        // Literal message calls are valid expressions even inside template markup.
        for (const match of descriptor.template?.content.matchAll(/\bt\(('(?:[^'\\]|\\.)*')/g) ?? []) inspect(`t(${match[1]})`);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) inspect(readFileSync(path, 'utf8'));
    }
  }
  walk(directory);
  for (const item of [...blockTypes, ...inlineTypes, ...featureDefinitions, ...selectionWrappingOptions])
    if (!(item.label in englishMessages)) missing.add(item.label);
  for (const label of Object.values(dataFieldTypes)) if (!(label in englishMessages)) missing.add(label);
  for (const option of selectionWrappingOptions) if (!(option.example in englishMessages)) missing.add(option.example);
  expect([...missing]).toEqual([]);
  const parameters = (value: string) => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const [source, translated] of Object.entries(englishMessages))
    expect(parameters(translated), source).toEqual(parameters(source));
}, 15000); // This parses the complete, growing workbench source tree rather than one fixture.
