import { describe, expect, it } from 'vitest';
import { mergeMarkdown, headings, documentStats } from './index';

describe('Markdown three-way reconciliation', () => {
  it('merges independent human and agent changes', () => {
    expect(mergeMarkdown('A\nB\nC\n', 'A\nB\nC\nD\n', 'A\nX\nC\n')).toEqual({
      clean: true,
      content: 'A\nX\nC\nD\n',
    });
  });
  it('preserves the local branch on a conflict', () => {
    expect(mergeMarkdown('a\nb\n', 'a\nhuman\n', 'a\nagent\n')).toEqual({
      clean: false,
      content: 'a\nhuman\n',
    });
  });
  it('does not duplicate identical insertions', () => {
    expect(mergeMarkdown('a\nb\n', 'a\nx\nb\n', 'a\nx\nb\ny\n').content).toBe('a\nx\nb\ny\n');
  });
  it('treats different insertions at the same position as conflict', () => {
    expect(mergeMarkdown('a\n', 'x\na\n', 'y\na\n').clean).toBe(false);
  });
  it('merges deletion and an independent replacement', () => {
    expect(mergeMarkdown('a\nb\nc\nd\n', 'a\nc\nd\n', 'a\nb\nc\nD\n').content).toBe('a\nc\nD\n');
  });
  it('preserves CRLF and absent final newline', () => {
    expect(mergeMarkdown('a\r\nb\r\nc', 'A\r\nb\r\nc', 'a\r\nb\r\nC').content).toBe('A\r\nb\r\nC');
  });
  it('handles empty documents', () => {
    expect(mergeMarkdown('', '', 'agent').content).toBe('agent');
    expect(mergeMarkdown('', 'human', 'agent').clean).toBe(false);
  });
});

it('ignores fenced code headings in outline', () => {
  expect(headings('# Hello\n```md\n# Not a heading\n```\n## World').map((h) => h.text)).toEqual([
    'Hello',
    'World',
  ]);
});
it('counts Chinese and English words', () => {
  expect(documentStats('同页 hello world').words).toBe(4);
});
