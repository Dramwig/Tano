export type PageTitleSource = 'filename' | 'frontmatter' | 'frontmatter-first';

export function parsePageTitleSource(value: unknown): PageTitleSource {
  return value === 'filename' || value === 'frontmatter' || value === 'frontmatter-first'
    ? value : 'frontmatter-first';
}
