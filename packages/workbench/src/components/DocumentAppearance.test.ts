// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import DocumentAppearance from './DocumentAppearance.vue';
import { appearanceText } from '../document-appearance';
import { documentCoverGroups, documentCoverPreset } from '../document-cover-gallery';
import coverCatalog from '../assets/covers/catalog.json';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });
async function mount(uploadCover?: (file: File) => Promise<{ url: string }>) {
  const state = reactive({ modelValue: '# 正文\n', readonly: false });
  const comment = vi.fn();
  const update = vi.fn((value: string) => { state.modelValue = value; });
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(DocumentAppearance, {
    ...state, mode: 'demo', uploadCover, 'onUpdate:modelValue': update, onComment: comment,
  }) });
  app.mount(root); await nextTick();
  return { state, update, comment };
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text || item.getAttribute('aria-label') === text);
  expect(button, text).toBeTruthy(); button!.click(); await nextTick();
}

it('reuses the workspace icon picker, updates/removes an icon, and opens comments', async () => {
  const { state, comment } = await mount();
  await click('添加图标');
  expect(document.querySelector('[role="dialog"][aria-label="文档图标"]')).not.toBeNull();
  await click('图标');
  await click('使用图标：书籍');
  expect(appearanceText(state.modelValue, 'icon')).toBe('icon:book');
  expect(root.querySelector('.document-page-icon svg')).not.toBeNull();
  await click('选择文档图标'); await click('移除');
  expect(appearanceText(state.modelValue, 'icon')).toBe('');
  await click('添加评论'); expect(comment).toHaveBeenCalledOnce();
});

it('sets and removes a cover, restores focus, and hides mutation controls in readonly mode', async () => {
  const { state } = await mount();
  await click('添加封面'); await click('使用封面：薄雾');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:mist');
  expect(root.querySelector('.document-cover')).not.toBeNull();
  expect(document.activeElement?.textContent?.trim()).toBe('更换封面');
  expect(root.querySelector('.document-title-actions .document-cover-trigger')).toBeNull();
  await click('更换封面'); await click('移除封面');
  expect(root.querySelector('.document-cover')).toBeNull();
  await click('添加封面');
  state.readonly = true; await nextTick();
  expect(root.querySelector('button')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('selects bundled art, saves a portable preset ID, and restores it from Markdown', async () => {
  const { state } = await mount();
  await click('添加封面');
  expect([...document.querySelectorAll('.document-cover-group h4')].map(heading => heading.textContent))
    .toEqual(['颜色和渐变', '复古纹样', '中国古画', '风景与光影', '花园与阳光', '浮世绘', '花卉与静物']);
  const artworks = documentCoverGroups.flatMap(group => group.covers).filter(item => item.image);
  expect(artworks.map(item => item.value)).toEqual(coverCatalog.gallery.artworkIds);
  expect(document.querySelectorAll('.document-cover-presets img')).toHaveLength(34);
  expect(new Set(artworks.map(item => item.value)).size).toBe(34);
  await click('使用封面：睡莲');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:cma-136510');
  expect(state.modelValue).not.toContain('.webp');
  const saved = state.modelValue;
  const image = documentCoverPreset('tano:cma-136510')!.image;
  expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(image);
  await click('更换封面');
  expect(document.querySelector('[aria-label="使用封面：睡莲"]')?.getAttribute('aria-pressed')).toBe('true');
  await click('移除封面');
  state.modelValue = saved; state.readonly = true; await nextTick();
  expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(image);
  expect(root.querySelector('button')).toBeNull();
});

it('selects curated scrolls and flowers without offering retired covers', async () => {
  const { state, update } = await mount();
  await click('添加封面');
  expect(update).not.toHaveBeenCalled();
  await click('使用封面：千里江山图·局部二');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:commons-15830038-2');
  expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(documentCoverPreset('tano:commons-15830038-2')!.image);
  await click('更换封面');
  expect(document.querySelector('[aria-label="使用封面：千里江山图·局部二"]')?.getAttribute('aria-pressed')).toBe('true');
  update.mockClear();
  expect(document.querySelector('[aria-label="使用封面：盛开的杏花"]')).not.toBeNull();
  expect(document.querySelectorAll('.document-cover-group')).toHaveLength(7);
  expect(document.querySelector('[aria-label="使用封面：神奈川冲浪里"]')).toBeNull();
  expect(document.querySelector('[aria-label="使用封面：蓝色弹珠·地球"]')).toBeNull();
  expect(document.querySelector('[aria-label="使用封面：春日花束"]')).toBeNull();
  expect(update).not.toHaveBeenCalled();
  await click('使用封面：盛开的杏花');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:commons-33991904');
  expect(state.modelValue).not.toContain('https://');
  expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(documentCoverPreset('tano:commons-33991904')!.image);
});

it('restores every retired preset without rewriting existing Markdown', async () => {
  const { state, update } = await mount();
  const visible = new Set(coverCatalog.gallery.artworkIds);
  const retired = coverCatalog.groups.flatMap(group => group.artworks.map(artwork => artwork.id)).filter(id => !visible.has(id));
  expect(retired).toHaveLength(61);
  for (const id of retired) {
    const saved = `---\ncover: ${id}\n---\n正文\n`;
    state.modelValue = saved; await nextTick();
    expect(documentCoverPreset(id)?.image).toBeTruthy();
    expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(documentCoverPreset(id)!.image);
    expect(state.modelValue).toBe(saved);
  }
  expect(update).not.toHaveBeenCalled();
});

it('uses the curated focal point in both previews and covers and clears it for linked images', async () => {
  const { state } = await mount();
  await click('添加封面');
  const preview = document.querySelector<HTMLImageElement>('[aria-label="使用封面：日出·印象"] img')!;
  expect(preview.style.objectPosition).toBe('50% 35%');
  await click('使用封面：日出·印象');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:commons-23750619');
  const image = root.querySelector<HTMLImageElement>('.document-cover img')!;
  expect(image.style.objectPosition).toBe(preview.style.objectPosition);
  expect(image.title).toBe('日出·印象 · Claude Monet · 1872');
  state.modelValue = '---\ncover: https://example.com/cover.png\n---\n正文\n';
  await nextTick();
  expect(root.querySelector<HTMLImageElement>('.document-cover img')!.style.objectPosition).toBe('');
});

it('offers two Qingming focal points on the same panorama without changing the cover layout', async () => {
  const { state } = await mount();
  await click('添加封面');
  const labels = [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="使用封面：清明上河图"]')]
    .map(button => button.getAttribute('aria-label'));
  expect(labels).toEqual(['使用封面：清明上河图·虹桥舟市', '使用封面：清明上河图·城门市集']);
  for (const title of ['虹桥舟市', '城门市集']) {
    await click(`使用封面：清明上河图·${title}`);
    expect(root.querySelector('.document-cover')?.className).toBe('document-cover');
    const id = appearanceText(state.modelValue, 'cover');
    expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(documentCoverPreset(id)!.image);
    expect(root.querySelector<HTMLImageElement>('.document-cover img')?.style.objectPosition).toBe(documentCoverPreset(id)!.objectPosition);
    await click('更换封面');
  }
  await click('使用封面：睡莲');
  expect(root.querySelector('.document-cover')?.className).toBe('document-cover');
  expect(documentCoverPreset('tano:commons-4490842-7')!.image).toBe(documentCoverPreset('tano:commons-4490842-8')!.image);
});

it('keeps retired USDA fruit IDs compatible while hiding them from the default picker', async () => {
  const { state } = await mount();
  await click('添加封面');
  expect(documentCoverGroups.find(group => group.id === 'fruit-watercolors')).toBeUndefined();
  expect(document.querySelector('[aria-label="使用封面：樱桃·Riga"]')).toBeNull();
  expect(documentCoverPreset('tano:commons-43036055')?.image).toBeTruthy();
  expect(documentCoverPreset('tano:commons-43036187')?.image).toBeTruthy();
  expect(documentCoverPreset('tano:commons-43155668')?.image).toBeTruthy();
  expect(documentCoverPreset('tano:commons-42929959')?.image).toBeTruthy();
  state.modelValue = '---\ncover: tano:commons-43036055\n---\n正文\n'; await nextTick();
  expect(root.querySelector('.document-cover.is-specimen')).not.toBeNull();
  expect(root.querySelector('.document-cover img')?.getAttribute('src')).toBe(documentCoverPreset('tano:commons-43036055')!.image);
  state.modelValue = '---\ncover: https://example.com/cover.png\n---\n正文\n'; await nextTick();
  expect(root.querySelector('.document-cover.is-specimen')).toBeNull();
});

it('preserves independent edits and refuses a stale art selection', async () => {
  const { state, update } = await mount();
  await click('添加封面');
  state.modelValue = '# 外部更新的正文\n'; await nextTick();
  await click('使用封面：金泽八景之夜');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:cma-106962');
  expect(state.modelValue).toContain('# 外部更新的正文\n');
  await click('更换封面'); update.mockClear();
  state.modelValue = '---\ncover: tano:sky\n---\n正文\n'; await nextTick();
  await click('使用封面：盛开的杏花');
  expect(update).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('封面已被修改');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:sky');
});

it('does not replace a newer cover while an upload is in flight', async () => {
  let finish!: (value: { url: string }) => void;
  const upload = vi.fn(() => new Promise<{ url: string }>(resolve => { finish = resolve; }));
  const { state, update } = await mount(upload);
  await click('添加封面');
  const input = root.querySelector<HTMLInputElement>('[aria-label="上传文档封面"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['image'], 'cover.png', { type: 'image/png' })] });
  input.dispatchEvent(new Event('change')); await nextTick();
  state.modelValue = '---\ncover: tano:sky\n---\n新正文\n'; await nextTick();
  finish({ url: 'assets/cover.png' });
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('封面已被修改'));
  expect(update).not.toHaveBeenCalled();
  expect(state.modelValue).toContain('cover: tano:sky');
});

it('merges an uploaded attachment into the latest body and discards an upload after unmount', async () => {
  let finish!: (value: { url: string }) => void;
  const upload = vi.fn(() => new Promise<{ url: string }>(resolve => { finish = resolve; }));
  const { state, update } = await mount(upload);
  async function startUpload() {
    await click(appearanceText(state.modelValue, 'cover') ? '更换封面' : '添加封面');
    const input = root.querySelector<HTMLInputElement>('[aria-label="上传文档封面"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'cover.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change')); await nextTick();
  }
  await startUpload();
  state.modelValue = '# 新正文\n'; await nextTick();
  finish({ url: 'assets/cover.png' });
  await vi.waitFor(() => expect(appearanceText(state.modelValue, 'cover')).toBe('assets/cover.png'));
  expect(state.modelValue).toContain('# 新正文\n');
  await startUpload(); app.unmount(); update.mockClear();
  finish({ url: 'assets/late.png' }); await nextTick(); await nextTick();
  expect(update).not.toHaveBeenCalled();
});

async function link(value: string) {
  const input = document.querySelector<HTMLInputElement>('.document-cover-link input')!;
  input.value = value; input.dispatchEvent(new Event('input')); await nextTick();
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
}

it('validates image links and preserves body edits when applying a linked cover', async () => {
  const { state, update } = await mount();
  await click('添加封面');
  expect([...document.querySelectorAll('.document-cover-picker [role="tab"]')].map(tab => tab.textContent)).toEqual(['画廊', '上传', '链接']);
  await click('链接');
  expect(document.activeElement).toBe(document.querySelector('.document-cover-link input'));
  for (const invalid of ['不是链接', 'javascript:alert(1)', 'http://example.com/image.png', 'https://user:pass@example.com/image.png']) {
    await link(invalid);
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('HTTPS 图片链接');
  }
  state.modelValue = '# 外部更新的正文\n'; await nextTick();
  await link(' https://example.com/cover.png ');
  expect(appearanceText(state.modelValue, 'cover')).toBe('https://example.com/cover.png');
  expect(state.modelValue).toContain('# 外部更新的正文\n');
  expect(root.querySelector('img[alt="文档封面"]')?.getAttribute('src')).toBe('https://example.com/cover.png');
  expect(document.querySelector('.document-cover-picker')).toBeNull();
  await click('更换封面'); await click('链接');
  expect(document.querySelector<HTMLInputElement>('.document-cover-link input')?.value).toBe('https://example.com/cover.png');
});

it('does not overwrite an externally changed cover from the link tab', async () => {
  const { state, update } = await mount();
  await click('添加封面'); await click('链接');
  state.modelValue = '---\ncover: tano:sky\n---\n正文\n'; await nextTick();
  await link('https://example.com/cover.png');
  expect(update).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('封面已被修改');
  expect(appearanceText(state.modelValue, 'cover')).toBe('tano:sky');
});

it('keeps the teleported picker open for internal interaction, supports keyboard tabs, and dismisses outside', async () => {
  await mount(); await click('添加封面');
  const panel = document.querySelector<HTMLElement>('.document-cover-picker')!;
  expect(root.contains(panel)).toBe(false);
  panel.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(document.querySelector('.document-cover-picker')).toBe(panel);
  const gallery = panel.querySelector<HTMLElement>('[role="tab"]')!;
  gallery.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await nextTick();
  expect(document.activeElement?.textContent).toBe('链接');
  expect(panel.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('链接');
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(document.querySelector('.document-cover-picker')).toBeNull();
  expect(document.activeElement?.textContent?.trim()).toBe('添加封面');
  await click('添加封面');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(document.querySelector('.document-cover-picker')).toBeNull();
});
