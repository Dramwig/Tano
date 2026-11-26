import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stylesDir = path.join(root, 'packages/workbench/src/styles');
const appearanceDir = path.join(stylesDir, 'appearance');
const stylesEntry = path.join(root, 'packages/workbench/src/styles.css');

const BACKDROP_MATERIALS = new Set(['axis-material-glass.css']);
const failures = [];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Parse top-level and nested CSS declarations along with their selector context.
 * Good enough for deterministic static ownership enforcement without external CSS parsers.
 */
function parseDeclarations(css) {
  const clean = stripComments(css);
  const decls = [];
  const stack = [];
  let token = '';
  let inString = null;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inString) {
      token += ch;
      if (ch === '\\' && i + 1 < clean.length) {
        token += clean[++i];
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      token += ch;
      continue;
    }
    if (ch === '{') {
      const header = token.trim();
      stack.push(header);
      token = '';
    } else if (ch === '}') {
      const rest = token.trim();
      if (rest) recordDeclaration(rest, stack, decls);
      stack.pop();
      token = '';
    } else if (ch === ';') {
      const stmt = token.trim();
      if (stmt && stack.length > 0) recordDeclaration(stmt, stack, decls);
      token = '';
    } else {
      token += ch;
    }
  }
  return decls;
}

function recordDeclaration(stmt, stack, out) {
  if (stmt.startsWith('@')) return;
  const colon = stmt.indexOf(':');
  if (colon === -1) return;
  const prop = stmt.slice(0, colon).trim().toLowerCase();
  const value = stmt.slice(colon + 1).trim();
  const selector = [...stack].reverse().find((item) => !item.startsWith('@')) ?? '';
  out.push({ prop, value, selector });
}

function hasLiteralNonZeroLength(value) {
  // Strip CSS var(...) and calc/max/min wrappers around var(--radius-*) so derived inner bevel radii pass.
  const withoutRadiusVars = value
    .replace(/max\(\s*0px\s*,\s*calc\(var\(--radius-[a-z-]+\)\s*-\s*1px\)\s*\)/gi, '0px')
    .replace(/var\(--[a-z0-9-]+\)/gi, '');
  // Match non-zero px/rem/em/% lengths
  const matches = withoutRadiusVars.match(/\b(\d*\.?\d+)(px|rem|em|%)\b/gi) ?? [];
  return matches.some((m) => parseFloat(m) !== 0);
}

// 1. Verify styles.css cascade layer declaration and axis imports.
const stylesEntryText = stripComments(fs.readFileSync(stylesEntry, 'utf8'));
const expectedLayerDecl = '@layer base, components, palette, surface-roles, layout, shape, material;';
if (!stylesEntryText.includes(expectedLayerDecl)) {
  failures.push(`styles.css: missing canonical cascade layer declaration "${expectedLayerDecl}"`);
}

const appearanceFiles = fs.readdirSync(appearanceDir).filter((f) => f.endsWith('.css')).sort();
for (const file of appearanceFiles) {
  const expectedLayer =
    file === 'tokens.css' ? 'base'
    : file === 'surface-roles.css' ? 'surface-roles'
    : file === 'axis-layout.css' ? 'layout'
    : file === 'axis-shape.css' ? 'shape'
    : file.startsWith('axis-material-') ? 'material'
    : null;
  if (!expectedLayer) {
    failures.push(`styles/appearance/${file}: unrecognized axis stylesheet naming convention`);
    continue;
  }
  const importPattern = new RegExp(`@import\\s+['"]\\./styles/appearance/${file.replace('.', '\\.')}['"]\\s+layer\\(${expectedLayer}\\)\\s*;`);
  if (!importPattern.test(stylesEntryText)) {
    failures.push(`styles.css: ${file} must be imported into layer(${expectedLayer})`);
  }
}

// 2. Forbid legacy [data-surface=...] selectors across all workbench stylesheets.
function walkCss(dir) {
  const res = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) res.push(...walkCss(full));
    else if (entry.name.endsWith('.css')) res.push(full);
  }
  return res;
}
for (const file of walkCss(stylesDir)) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  if (/\[data-surface\s*=/.test(text)) {
    failures.push(`${path.relative(root, file).replaceAll('\\', '/')}: legacy [data-surface=...] selector is forbidden in host CSS (use [data-material=...])`);
  }
}

// 3. Enforce Layout axis boundaries (axis-layout.css).
{
  const rel = 'packages/workbench/src/styles/appearance/axis-layout.css';
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  if (/\[data-color-theme/.test(text)) {
    failures.push(`${rel}: layout CSS must not special-case [data-color-theme]`);
  }
  if (/\[data-material/.test(text)) {
    failures.push(`${rel}: layout CSS must not special-case [data-material]`);
  }
  if (/--(?:desk-depth|layout-desk|island-desk)\b/.test(text)) {
    failures.push(`${rel}: layout CSS must not synthesize darkened desk colours (--desk-depth / --layout-desk / --island-desk); use var(--sidebar)`);
  }
  for (const { prop, value, selector } of parseDeclarations(text)) {
    if (prop === 'border-radius' && hasLiteralNonZeroLength(value)) {
      failures.push(`${rel}: hardcoded border-radius "${value}" on "${selector}" (must use 0 or var(--radius-*))`);
    }
    if (prop === 'border' && value !== '0' && value !== 'none' && !value.startsWith('var(--surface-')) {
      failures.push(`${rel}: literal border "${value}" on "${selector}" (must use 0, none, or var(--surface-*))`);
    }
    if (prop === 'box-shadow' && value !== 'none' && !value.startsWith('var(--surface-')) {
      failures.push(`${rel}: literal box-shadow "${value}" on "${selector}" (must use none or var(--surface-*))`);
    }
  }
}

// 4. Enforce Shape axis boundaries (axis-shape.css).
{
  const rel = 'packages/workbench/src/styles/appearance/axis-shape.css';
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  if (/\[data-material/.test(text) || /\[data-color-theme/.test(text)) {
    failures.push(`${rel}: shape CSS must not branch on [data-material] or [data-color-theme]`);
  }
  const allowedShapeProps = new Set([
    'border-radius', 'padding', 'padding-block', 'padding-inline',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'gap', 'row-gap', 'column-gap', 'min-height',
  ]);
  for (const { prop, selector } of parseDeclarations(text)) {
    if (!allowedShapeProps.has(prop)) {
      failures.push(`${rel}: forbidden non-geometry property "${prop}" on "${selector}"`);
    }
  }
}

// 5. Enforce Material axis boundaries (surface-only opaque vs backdrop-bearing translucent).
const paletteTokens = new Set([
  '--paper', '--sidebar', '--surface', '--surface-raised', '--hover',
  '--text', '--text-secondary', '--muted', '--line', '--line-strong',
  '--control-border', '--green', '--accent', '--selected', '--selected-text',
  '--backdrop',
]);
const workbenchLayerTokens = new Set([
  '--workbench-back', '--workbench-back-paint', '--workbench-sidebar', '--workbench-front',
]);
const typographyProps = new Set(['font-family', 'font-size', 'line-height', 'letter-spacing']);

for (const file of appearanceFiles.filter((f) => f.startsWith('axis-material-'))) {
  const rel = `packages/workbench/src/styles/appearance/${file}`;
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  const isBackdropMaterial = BACKDROP_MATERIALS.has(file);

  if (/\[data-color-theme/.test(text)) {
    failures.push(`${rel}: material CSS must not special-case [data-color-theme]`);
  }

  for (const { prop, value, selector } of parseDeclarations(text)) {
    if (typographyProps.has(prop)) {
      failures.push(`${rel}: material CSS must not set typography property "${prop}" on "${selector}"`);
    }
    if (prop === 'border-radius' && value !== 'inherit' && hasLiteralNonZeroLength(value)) {
      failures.push(`${rel}: material CSS must not hardcode border-radius "${value}" on "${selector}"`);
    }
    if (!isBackdropMaterial) {
      if (workbenchLayerTokens.has(prop)) {
        failures.push(`${rel}: opaque surface-only material must not override "${prop}" on "${selector}"`);
      }
      if (paletteTokens.has(prop)) {
        failures.push(`${rel}: opaque surface-only material must not override palette token "${prop}" on "${selector}"`);
      }
    } else {
      // Backdrop-bearing materials may adjust --muted / --text-secondary for contrast over images,
      // but never other palette primaries.
      if (paletteTokens.has(prop) && prop !== '--muted' && prop !== '--text-secondary') {
        failures.push(`${rel}: backdrop material must not override palette token "${prop}" on "${selector}"`);
      }
    }
  }
}

// 6. Verify dark-theme.css stays palette-only (no shadow overrides belonging to Material).
{
  const rel = 'packages/workbench/src/styles/dark-theme.css';
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  for (const { prop, selector } of parseDeclarations(text)) {
    if (prop === '--overlay-shadow' || prop === '--dialog-shadow') {
      failures.push(`${rel}: shadow token "${prop}" belongs to Material (axis-material-flat.css), not dark-theme.css`);
    }
  }
}

// 7. Verify the flat material baseline (tokens.css + axis-material-flat.css) keeps primary sheets,
//    document sheets and slip tabs cleanly borderless and shadowless so switching layouts never introduces borders.
const flatBorderlessSlots = new Set([
  '--surface-sheet-border',
  '--surface-document-border',
  '--surface-slip-tab-border',
]);
const flatShadowlessSlots = new Set([
  '--surface-sheet-shadow',
  '--surface-document-shadow',
  '--surface-slip-tab-shadow',
]);
for (const rel of [
  'packages/workbench/src/styles/appearance/tokens.css',
  'packages/workbench/src/styles/appearance/axis-material-flat.css',
]) {
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  for (const { prop, value, selector } of parseDeclarations(text)) {
    if (flatBorderlessSlots.has(prop) && value !== '0' && value !== 'none' && value !== '0px solid transparent') {
      failures.push(`${rel}: flat baseline "${prop}" must stay borderless (got "${value}" on "${selector}")`);
    }
    if (flatShadowlessSlots.has(prop) && value !== 'none') {
      failures.push(`${rel}: flat baseline "${prop}" must stay "none" (got "${value}" on "${selector}")`);
    }
    if (prop === '--surface-hairline' && /color-mix\([^)]*--text\b/i.test(value)) {
      failures.push(`${rel}: flat baseline "--surface-hairline" must not mix --text (got "${value}" on "${selector}")`);
    }
  }
}

if (failures.length > 0) {
  console.error('Appearance axis ownership violations found:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

console.log(`Appearance axis check passed (${appearanceFiles.length} axis modules verified).`);
