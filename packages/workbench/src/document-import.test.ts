// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importName, prepareImport } from './document-import';

function file(name: string, source: string | Uint8Array) {
  const bytes = typeof source === 'string' ? strToU8(source) : source;
  const value = new File([bytes as Uint8Array<ArrayBuffer>], name);
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return value;
}

it('preserves Markdown, decodes UTF-16, parses quoted CSV, and sanitizes HTML', async () => {
  const result = await prepareImport([
    file('note.md', '# Note\r\n\r\n- [ ] Task'),
    file('text.txt', new Uint8Array([255, 254, 65, 0, 66, 0])),
    file('table.csv', 'Name,Note\nAlice,"hello, world"\nBob,"line 1\nline 2 | value"'),
    file('page.html', '<h1>Title</h1><script>alert(1)</script><p><strong>Bold</strong> <a href="java&#10;script:alert(1)">Unsafe</a></p><table><tr><th>A</th></tr><tr><td>B</td></tr></table>'),
  ]);
  expect(result.issues).toEqual([]);
  expect(result.pages[0].content).toBe('# Note\n\n- [ ] Task');
  expect(result.pages[1].content).toBe('AB');
  expect(result.pages[2].content).toContain('hello, world');
  expect(result.pages[2].content).toContain('line 1<br>line 2 \\| value');
  expect(result.pages[3].content).toContain('# Title');
  expect(result.pages[3].content).toContain('**Bold**');
  expect(result.pages[3].content).not.toMatch(/script|alert\(1\)/);
});

it('imports nested ZIP documents and retains attachments while refusing path traversal', async () => {
  const valid = await prepareImport([file('Vault.zip', zipSync({
    'notes/A.md': strToU8('![Image](../assets/image.png)'),
    'assets/image.png': new Uint8Array([1, 2, 3]),
    '.obsidian/config.json': strToU8('{}'),
    'Nested.zip': zipSync({ 'B.txt': strToU8('Nested') }),
  }))]);
  expect(valid.issues).toEqual([]);
  expect(valid.pages.map(page => page.path)).toEqual(['Vault/notes/A.md', 'Vault/Nested/B.md']);
  expect(valid.assets.map(asset => asset.sourcePath)).toEqual(['Vault/assets/image.png']);
  const invalid = await prepareImport([file('bad.zip', zipSync({ '../escape.md': strToU8('Do not write'), 'ok.md': strToU8('Okay') }))]);
  expect(invalid.pages).toEqual([]);
  expect(invalid.issues[0].message).toContain('不安全');
});

it('converts a Word document and follows EPUB spine order', async () => {
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word content</w:t></w:r></w:p></w:body></w:document>'),
  });
  const epub = zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8('<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'),
    'OEBPS/a.xhtml': strToU8('<h1>Chapter A</h1>'),
    'OEBPS/b.xhtml': strToU8('<h1>Chapter B</h1><img src="image.png">'),
    'OEBPS/image.png': new Uint8Array([1, 2, 3]),
  });
  const result = await prepareImport([file('Word.docx', docx), file('Book.epub', epub)]);
  expect(result.issues).toEqual([]);
  expect(result.pages.map(page => page.content)).toEqual(['Word content\n', '# Chapter B\n\n![](image.png)\n', '# Chapter A\n']);
  expect(result.assets[0].sourcePath).toBe('Book/OEBPS/image.png');
});

it('imports Trello checklists, Roam blocks, and Evernote notes', async () => {
  const result = await prepareImport([
    file('board.json', JSON.stringify({ name: 'Board', lists: [{ id: 'l', name: 'Doing' }], cards: [{ id: 'c', idList: 'l', name: 'Task', desc: 'Description' }], checklists: [{ idCard: 'c', name: 'Checklist', checkItems: [{ name: 'Done', state: 'complete' }] }] })),
    file('roam.json', JSON.stringify([{ title: 'Page', children: [{ string: '{{[[TODO]]}} Task', children: [{ string: 'Nested' }] }] }])),
    file('notes.enex', '<en-export><note><title>Note</title><content><![CDATA[<en-note><div>Hello</div></en-note>]]></content></note></en-export>'),
    file('unknown.json', '{}'),
  ]);
  expect(result.pages).toHaveLength(3);
  expect(result.pages[0].content).toContain('- [x] Done');
  expect(result.pages[1].content).toContain('- [ ] Task\n  - Nested');
  expect(result.pages[2].content).toContain('# Note\n\nHello');
  expect(result.issues[0].message).toContain('Trello');
});

it('allocates distinct portable names for case-insensitive collisions and Windows reserved names', async () => {
  const result = await prepareImport([file('A.md', 'a'), file('a.txt', 'b'), file('CON.txt', 'c')]);
  expect(result.pages.map(page => page.path)).toEqual(['A.md', 'a 2.md', '_CON.md']);
  expect(importName('..')).toBe('未命名');
});
