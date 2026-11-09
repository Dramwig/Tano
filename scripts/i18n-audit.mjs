import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';

const han = /\p{Script=Han}/u;
const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = /(?:\.test\.[cm]?[jt]s$|(?:^|[/\\])(?:locales|assets|node_modules)(?:[/\\]|$))/;

export function inspectUiSource(code, file = 'source.vue') {
  const issues = [], keys = new Set(), literals = new Set();
  function inspectExpression(code, template = false, offset = 0) {
    const source = ts.createSourceFile('ui.ts', code, ts.ScriptTarget.Latest, true);
    function messageKeys(node) {
      if (ts.isStringLiteralLike(node)) keys.add(node.text);
      else if (ts.isConditionalExpression(node)) { messageKeys(node.whenTrue); messageKeys(node.whenFalse); }
      else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) messageKeys(node.expression);
      else if (ts.isElementAccessExpression(node)) messageKeys(node.expression);
      else if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) if (ts.isPropertyAssignment(property)) messageKeys(property.initializer);
      }
    }
    function visit(node, translated = false) {
      if (ts.isStringLiteralLike(node)) {
        literals.add(node.text);
        if (template && !translated && han.test(node.text)) issues.push({ kind: 'template', text: node.text, offset: offset + node.getStart(source) });
      }
      if (template && !translated && ts.isTemplateExpression(node) &&
          [node.head.text, ...node.templateSpans.map(span => span.literal.text)].some(text => han.test(text))) {
        issues.push({ kind: 'template', text: node.getText(source), offset: offset + node.getStart(source) });
      }
      if (ts.isCallExpression(node) && ['t', 'tp'].includes(node.expression.getText(source))) {
        const message = node.arguments[0];
        if (message) messageKeys(message);
        if (message && ts.isTemplateExpression(message) && [message.head.text, ...message.templateSpans.map(span => span.literal.text)].some(text => han.test(text))) issues.push({ kind: 'dynamic', text: message.getText(source), offset });
        node.arguments.forEach((argument, index) => visit(argument, index === 0 || translated));
        return;
      }
      ts.forEachChild(node, child => visit(child, translated));
    }
    visit(source);
  }
  if (file.endsWith('.vue')) {
    const { descriptor } = parse(code);
    for (const script of [descriptor.script, descriptor.scriptSetup]) if (script) inspectExpression(script.content, false, script.loc.start.offset);
    if (descriptor.template) {
      const start = descriptor.template.loc.start.offset;
      function visit(node) {
        if (node.type === NodeTypes.TEXT && han.test(node.content)) issues.push({ kind: 'template', text: node.content.trim(), offset: start + node.loc.start.offset });
        if (node.type === NodeTypes.INTERPOLATION) inspectExpression(node.content.content, true, start + node.content.loc.start.offset);
        if (node.type === NodeTypes.ELEMENT) for (const prop of node.props) {
          if (prop.type === NodeTypes.ATTRIBUTE && prop.name !== 'markdown' && prop.value && han.test(prop.value.content)) issues.push({ kind: 'template', text: prop.value.content, offset: start + prop.loc.start.offset });
          if (prop.type === NodeTypes.DIRECTIVE && prop.exp) inspectExpression(prop.exp.content, true, start + prop.exp.loc.start.offset);
        }
        let skip = false;
        for (const child of node.children ?? []) {
          if (child.type === NodeTypes.COMMENT && child.content.trim().startsWith('i18n-ignore:')) { skip = true; continue; }
          if (skip && child.type === NodeTypes.TEXT && !child.content.trim()) continue;
          if (!skip) visit(child);
          skip = false;
        }
      }
      visit(parseTemplate(descriptor.template.content));
    }
  } else inspectExpression(code);
  return { issues: issues.map(issue => ({ ...issue, file, line: code.slice(0, issue.offset).split('\n').length })), keys, literals };
}

export function auditI18n() {
  const keys = new Set(), literals = new Set(), issues = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (ignored.test(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|vue)$/.test(entry.name)) {
        const result = inspectUiSource(readFileSync(path, 'utf8'), relative(root, path).replaceAll('\\', '/'));
        result.keys.forEach(key => keys.add(key));
        result.literals.forEach(key => literals.add(key));
        issues.push(...result.issues);
      }
    }
  }
  for (const directory of ['packages/workbench/src', 'apps/client/src']) walk(resolve(root, directory));
  // Include shared labels and generated UI data when reporting possible dead keys.
  for (const directory of ['packages/editor/src', 'packages/protocol/src']) walk(resolve(root, directory));
  const english = readFileSync(resolve(root, 'packages/workbench/src/locales/en-US.ts'), 'utf8');
  const catalog = {};
  const catalogSource = ts.createSourceFile('en.ts', english, ts.ScriptTarget.Latest, true);
  function catalogKeys(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) catalog[node.name.text] = true;
    ts.forEachChild(node, catalogKeys);
  }
  catalogKeys(catalogSource);
  return { issues, missing: [...keys].filter(key => !(key in catalog)).sort(),
    unusedCandidates: Object.keys(catalog).filter(key => !literals.has(key)).sort(), usedKeys: keys.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditI18n();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const issue of result.issues) console.error(`${issue.file}:${issue.line}: ${issue.kind}: ${issue.text}`);
    for (const key of result.missing) console.error(`Missing message: ${key}`);
    console.log(`${result.usedKeys} literal keys; ${result.unusedCandidates.length} possible unused keys (inspect with --json; dynamic data may still use them).`);
  }
  if (result.issues.length || result.missing.length) process.exitCode = 1;
}
