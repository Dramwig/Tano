import type { PluginDocument } from '@tano/workbench/plugin-sdk';
import LZString from 'lz-string';

// Keep the document below the existing Worker boundary; do not increase host quotas.
export const sceneLimit = 240 * 1024;
export const chunkSize = 2000;
export interface Scene {
  type: 'excalidraw'; version: 2; source: string;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
export interface Drawing { id: string; path: string }
export interface BoardState {
  drawings: Drawing[]; current: Drawing | null; revision: string;
  hash?: string;
  chunk: string; offset: number; length: number; error: string;
  request?: { token: string; id?: string; create?: boolean } | null;
}
export const emptyScene = (): Scene => ({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
export function parseScene(content: string): Scene {
  if (new TextEncoder().encode(content).length > sceneLimit) throw new Error('白板超过 240 KiB，请减少元素或图片大小后重试。');
  const value = JSON.parse(content);
  if (!value || value.type !== 'excalidraw' || !Array.isArray(value.elements) || value.elements.some((element: unknown) => !element || typeof element !== 'object' || Array.isArray(element))) throw new Error('不是有效的 Excalidraw 文件。');
  if (value.elements.length > 2000) throw new Error('白板最多支持 2000 个元素。');
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  if (value.appState !== undefined && !record(value.appState) || value.files !== undefined && !record(value.files)) throw new Error('白板状态或图片数据无效。');
  return { ...value, type: 'excalidraw', version: 2, source: typeof value.source === 'string' && value.source !== 'null' ? value.source : 'https://excalidraw.com', elements: value.elements, appState: value.appState ?? {}, files: value.files ?? {} };
}
const block = /(^```(json|compressed-json)[^\S\r\n]*\r?\n)([\s\S]*?)(^```[^\S\r\n]*$)/m;
export function sceneInMarkdown(content: string): { scene: Scene; start: number; end: number; compressed: boolean } {
  const heading = /^#{1,2} Drawing[^\S\r\n]*\r?$/m.exec(content);
  if (!heading) throw new Error('此文档没有 Excalidraw Drawing 数据。');
  const match = block.exec(content.slice(heading.index + heading[0].length));
  if (!match) throw new Error('没有找到 JSON Drawing 数据。');
  const start = heading.index + heading[0].length + match.index + match[1].length;
  const compressed = match[2] === 'compressed-json';
  const data = compressed ? LZString.decompressFromBase64(match[3].replace(/\s/g, '')) : match[3];
  if (!data) throw new Error('Excalidraw 压缩数据无效。');
  return { scene: parseScene(data), start, end: start + match[3].length, compressed };
}
export const isDrawing = (path: string) => /\.excalidraw\.md$/i.test(path);
export function createMarkdown(scene = emptyScene()) {
  return `---\nexcalidraw-plugin: raw\ntags: [excalidraw]\n---\n\n# Excalidraw Data\n\n%%\n## Drawing\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\n%%\n`;
}
export function replaceScene(base: PluginDocument, scene: Scene) {
  const { start, end, compressed } = sceneInMarkdown(base.content);
  const data = JSON.stringify(scene);
  const result = base.content.slice(0, start) + (compressed ? LZString.compressToBase64(data) : data) + '\n' + base.content.slice(end);
  if (new TextEncoder().encode(result).length > 280 * 1024) throw new Error('白板文档过大，请减少内容。');
  return result;
}
