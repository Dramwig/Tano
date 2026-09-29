import { describe, expect, it } from 'vitest';
import { frontmatterProperties, frontmatterValue, removeFrontmatterProperty, updateFrontmatterProperty } from './frontmatter-display';

describe('frontmatter property display', () => {
  it('reads YAML values without exposing comments or changing source text', () => {
    const source =
      '---\r\ntitle: "同页" # comment\r\ntags: [agent, human]\r\ncreated: 2026/05/11\r\n...\r\n';
    expect(frontmatterProperties(source)).toEqual([
      { name: 'title', value: '同页', kind: 'text' },
      { name: 'tags', value: 'agent、human', kind: 'list' },
      { name: 'created', value: '2026/05/11', kind: 'date' },
    ]);
  });

  it('keeps numeric property names in YAML source order', () => {
    expect(frontmatterProperties('---\nwww: text\n"1": ""\n---\n')?.map((property) => property.name)).toEqual(['www', '1']);
  });

  it('falls back to the original YAML for malformed or non-mapping content', () => {
    expect(frontmatterProperties('---\nkey: [unfinished\n---\n')).toBeNull();
    expect(frontmatterProperties('---\n- first\n- second\n---\n')).toBeNull();
  });
});

describe('frontmatter property editing', () => {
  const source = '---\r\ntitle: "同页" # keep\r\ntags: [agent, human]\r\ndescription: |\r\n  first\r\n  second\r\nnested: {owner: test, score: 100}\r\n...\r\n\r\n# Body\r\n';

  it('changes one scalar while preserving unrelated YAML bytes and the body', () => {
    expect(updateFrontmatterProperty(source, 'title', 'title', 'text', '新标题')).toBe(
      source.replace('title: "同页" # keep', 'title: 新标题 # keep'),
    );
  });

  it('edits lists, objects and multiline values as typed YAML', () => {
    const tags = updateFrontmatterProperty(source, 'tags', 'tags', 'list', '["Markdown", "中文"]');
    expect(frontmatterProperties(tags.slice(0, tags.indexOf('# Body')))?.find((item) => item.name === 'tags')?.value).toBe('Markdown、中文');
    expect(tags).toContain('nested: {owner: test, score: 100}\r\n');
    const nested = updateFrontmatterProperty(source, 'nested', 'nested', 'object', '{"owner":"测试者","score":101}');
    expect(frontmatterProperties(nested.slice(0, nested.indexOf('# Body')))?.find((item) => item.name === 'nested')?.value).toBe('{"owner":"测试者","score":101}');
    const description = updateFrontmatterProperty(source, 'description', 'description', 'text', '第一行\n第二行');
    expect(description).toContain('description: |-\r\n  第一行\r\n  第二行\r\n');
  });

  it('adds, renames and removes properties without changing the body', () => {
    const added = updateFrontmatterProperty('# Body\n', null, 'enabled', 'boolean', 'true');
    expect(added).toBe('---\nenabled: true\n---\n# Body\n');
    const renamed = updateFrontmatterProperty(source, 'title', 'heading', 'text', '同页');
    expect(renamed).toContain('"heading": 同页 # keep');
    const removed = removeFrontmatterProperty(source, 'tags');
    expect(removed).not.toContain('tags:');
    expect(removed).toContain('description: |\r\n');
    expect(removed.endsWith('# Body\r\n')).toBe(true);
  });

  it('rejects invalid values and duplicate names', () => {
    expect(() => updateFrontmatterProperty(source, 'title', 'tags', 'text', 'x')).toThrow('属性名已存在');
    expect(() => updateFrontmatterProperty(source, 'tags', 'tags', 'list', 'not JSON')).toThrow('请输入有效 JSON');
    expect(() => updateFrontmatterProperty(source, 'title', 'title', 'number', 'abc')).toThrow('请输入有效数字');
  });

  it('round-trips dates and date times as editable property types', () => {
    const dated = updateFrontmatterProperty(source, 'title', 'title', 'date', '2026-09-26');
    expect(frontmatterValue(dated.slice(0, dated.indexOf('# Body')), 'title')).toEqual({
      kind: 'date', value: '2026-09-26',
    });
    const timed = updateFrontmatterProperty(source, 'title', 'title', 'datetime', '2026-09-26T10:30');
    expect(frontmatterValue(timed.slice(0, timed.indexOf('# Body')), 'title')).toEqual({
      kind: 'datetime', value: '2026-09-26T10:30',
    });
    const withOffset = updateFrontmatterProperty(source, 'title', 'title', 'datetime', '2026-09-26T10:30:00+08:00');
    expect(frontmatterValue(withOffset.slice(0, withOffset.indexOf('# Body')), 'title')).toEqual({
      kind: 'datetime', value: '2026-09-26T10:30:00+08:00',
    });
    const text = updateFrontmatterProperty(dated, 'title', 'title', 'text', '2026-09-26');
    expect(text).toContain('title: "2026-09-26" # keep');
    expect(frontmatterValue(text.slice(0, text.indexOf('# Body')), 'title')).toEqual({
      kind: 'text', value: '2026-09-26',
    });
    expect(() => updateFrontmatterProperty(source, 'title', 'title', 'date', 'not a date')).toThrow('请输入有效日期');
    expect(() => updateFrontmatterProperty(source, 'title', 'title', 'date', '2026-02-30')).toThrow('请输入有效日期');
  });
});
