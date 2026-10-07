// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import WorkspaceIconPicker from './WorkspaceIconPicker.vue';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });
function mount(icon = '') {
  const state = reactive({ icon, disabled: false });
  const select = vi.fn();
  const upload = vi.fn();
  const pasteImage = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(WorkspaceIconPicker, { ...state, mode: 'web', onSelect: select, onUpload: upload, onPasteImage: pasteImage }) });
  app.mount(root);
  return { state, select, upload, pasteImage };
}
function trigger() { return root.querySelector<HTMLButtonElement>('[aria-label="选择工作区图标"]')!; }
function panel() { return document.querySelector<HTMLElement>('[role="dialog"][aria-label="工作区图标"]'); }
function button(label: string) { return panel()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
function tab(id: string) { return panel()!.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!; }
async function open() { trigger().click(); await nextTick(); }
async function search(value: string) {
  const input = panel()!.querySelector<HTMLInputElement>('[aria-label="筛选图标"]')!;
  input.value = value; input.dispatchEvent(new Event('input')); await nextTick();
}
function key(target: Element, value: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
}
function paste(target: Element, items: Partial<DataTransferItem>[] = [], files: File[] = []) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items, files } });
  target.dispatchEvent(event);
  return event;
}

it('searches Chinese, English, and emoji across categories and selects the original emoji', async () => {
  const { select } = mount(); await open();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('筛选图标');
  button('动物与自然').click(); await nextTick();
  expect(button('使用图标：月亮').querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🌙');
  await search('coffee');
  expect(panel()!.querySelectorAll('[data-icon-choice]')).toHaveLength(1);
  expect(button('使用图标：咖啡').querySelector<HTMLElement>('.workspace-emoji-sprite')?.style.backgroundImage).toContain('sprite.webp');
  await search('火箭'); expect(button('使用图标：火箭').querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🚀');
  await search('🧑‍🔬'); button('使用图标：科学家').click(); await nextTick();
  expect(select).toHaveBeenCalledWith('🧑‍🔬');
  expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it('opens on the saved built-in icon tab, marks the selection, and emits a stable icon ID', async () => {
  const { select } = mount('icon:book'); await open();
  expect(tab('icons').getAttribute('aria-selected')).toBe('true');
  expect(button('使用图标：书籍').getAttribute('aria-pressed')).toBe('true');
  expect(button('使用图标：书籍').querySelector('svg')?.getAttribute('class')).toContain('workspace-default-icon');
  await search('rocket'); button('使用图标：火箭').click();
  expect(select).toHaveBeenCalledWith('icon:rocket');
});

it('reopens a newly saved icon and searches the expanded categories in Chinese and English', async () => {
  const { select } = mount('icon:cpu'); await open();
  expect(tab('icons').getAttribute('aria-selected')).toBe('true');
  expect(button('使用图标：处理器').getAttribute('aria-pressed')).toBe('true');
  expect(panel()!.querySelectorAll('[data-icon-choice]').length).toBeGreaterThan(300);
  for (const category of ['科技与设备', '生活与健康', '工具与控制', '人物与沟通']) expect(button(category)).not.toBeNull();
  await search('听诊器');
  expect(button('使用图标：听诊器').querySelector('svg')?.getAttribute('class')).toContain('lucide-stethoscope');
  await search('processor');
  expect(panel()!.querySelectorAll('[data-icon-choice]')).toHaveLength(1);
  button('使用图标：处理器').click(); await nextTick();
  expect(select).toHaveBeenCalledWith('icon:cpu');
  expect(panel()).toBeNull();
});

it('removes custom emoji input and the all button, and supports removal, empty results, and uploads', async () => {
  const { select, upload, state } = mount('🌿'); await open();
  expect(panel()!.querySelector('[aria-label="自定义表情符号"]')).toBeNull();
  expect(panel()!.querySelector('[aria-label="全部图标"]')).toBeNull();
  await search('no such icon'); expect(panel()!.textContent).toContain('没有找到匹配的图标');
  expect(panel()!.querySelector('[aria-label="图标分类目录"]')).toBeNull();
  [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '移除')!.click();
  expect(select).toHaveBeenLastCalledWith('');
  await nextTick(); state.icon = ''; await open();
  expect([...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '移除')!.disabled).toBe(true);
  tab('upload').click(); await nextTick();
  [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '选择图片')!.click();
  expect(upload).toHaveBeenCalledOnce(); await nextTick();
  expect(panel()).not.toBeNull();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(tab('upload').getAttribute('aria-selected')).toBe('true');
});

it('uses categories as a scroll directory and follows manual scrolling through the full catalog', async () => {
  mount(); await open();
  const area = panel()!.querySelector<HTMLElement>('.workspace-icon-picker-scroll')!;
  const sections = [...area.querySelectorAll<HTMLElement>('[data-category]')];
  Object.defineProperties(area, { clientHeight: { value: 240 }, scrollHeight: { value: sections.length * 200 } });
  vi.spyOn(area, 'getBoundingClientRect').mockImplementation(() => ({ top: 100, bottom: 340 } as DOMRect));
  sections.forEach((section, index) => {
    vi.spyOn(section, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 + index * 200 - area.scrollTop } as DOMRect));
  });
  const choiceCount = area.querySelectorAll('[data-icon-choice]').length;
  button('动物与自然').click(); await nextTick();
  expect(area.scrollTop).toBe(392);
  expect(button('动物与自然').getAttribute('aria-current')).toBe('location');
  expect(area.querySelectorAll('[data-icon-choice]')).toHaveLength(choiceCount);
  expect(button('使用图标：笑脸')).not.toBeNull();
  area.scrollTop = 810; area.dispatchEvent(new Event('scroll')); await nextTick();
  expect(button('活动与兴趣').getAttribute('aria-current')).toBe('location');
  area.scrollTop = area.scrollHeight - area.clientHeight; area.dispatchEvent(new Event('scroll')); await nextTick();
  expect(button('旗帜').getAttribute('aria-current')).toBe('location');
  area.scrollTop = 0; area.dispatchEvent(new Event('scroll')); await nextTick();
  expect(button('表情与情绪').getAttribute('aria-current')).toBe('location');
});

it('pastes clipboard images from the upload panel and restores focus', async () => {
  const { pasteImage } = mount(); await open();
  tab('upload').click(); await nextTick();
  const area = panel()!.querySelector<HTMLElement>('.workspace-icon-picker-upload')!;
  area.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(document.activeElement).toBe(area);
  expect(area.textContent).toContain('Ctrl+V');
  const file = new File(['image'], 'clipboard.png', { type: 'image/png' });
  const event = paste(area, [
    { kind: 'string', type: 'text/plain' },
    { kind: 'file', type: file.type, getAsFile: () => file },
  ]);
  expect(event.defaultPrevented).toBe(true);
  expect(pasteImage).toHaveBeenCalledExactlyOnceWith(file);
  await nextTick();
  expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it('accepts clipboard file fallback without intercepting text, other tabs, or disabled settings', async () => {
  const { pasteImage, state } = mount(); await open();
  const file = new File(['image'], 'clipboard.webp', { type: 'image/webp' });
  expect(paste(panel()!, [], [file]).defaultPrevented).toBe(false);
  tab('upload').click(); await nextTick();
  expect(paste(panel()!, [{ kind: 'string', type: 'text/plain' }]).defaultPrevented).toBe(false);
  expect(pasteImage).not.toHaveBeenCalled();
  const uploadPanel = panel()!;
  state.disabled = true;
  await nextTick();
  expect(paste(uploadPanel, [], [file]).defaultPrevented).toBe(false);
  state.disabled = false; await nextTick(); await open();
  tab('upload').click(); await nextTick();
  expect(paste(tab('upload'), [], [file]).defaultPrevented).toBe(true);
  expect(pasteImage).toHaveBeenCalledExactlyOnceWith(file);
});

it('keeps searches global and resets the directory and scroll position when results or tabs change', async () => {
  mount(); await open();
  const area = panel()!.querySelector<HTMLElement>('.workspace-icon-picker-scroll')!;
  area.scrollTop = 400;
  await search('coffee'); await nextTick();
  expect(area.scrollTop).toBe(0);
  expect(button('食物与饮品').getAttribute('aria-current')).toBe('location');
  button('食物与饮品').click(); await nextTick();
  expect(panel()!.querySelector<HTMLInputElement>('[aria-label="筛选图标"]')!.value).toBe('coffee');
  tab('icons').click(); await nextTick(); await nextTick();
  expect(button('工作与学习').getAttribute('aria-current')).toBe('location');
  expect(area.scrollTop).toBe(0);
});

it('supports keyboard tabs and icon navigation and restores focus on Escape', async () => {
  mount(); await open();
  key(tab('emoji'), 'ArrowRight'); await nextTick();
  expect(tab('icons').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tab('icons'));
  const choices = [...panel()!.querySelectorAll<HTMLButtonElement>('[data-icon-choice]')];
  expect(choices.filter(choice => choice.tabIndex === 0)).toHaveLength(1);
  const layout = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ gridTemplateColumns: Array(12).fill('29px').join(' ') } as CSSStyleDeclaration);
  choices[0]!.focus(); key(choices[0]!, 'ArrowDown'); expect(document.activeElement).toBe(choices[12]);
  key(choices[12]!, 'ArrowLeft'); expect(document.activeElement).toBe(choices[11]);
  layout.mockReturnValue({ gridTemplateColumns: Array(9).fill('29px').join(' ') } as CSSStyleDeclaration);
  key(choices[11]!, 'ArrowDown'); expect(document.activeElement).toBe(choices[20]);
  key(choices[20]!, 'ArrowUp'); expect(document.activeElement).toBe(choices[11]);
  key(choices[11]!, 'Escape'); await nextTick();
  expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it('dismisses on outside input, viewport changes, disabled settings, and unmount', async () => {
  const { state, select } = mount(); await open();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick(); expect(panel()).toBeNull();
  await open(); window.dispatchEvent(new Event('resize')); await nextTick(); expect(panel()).toBeNull();
  await open(); state.disabled = true; await nextTick(); expect(panel()).toBeNull();
  trigger().click(); await nextTick(); expect(panel()).toBeNull(); expect(select).not.toHaveBeenCalled();
  state.disabled = false; await nextTick(); await open(); app.unmount(); expect(panel()).toBeNull();
});

it('keeps the popover inside a narrow, short viewport', async () => {
  vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 300);
  try {
    mount();
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ left: 280, right: 328, top: 250, bottom: 298 } as DOMRect);
    await open();
    expect(panel()!.style.width).toBe('304px'); expect(panel()!.style.left).toBe('8px');
    expect(panel()!.style.top).toBe('8px'); expect(panel()!.style.maxHeight).toBe('284px');
  } finally { vi.unstubAllGlobals(); }
});
