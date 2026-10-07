// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import WorkspaceDeletionSettings from './WorkspaceDeletionSettings.vue';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function mount(canDelete = true, mode: 'web' | 'local' = 'web') {
  const props = reactive({ workspace: { id: 'workspace-one', name: '我的工作区', path: 'web', canDelete }, mode, busy: false, error: '' });
  const remove = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(WorkspaceDeletionSettings, { ...props, onDelete: remove }));
  app.mount(root);
  return { props, remove };
}
function button(text: string) { return [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!; }
async function typeName(value: string) {
  const input = root.querySelector<HTMLInputElement>('input')!;
  input.value = value; input.dispatchEvent(new Event('input')); await nextTick();
}
it('requires a matching workspace name and supports cancel without deleting', async () => {
  const { remove } = mount();
  button('删除当前工作区').click(); await nextTick();
  expect(document.activeElement).toBe(root.querySelector('input'));
  expect(remove).not.toHaveBeenCalled();
  await typeName('错误名称');
  expect(button('永久删除工作区').disabled).toBe(true);
  await typeName('我的工作区');
  expect(button('永久删除工作区').disabled).toBe(false);
  button('取消').click(); await nextTick();
  expect(remove).not.toHaveBeenCalled();
  expect(root.querySelector('form')).toBeNull();
  expect(document.activeElement).toBe(button('删除当前工作区'));
  button('删除当前工作区').click(); await nextTick();
  await typeName('我的工作区');
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(remove).toHaveBeenCalledWith('workspace-one');
});
it('disables deletion for members who are not workspace owners', () => {
  const { remove } = mount(false);
  expect(root.textContent).toContain('仅工作区所有者');
  expect(button('删除当前工作区').disabled).toBe(true);
  button('删除当前工作区').click();
  expect(remove).not.toHaveBeenCalled();
});
it('explains that local deletion only removes registration and confirms without a destructive name prompt', async () => {
  const { remove } = mount(false, 'local');
  expect(root.textContent).toContain('仅删除本平台的本地仓库注册');
  expect(root.textContent).toContain('Markdown、附件和 .tano 数据均会保留');
  expect(root.textContent).not.toContain('仅工作区所有者');
  expect(root.textContent).not.toContain('此操作无法撤销');
  button('删除当前工作区').click(); await nextTick();
  expect(root.querySelector('input')).toBeNull();
  expect(document.activeElement).toBe(button('删除注册'));
  expect(remove).not.toHaveBeenCalled();
  button('取消').click(); await nextTick();
  expect(root.querySelector('form')).toBeNull();
  button('删除当前工作区').click(); await nextTick();
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(remove).toHaveBeenCalledWith('workspace-one');
});
it('discards confirmation when the workspace changes, and keeps service errors visible for retry', async () => {
  const { props, remove } = mount();
  button('删除当前工作区').click(); await nextTick();
  await typeName('我的工作区');
  props.workspace = { ...props.workspace, id: 'workspace-two' }; await nextTick();
  expect(root.querySelector('form')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  button('删除当前工作区').click(); await nextTick();
  await typeName('我的工作区');
  props.busy = true; await nextTick();
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(remove).not.toHaveBeenCalled();
  props.busy = false; props.error = '连接中断，请重试'; await nextTick();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('连接中断');
  expect(button('永久删除工作区').disabled).toBe(false);
});
