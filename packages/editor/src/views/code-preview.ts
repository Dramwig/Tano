import { refractor } from 'refractor';
export interface CodeToken { text: string; className: string }
/** Text nodes only: callers never need v-html for untrusted code. */
export function codePreviewTokens(text: string, extension: string): CodeToken[] {
  const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', rs: 'rust', yml: 'yaml', sh: 'bash', htm: 'markup', html: 'markup', xml: 'markup', vue: 'markup', ps1: 'powershell' };
  const language = aliases[extension] ?? extension;
  if (text.length > 100000 || !refractor.registered(language)) return [{ text, className: '' }];
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
