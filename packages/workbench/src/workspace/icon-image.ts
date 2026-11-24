/** Convert a user-selected image to a small, square PNG for icon pickers. */
export async function iconImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024)
    throw new Error('请选择不超过 2 MB 的 PNG、JPEG、WebP 或 GIF 图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理图片，请使用表情符号。');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
