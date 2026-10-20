import { expect, it } from 'vitest';
import { csvPreview, verifyPreviewBytes } from './file-preview';
import { codePreviewTokens } from '@tano/editor/code-preview';
it('parses quoted delimiters, multiline cells, BOM and TSV without executing formula cells', () => {
  expect(csvPreview('\uFEFFname,value\r\n"one,two","line\nnext"\r\n=CMD(),3', 'a.csv').rows).toEqual([
    ['name', 'value'], ['one,two', 'line\nnext'], ['=CMD()', '3'],
  ]);
  expect(csvPreview('a\tb\n1\t2', 'a.tsv').rows[1]).toEqual(['1', '2']);
  expect(csvPreview('"unclosed', 'a.csv').error).toBeTruthy();
  expect(csvPreview('a\n'.repeat(600), 'a.csv')).toMatchObject({ truncated: true });
});
it('checks signatures and produces inert highlighted text', () => {
  expect(() => verifyPreviewBytes(new TextEncoder().encode('<script>evil()</script>'), 'pdf', 'application/pdf')).toThrow();
  expect(() => verifyPreviewBytes(new TextEncoder().encode('<svg></svg>'), 'image', 'image/png')).toThrow();
  expect(() => verifyPreviewBytes(new TextEncoder().encode('%PDF-1.7'), 'pdf', 'application/pdf')).not.toThrow();
  const source = 'const value = "<script>evil()</script>";';
  const tokens = codePreviewTokens(source, 'js');
  expect(tokens.map(token => token.text).join('')).toBe(source);
  expect(tokens.some(token => token.className.includes('keyword'))).toBe(true);
});
