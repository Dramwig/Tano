import { expect, it } from 'vitest';
import LZString from 'lz-string';
import { createMarkdown, emptyScene, parseScene, replaceScene, sceneInMarkdown, sceneLimit } from '../examples/plugins/excalidraw/model';

it('round trips standard Excalidraw data and preserves upstream extension fields', () => {
  const scene = { ...emptyScene(), elements: [{ id: 'rectangle', type: 'rectangle', x: 12, y: 14 }], customField: { retained: true } };
  expect(sceneInMarkdown(createMarkdown(scene)).scene).toEqual(scene);
  expect(parseScene(JSON.stringify(scene))).toEqual(scene);
});

it('edits only the Drawing block, preserving notes, frontmatter and CRLF', () => {
  const content = createMarkdown().replaceAll('\n', '\r\n') + '\r\n# Notes\r\nKeep me\r\n';
  const next = { ...emptyScene(), elements: [{ id: 'text', type: 'text', text: '同页' }] };
  const replaced = replaceScene({ id: 'f', path: 'Drawing.excalidraw.md', hash: 'base', content }, next);
  expect(sceneInMarkdown(replaced).scene).toEqual(next);
  expect(replaced.slice(0, sceneInMarkdown(content).start)).toBe(content.slice(0, sceneInMarkdown(content).start));
  expect(replaced.slice(sceneInMarkdown(replaced).end)).toBe(content.slice(sceneInMarkdown(content).end));
});

it('reads and preserves Obsidian compressed-json including whitespace-wrapped base64', () => {
  const scene = { ...emptyScene(), elements: [{ id: 'text', type: 'text', text: '来自 Obsidian' }] };
  const compressed = LZString.compressToBase64(JSON.stringify(scene)).match(/.{1,40}/g)!.join('\n\n');
  const content = `---\nexcalidraw-plugin: raw\n---\n# Excalidraw Data\n%%\n## Drawing\n\`\`\`compressed-json\n${compressed}\n\`\`\`\n%%\n`;
  expect(sceneInMarkdown(content).scene).toEqual(scene);
  const next = { ...scene, elements: [...scene.elements, { id: 'new', type: 'ellipse', x: 10 }] };
  const replaced = replaceScene({ id: 'f', path: 'Drawing.excalidraw.md', hash: 'base', content }, next);
  expect(replaced).toContain('```compressed-json');
  expect(sceneInMarkdown(replaced).scene).toEqual(next);
});

it('rejects malformed and oversized scenes without replacing the document', () => {
  expect(() => parseScene('{"type":"canvas","elements":[]}')).toThrow('Excalidraw');
  expect(() => parseScene(JSON.stringify({ ...emptyScene(), elements: [null] }))).toThrow('有效');
  expect(() => parseScene(JSON.stringify({ ...emptyScene(), files: 'bad' }))).toThrow('图片数据');
  expect(() => parseScene(JSON.stringify({ ...emptyScene(), extra: '字'.repeat(sceneLimit) }))).toThrow('240 KiB');
  expect(() => sceneInMarkdown('# No drawing')).toThrow('Drawing');
});
