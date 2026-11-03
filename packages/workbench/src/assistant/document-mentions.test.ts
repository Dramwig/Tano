import { expect, it } from 'vitest';
import { documentMentionEvents } from './document-mentions';
import { createHeadlessMarkdown } from '@tano/editor/headless';

const link = (id = 'mention-0001') => `[@审阅员](object://person/a00001 "tano:mention:${id}")`;
it('round-trips stable mention IDs through rich Markdown and provides visible comment anchors', async () => {
  const parser = await createHeadlessMarkdown();
  try {
    const content = `# 标题\n\n${link()} 请检查\n`;
    const normalized = parser.normalize(content);
    expect(normalized).toContain('tano:mention:mention-0001');
    expect(documentMentionEvents('workspace', 'f00001', normalized, 'hash', 'user', 1)).toHaveLength(1);
    const anchor = parser.mentionAnchors(normalized, 'hash').get('mention-0001')!;
    expect(anchor.basis).toBe('prose');
    expect(anchor.spans[0].text).toContain('请检查');
    expect(parser.projectComments(normalized).slice(anchor.spans[0].from, anchor.spans[0].to)).toBe(anchor.spans[0].text);
  } finally { await parser.destroy(); }
});
it('keeps occurrence identity when a paragraph moves and distinguishes multiple requests', () => {
  const content = `${link()} 检查这一段\n\n${link('mention-0002')} 检查另一段`;
  const first = documentMentionEvents('workspace', 'f00001', content, 'first', 'user', 1);
  const next = documentMentionEvents('workspace', 'f00001', `# 新标题\n\n${content}`, 'second', 'user', 2);
  expect(first).toHaveLength(2);
  expect(first.map(item => item.id)).toEqual(next.map(item => item.id));
  expect(first[0].id).not.toBe(first[1].id);
  const span = next[0].source.anchor!.spans[0];
  expect(`# 新标题\n\n${content}`.slice(span.from, span.to)).toBe(span.text);
});

it('excludes code, metadata, images, ordinary links and duplicate copied identities', () => {
  const content = `---\nexample: '${link()}'\n---\n\n\`${link()}\`\n\n\`\`\`md\n${link()}\n\`\`\`\n\n!${link()}\n\n[@普通引用](object://person/a00001)\n\n${link()} 请求\n\n${link()} 副本`;
  const events = documentMentionEvents('workspace', 'f00001', content, 'hash', 'user', 1);
  expect(events).toHaveLength(1);
  expect(events[0].body).toContain('请求');
});

it('dispatches annotated identity references once and ignores plain references and code', () => {
  const ref = '[[object://person/a00001]]<!--tano:mention:mention-0001-->';
  const content = `Review ${ref}\n\n${ref}\n\n[[object://person/a00001]]\n\n\`${ref}\``;
  const events = documentMentionEvents('ws', 'b00002', content, 'hash', 'actor', 1);
  expect(events).toHaveLength(1);
  expect(events[0]?.personId).toBe('a00001');
  expect(events[0]?.source.mentionId).toBe('mention-0001');
});
