import { fileHandlers } from '@tano/protocol';

export type PreviewSkeletonKind = 'pdf' | 'word' | 'spreadsheet' | 'presentation' | 'image' | 'video' | 'audio' | 'code' | 'text';
export function previewSkeletonKind(path: string): PreviewSkeletonKind {
  const kind = fileHandlers.resolve(path).preview;
  if (kind === 'office') {
    if (/\.xlsx?$/i.test(path)) return 'spreadsheet';
    if (/\.pptx?$/i.test(path)) return 'presentation';
    return 'word';
  }
  if (kind === 'csv' || kind === 'table') return 'spreadsheet';
  if (kind === 'json' || kind === 'code') return 'code';
  if (['pdf', 'image', 'video', 'audio'].includes(kind)) return kind as PreviewSkeletonKind;
  return 'text';
}
export const previewLoadingLabels: Record<PreviewSkeletonKind, string> = {
  pdf: '正在加载 PDF…', word: '正在加载 Word 文档…', spreadsheet: '正在加载表格…',
  presentation: '正在加载演示文稿…', image: '正在加载图片…', video: '正在加载视频…',
  audio: '正在加载音频…', code: '正在加载代码…', text: '正在加载文本…',
};
