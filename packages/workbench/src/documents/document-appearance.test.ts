import { expect, it } from 'vitest';
import { appearanceProperty, appearanceText, updateAppearance } from './document-appearance';

it('adds and removes appearance fields without changing the title, body, or other YAML properties', () => {
  const source = '---\r\ntitle: 标题 # keep\r\ntags: [note, draft]\r\n...\r\n\r\n# 正文\r\n';
  const withIcon = updateAppearance(source, 'icon', '🌿', null);
  const withCover = updateAppearance(withIcon, 'cover', 'tano:mist', null);
  expect(appearanceText(withCover, 'icon')).toBe('🌿');
  expect(appearanceText(withCover, 'cover')).toBe('tano:mist');
  expect(withCover).toContain('title: 标题 # keep\r\ntags: [note, draft]\r\n');
  expect(withCover).toContain('...\r\n\r\n# 正文\r\n');
  const removed = updateAppearance(withCover, 'icon', '', appearanceProperty(withCover, 'icon'));
  expect(appearanceProperty(removed, 'icon')).toBeNull();
  expect(updateAppearance(removed, 'cover', '', appearanceProperty(removed, 'cover'))).toBe(source);
});

it('merges independent edits made while the picker is open, but rejects a changed appearance field', () => {
  const original = '---\nicon: 🌿\n---\n正文\n';
  const previous = appearanceProperty(original, 'icon');
  const edited = '---\nicon: 🌿\ncover: tano:sky\n---\n新正文\n';
  expect(updateAppearance(edited, 'icon', 'icon:book', previous)).toBe('---\nicon: icon:book\ncover: tano:sky\n---\n新正文\n');
  expect(() => updateAppearance(edited.replace('🌿', '🚀'), 'icon', 'icon:book', previous)).toThrow('图标已被修改');
});

it.each(['---\nicon: 未闭合\n', '---\nicon: [unfinished\n---\n正文\n', '+++\nicon = "TOML"\n+++\n正文\n'])
('does not overwrite malformed or unsupported metadata: %j', source => {
  expect(() => updateAppearance(source, 'icon', '🌿', null)).toThrow();
});

it('creates readable YAML for a document without metadata and ignores non-text appearance values', () => {
  const source = '# 正文\n';
  const updated = updateAppearance(source, 'icon', 'icon:book', null);
  expect(updated).toBe('---\nicon: icon:book\n---\n# 正文\n');
  expect(appearanceText('---\nicon: [one, two]\n---\n', 'icon')).toBe('');
});
