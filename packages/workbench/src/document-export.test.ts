// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cleanExportContent, exportFilename, exportPageSlices, renderDocumentExport } from './document-export';
import { defaultCapabilities } from '@tano/editor/runtime';

it('preserves the exact Markdown snapshot and the original Markdown extension', async () => {
  const content = '---\r\ntitle: 标题\r\n---\r\n# 原文\r\n\r\n:::unknown\r\n';
  const blob = await renderDocumentExport({ id: 'a00001', path: 'folder/标题.markdown', content,
    capabilities: defaultCapabilities, referenceTargets: [], resolveImage: () => null,
    fontFamily: 'sans-serif', fontSize: 16,
  }, 'markdown');
  const result = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(result).toBe(content);
  expect(exportFilename('folder/标题.markdown', 'markdown')).toBe('标题.markdown');
  expect(exportFilename('folder/标题.markdown', 'pdf')).toBe('标题.pdf');
});

it('includes inactive enhanced panels, removes editing controls, and preserves task completion', () => {
  const root = document.createElement('div');
  root.innerHTML = '<section class="tano-enhanced" hidden><div class="tano-enhanced-header"><input value="分区标题"><button>添加子块</button></div><div class="tano-enhanced-content" hidden>隐藏正文</div></section><code hidden>公式源码</code><input class="tano-code-language" value="ts" hidden><input type="checkbox"><input type="checkbox" checked><p contenteditable="true" tabindex="0">正文</p>';
  const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes[0].checked = true;
  checkboxes[1].checked = false;
  cleanExportContent(root);
  expect(root.querySelector('.tano-enhanced')?.hasAttribute('hidden')).toBe(false);
  expect(root.querySelector('.tano-enhanced-content')?.hasAttribute('hidden')).toBe(false);
  expect(root.querySelector('code')?.hasAttribute('hidden')).toBe(true);
  expect(root.textContent).toContain('分区标题');
  expect(root.textContent).toContain('隐藏正文');
  expect(root.querySelector('button, .tano-code-language, [contenteditable], [tabindex]')).toBeNull();
  expect(checkboxes[0].hasAttribute('checked')).toBe(true);
  expect(checkboxes[1].hasAttribute('checked')).toBe(false);
});

it('moves PDF breaks before intersecting text or table rows without losing any pixels', () => {
  const slices = exportPageSlices(2500, 1000, [{ top: 980, bottom: 1010 }, { top: 920, bottom: 1050 }]);
  expect(slices).toEqual([{ top: 0, bottom: 919 }, { top: 919, bottom: 1919 }, { top: 1919, bottom: 2500 }]);
  expect(slices.reduce((total, slice) => total + slice.bottom - slice.top, 0)).toBe(2500);
  expect(exportPageSlices(2500, 1000, [{ top: 100, bottom: 2400 }])).toEqual([{ top: 0, bottom: 1000 }, { top: 1000, bottom: 2000 }, { top: 2000, bottom: 2500 }]);
});
