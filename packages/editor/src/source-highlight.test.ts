import { describe, expect, it } from 'vitest';
import { sourceStyleRanges } from './source-highlight';

function styled(markdown: string, style: string) {
  return sourceStyleRanges(markdown)
    .filter((range) => range.style === style)
    .map((range) => markdown.slice(range.from, range.to));
}

describe('source Markdown styling', () => {
  it('uses the same extension syntax and offsets as the rich editor', () => {
    const text = '==普通 **粗体**== ~下标~ ^上标^ ++下划线++ %%注释%%';
    expect(styled(text, 'highlight')).toEqual(['==普通 **粗体**==']);
    expect(styled(text, 'strong')).toEqual(['**粗体**']);
    expect(styled(text, 'subscript')).toEqual(['~下标~']);
    expect(styled(text, 'delete')).toEqual([]);
    expect(styled(text, 'inline_comment')).toEqual(['%%注释%%']);
  });
  it('styles delimiters together with formatted text, including nested marks', () => {
    const text = '**123 *abc*** and ~~old~~ and `**literal**`';
    expect(styled(text, 'strong')).toEqual(['**123 *abc***']);
    expect(styled(text, 'emphasis')).toEqual(['*abc*']);
    expect(styled(text, 'delete')).toEqual(['~~old~~']);
    expect(styled(text, 'code')).toEqual(['`**literal**`']);
  });

  it('keeps source offsets after frontmatter and skips escaped syntax', () => {
    const text = '---\ntitle: Note\n---\n# Heading\n\\**plain** and [link](target.md)';
    expect(styled(text, 'frontmatter')).toEqual(['---\ntitle: Note\n---\n']);
    expect(styled(text, 'heading')).toEqual(['# Heading']);
    expect(styled(text, 'strong')).toEqual([]);
    expect(styled(text, 'link')).toEqual(['[link](target.md)']);
  });

  it('assigns a distinct source style to each heading level', () => {
    const text = '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n`# code`';
    for (const [level, title] of ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].entries()) {
      expect(styled(text, `heading-${level + 1}`)).toEqual([`${'#'.repeat(level + 1)} ${title}`]);
    }
  });
});
