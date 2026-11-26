import { refractor } from 'refractor';
export interface CodeToken { text: string; className: string }

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  rs: 'rust',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  htm: 'markup',
  html: 'markup',
  xml: 'markup',
  vue: 'markup',
  svelte: 'markup',
  ps1: 'powershell',
  jsonc: 'json',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  kt: 'kotlin',
  rb: 'ruby',
  conf: 'ini',
  cfg: 'ini',
  dockerfile: 'docker',
  makefile: 'makefile',
};

export function resolveCodeLanguage(extensionOrName: string): string {
  const lower = extensionOrName.trim().toLowerCase();
  if (!lower) return '';
  return LANGUAGE_ALIASES[lower] ?? lower;
}

/** Text nodes only: callers never need v-html for untrusted code. */
export function codePreviewTokens(text: string, extension: string): CodeToken[] {
  const language = resolveCodeLanguage(extension);
  if (text.length > 100000 || !language || !refractor.registered(language)) return [{ text, className: '' }];
  try {
    const result: CodeToken[] = [];
    const visit = (nodes: ReturnType<typeof refractor.highlight>['children'], inherited = '') => {
      for (const node of nodes) {
        if (node.type === 'text') result.push({ text: node.value, className: inherited });
        else if (node.type === 'element') visit(node.children, `${inherited} ${Array.isArray(node.properties.className) ? node.properties.className.join(' ') : ''}`.trim());
      }
    };
    visit(refractor.highlight(text, language).children);
    return result;
  } catch { return [{ text, className: '' }]; }
}
