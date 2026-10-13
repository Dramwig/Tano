// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import WorkspaceGeneralSettings from './WorkspaceGeneralSettings.vue';
import { defaultWorkspaceSettings } from '../workspace-settings';
let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(readOnly = false, canManageSettings = true) {
  const workspaceId = ref('ws');
  const settings = ref({ ...defaultWorkspaceSettings });
  const error = ref('');
  const change = vi.fn();
  const exportContent = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(defineComponent(() => () => h(WorkspaceGeneralSettings, {
    workspace: { id: workspaceId.value, name: settings.value.name || '原名称', path: '', readOnly, canManageSettings }, settings: settings.value,
    mode: 'web', pages: [{ id: 'a00001', path: '首页.md' }], onChange: change, onExport: exportContent,
    error: error.value, onReload: () => { error.value = ''; },
  })));
  app.mount(root);
  return { settings, change, exportContent, error, workspaceId };
}
async function pasteImage(file: File) {
  root.querySelector<HTMLButtonElement>('[aria-label="选择工作区图标"]')!.click(); await nextTick();
  document.querySelector<HTMLButtonElement>('[data-tab="upload"]')!.click(); await nextTick();
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [file] } });
  document.querySelector('.workspace-icon-picker-upload')!.dispatchEvent(event);
  await nextTick();
}

it('disables workspace administration for content editors without making their workspace read-only', () => {
  const { change } = mount(false, false);
  expect(root.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('[aria-label="选择工作区图标"]')!.disabled).toBe(true);
  expect(root.textContent).toContain('只有工作区所有者和管理者');
  root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(change).not.toHaveBeenCalled();
});
function mockImage(decode = vi.fn().mockResolvedValue(undefined)) {
  const drawImage = vi.fn();
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 200; naturalHeight = 100; decode = decode; });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:clipboard-image');
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,aW1hZ2U=');
  return { drawImage, decode };
}
it('keeps the name draft and its original base value when external settings change', async () => {
  const { settings, change } = mount();
  const input = root.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!;
  input.value = '我的名称'; input.dispatchEvent(new Event('input')); await nextTick();
  settings.value = { ...settings.value, name: '外部名称' }; await nextTick();
  expect(input.value).toBe('我的名称');
  root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(change).toHaveBeenCalledWith('ws', { key: 'name', value: '我的名称', previous: '' });
});
it('uses stable IDs for the home page, and clearly disables unavailable capabilities', async () => {
  const { change } = mount();
  const select = root.querySelector<HTMLSelectElement>('[aria-label="默认打开页面"]')!;
  select.value = 'a00001'; select.dispatchEvent(new Event('change'));
  expect(change).toHaveBeenCalledWith('ws', { key: 'homePageId', value: 'a00001', previous: '' });
  for (const label of ['保存并显示页面浏览统计', '在人物资料中显示近期活动', '人物悬浮卡片'])
    expect(root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.disabled).toBe(true);
});
it('rebases a retained name draft only after the user explicitly reloads the latest settings', async () => {
  const { settings, change, error } = mount();
  const input = root.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!;
  input.value = '我的名称'; input.dispatchEvent(new Event('input')); await nextTick();
  settings.value = { ...settings.value, name: '外部名称' }; error.value = '设置已被修改'; await nextTick();
  expect(root.textContent).toContain('工作区当前名称：外部名称');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重新读取设置')!.click(); await nextTick();
  expect(input.value).toBe('我的名称');
  root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(change).toHaveBeenCalledWith('ws', { key: 'name', value: '我的名称', previous: '外部名称' });
});
it('allows content export while all shared settings remain read-only', () => {
  const { change, exportContent } = mount(true);
  expect(root.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!.disabled).toBe(true);
  expect(root.querySelector<HTMLSelectElement>('[aria-label="默认打开页面"]')!.disabled).toBe(true);
  expect(root.querySelector<HTMLSelectElement>('[aria-label="页面标题来源"]')!.disabled).toBe(true);
  for (const toggle of root.querySelectorAll<HTMLButtonElement>('[role="switch"]')) expect(toggle.disabled).toBe(true);
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '导出')!.click();
  expect(exportContent).toHaveBeenCalledWith('ws');
  expect(change).not.toHaveBeenCalled();
});
it('saves picker selections against the latest icon value and closes on a settings error', async () => {
  const { settings, change, error } = mount();
  const trigger = root.querySelector<HTMLButtonElement>('[aria-label="选择工作区图标"]')!;
  trigger.click(); await nextTick();
  document.querySelector<HTMLButtonElement>('[data-tab="icons"]')!.click(); await nextTick();
  settings.value = { ...settings.value, icon: '🌙' }; await nextTick();
  document.querySelector<HTMLButtonElement>('[data-icon-value="icon:book"]')!.click();
  expect(change).toHaveBeenCalledWith('ws', { key: 'icon', value: 'icon:book', previous: '🌙' });
  await nextTick(); trigger.click(); await nextTick();
  error.value = '设置已被其他人修改'; await nextTick();
  expect(document.querySelector('.workspace-icon-picker')).toBeNull();
  expect(trigger.disabled).toBe(true);
});

it('removes the outside upload button and saves pasted images through the existing image processing', async () => {
  const { change, settings } = mount();
  settings.value.icon = '🌙'; await nextTick();
  expect([...root.querySelectorAll('button')].some(button => button.textContent === '上传图片')).toBe(false);
  const { drawImage } = mockImage();
  const file = new File(['image'], 'clipboard.png', { type: 'image/png' });
  await pasteImage(file);
  expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 100, 100, 0, 0, 96, 96);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clipboard-image');
  expect(change).toHaveBeenCalledExactlyOnceWith('ws', { key: 'icon', value: 'data:image/png;base64,aW1hZ2U=', previous: '🌙' });
});

it('validates pasted image formats and size before decoding', async () => {
  const { change } = mount();
  const { decode } = mockImage();
  await pasteImage(new File(['<svg/>'], 'clipboard.svg', { type: 'image/svg+xml' }));
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('不超过 2 MB');
  await pasteImage(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
  expect(decode).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});

it('keeps the upload panel open after opening or canceling file selection and allows another selection', async () => {
  const { change } = mount(); mockImage();
  const input = root.querySelector<HTMLInputElement>('[aria-label="上传工作区图标"]')!;
  const choose = vi.spyOn(input, 'click').mockImplementation(() => {});
  root.querySelector<HTMLButtonElement>('[aria-label="选择工作区图标"]')!.click(); await nextTick();
  document.querySelector<HTMLButtonElement>('[data-tab="upload"]')!.click(); await nextTick();
  const panel = document.querySelector('.workspace-icon-picker')!;
  const button = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '选择图片')!;
  button.click(); await nextTick();
  expect(choose).toHaveBeenCalledOnce();
  expect(document.querySelector('.workspace-icon-picker')).toBe(panel);
  input.dispatchEvent(new Event('cancel')); await nextTick();
  expect(document.querySelector('.workspace-icon-picker')).toBe(panel);
  expect(panel.querySelector('[data-tab="upload"]')?.getAttribute('aria-selected')).toBe('true');
  expect(change).not.toHaveBeenCalled();
  button.click(); await nextTick();
  expect(choose).toHaveBeenCalledTimes(2);
  Object.defineProperty(input, 'files', { value: [new File(['image'], 'selected.png', { type: 'image/png' })] });
  input.dispatchEvent(new Event('change')); await nextTick(); await nextTick();
  expect(change).toHaveBeenCalledExactlyOnceWith('ws', { key: 'icon', value: 'data:image/png;base64,aW1hZ2U=', previous: '' });
});

it('does not apply a pasted image after the active workspace changes during decoding', async () => {
  const { change, workspaceId } = mount();
  let finish!: () => void;
  mockImage(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
  await pasteImage(new File(['image'], 'clipboard.png', { type: 'image/png' }));
  workspaceId.value = 'another-workspace'; await nextTick();
  finish(); await nextTick();
  expect(change).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clipboard-image');
});
