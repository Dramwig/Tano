import { parse, renderSlideToSvg, type Presentation } from '@web-ppt/core';
import { unzipSync } from 'fflate';

export async function readPresentation(bytes: Uint8Array): Promise<Presentation> {
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('演示文稿必须小于 50 MiB');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries = 0, total = 0;
    // Inspect central-directory sizes before the engine expands the archive.
    unzipSync(bytes, { filter(entry) {
      if (++entries > 2000 || entry.originalSize > 20 * 1024 * 1024 || (total += entry.originalSize) > 100 * 1024 * 1024)
        throw new Error('演示文稿展开后超过预览限制');
      if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) throw new Error('演示文稿路径无效');
      return false;
    } });
  } else if (![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value)) {
    throw new Error('不是有效的 PPT/PPTX 文件');
  }
  const presentation = await parse(bytes);
  if (!presentation.slides.length || presentation.slides.length > 1000 || !Number.isFinite(presentation.width) ||
    !Number.isFinite(presentation.height) || presentation.width <= 0 || presentation.height <= 0 ||
    presentation.width > 20000 || presentation.height > 20000) {
    presentation.dispose?.(); throw new Error('幻灯片数量或尺寸超出预览限制');
  }
  return presentation;
}
export function renderSlide(presentation: Presentation, index: number) {
  return renderSlideToSvg(presentation, presentation.slides[index], { textMode: 'html', media: 'badge' });
}
