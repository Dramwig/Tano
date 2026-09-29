import { hasUnsupportedHtml } from './text-style-markdown';
import { parsedWikiLinkCount, wikiLinkCandidates } from './wiki-link-markdown';
import { enhancedBody } from './enhanced-markdown';

/** Keep YAML bytes, delimiter spelling, quotes, comments and line endings intact. */
export function splitFrontmatter(markdown: string) {
  const match =
    /^(\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)(?:[\t ]*\r?\n)*)/.exec(markdown);
  return match
    ? { prefix: match[1]!, body: markdown.slice(match[1]!.length) }
    : { prefix: '', body: markdown };
}

export function unsupportedMarkdown(markdown: string): string[] {
  const { prefix, body: originalBody } = splitFrontmatter(markdown);
  const body = enhancedBody(originalBody);
  const issues: string[] = [];
  if (!prefix && /^\uFEFF?---\r?\n/.test(markdown)) issues.push('未闭合的 YAML 属性');
  if (/^\+\+\+\r?\n/.test(markdown)) issues.push('TOML 属性');
  if (/^(?:`{3,}|~{3,})\w+[\t ]+\S/m.test(body)) issues.push('代码块附加属性');
  const prose = body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[\t ]*$/gm, '')
    .replace(/(`+)[\s\S]*?\1/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\\\[[\s\S]*?\\\]/g, '')
    .replace(/\\\([^\n]*?\\\)/g, '')
    .replace(/(?<!\\)\$[^$\n]+\$/g, '');
  if (hasUnsupportedHtml(body)) issues.push('内嵌 HTML / MDX');
  if (/^\s*:::/m.test(prose)) issues.push('自定义指令块');
  const wikiCandidates = wikiLinkCandidates(prose);
  if (wikiCandidates && parsedWikiLinkCount(body) !== wikiCandidates)
    issues.push('尚不支持的双向链接写法');
  return issues;
}
