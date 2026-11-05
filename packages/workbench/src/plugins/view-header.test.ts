import { describe, expect, it } from 'vitest';
import type { PluginJson } from '@tano/protocol';
import { parseViewHeader } from './view-header';

describe('plugin view header boundary', () => {
  it('accepts bounded titles, status and local file actions', () => {
    expect(parseViewHeader({ title: '演示文稿.pptx', status: '1 / 2', statusAfter: 'open', previewInfo: { label: '静态预览', detail: '不播放动画和视频。' },
      actions: [{ id: 'open', label: '打开', icon: 'open', accept: '.ppt,.pptx' }] }).title).toBe('演示文稿.pptx');
  });
  it.each<PluginJson>([
    { title: 'x'.repeat(201), actions: [] },
    { title: '', actions: [{ id: 'open', label: '打开', icon: ['open'] }] },
    { title: '', actions: [{ id: 'open', label: '打开', accept: 'https://example.com' }] },
    { title: '', actions: [{ id: 'open', label: '打开' }, { id: 'open', label: '重复' }] },
    { title: '', statusAfter: 'missing', actions: [] },
    { title: '', previewInfo: 'note', actions: [] },
    { title: '', previewInfo: { label: '', detail: 'note' }, actions: [] },
    { title: '', previewInfo: { label: '预览', detail: 'x'.repeat(2001) }, actions: [] },
  ])('rejects malformed header metadata: %j', value => {
    expect(() => parseViewHeader(value)).toThrow();
  });
});
