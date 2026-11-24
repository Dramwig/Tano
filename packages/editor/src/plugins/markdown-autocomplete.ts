export const markdownAutocompleteOptions = [
 { key: 'listContinuation', label: '列表与引用续行', input: '- 项目 ⏎', output: '- ', enabled: true },
 { key: 'fenceClosing', label: '补全代码块与公式块', input: '``` ⏎', output: '```  ```', enabled: true },
 { key: 'bracketPairs', label: '成对符号自动闭合', input: '(', output: '()', enabled: false },
] as const;
export type MarkdownAutocompletePreferences = Record<(typeof markdownAutocompleteOptions)[number]['key'], boolean>;
export const defaultMarkdownAutocomplete = Object.fromEntries(markdownAutocompleteOptions.map(o => [o.key, o.enabled])) as MarkdownAutocompletePreferences;
export function normalizeMarkdownAutocomplete(value?: unknown): MarkdownAutocompletePreferences {
 const result = { ...defaultMarkdownAutocomplete };
 if (value && typeof value === 'object') for (const {key} of markdownAutocompleteOptions) {
  const enabled = (value as Record<string, unknown>)[key];
  if (typeof enabled === 'boolean') result[key] = enabled;
 }
 return result;
}
export interface MarkupEdit { from: number; to: number; insert: string; cursor: number }
export function continueMarkup(line: string, column: number, context: { blocked?: boolean; previousLines?: string[]; backspace?: boolean } = {}): MarkupEdit | null {
 if (context.blocked) return null;
 const m = line.match(/^([ \t]*)((?:> ?)*)(?:([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?)?/);
 if (!m || (!m[2] && !m[3]) || column < m[0].length) return null;
 const prefix = m[0], base = m[1]! + m[2]!, marker = m[3];
 if (!line.slice(prefix.length).trim() && column === line.length) {
  if (context.backspace) return marker ? { from: base.length, to: line.length, insert: '', cursor: base.length } : null;
  let insert = marker ? base : '';
  if (marker && m[1]) {
   const parent = [...(context.previousLines ?? [])].reverse().map(l => l.match(/^([ \t]*)(?:> ?)*(?:[-*+]|\d{1,9}[.)])\s/)).find(p => p && p[1]!.length < m[1]!.length);
   insert = (parent?.[1] ?? '') + m[2] + line.slice(base.length);
  }
  return { from: 0, to: line.length, insert, cursor: insert.length };
 }
 if (context.backspace) return null;
 const next = marker?.match(/^(\d+)([.)])$/);
 const continuation = base + (marker ? (next ? String(Number(next[1]) + 1) + next[2] : marker) + m[4] + (m[5] ? '[ ] ' : '') : '');
 const spaces = line.slice(column).match(/^ */)![0].length;
 return { from: column, to: column + spaces, insert: '\n' + continuation, cursor: column + 1 + continuation.length };
}
export function closeMarkupFence(source: string, lineStart: number, math: boolean): { insert: string; cursor: number } | null {
 let offset = 0, active: { token: string; start: number; indent: string } | null = null;
 const lines = source.split('\n');
 let frontmatter = lines[0] === '---';
 for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  if (frontmatter) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false; offset += line.length + 1; continue; }
  if (active) {
   const trimmed = line.trim();
   if (/^ {0,3}\S/.test(line) && (active.token === '$$' ? trimmed === '$$' : trimmed[0] === active.token[0] && trimmed.length >= active.token.length && [...trimmed].every(c => c === active!.token[0]))) active = null;
  } else {
   const m = line.match(/^( {0,3})(`{3,}|~{3,})([^`]*)$/);
   if (m) active = { token: m[2]!, indent: m[1]!, start: offset };
   else if (math && /^ {0,3}\$\$\s*$/.test(line)) active = { token: '$$', indent: line.match(/^ */)![0], start: offset };
  }
  offset += line.length + 1;
 }
 if (!active || active.start !== lineStart) return null;
 return { insert: '\n' + active.indent + '\n' + active.indent + active.token, cursor: 1 + active.indent.length };
}
export function closingBracket(before: string, after: string, typed: string): string | null {
 if (after && !/^[\s)\]}>.,;:!?，。；：！？、]/.test(after)) return null;
 if (typed === '`' && (before.endsWith('`') || /^[\s`]*$/.test(before))) return null;
 return ({ '(': ')', '[': ']', '`': '`' } as Record<string, string>)[typed] ?? null;
}
