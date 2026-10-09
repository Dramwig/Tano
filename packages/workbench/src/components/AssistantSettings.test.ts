// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { AssistantConnection } from '@tano/protocol';
import AssistantSettings from './AssistantSettings.vue';

vi.mock('../assistant/store', () => ({ useAssistantStore: () => assistant }));

const connection: AssistantConnection = {
  id: 'existing', name: '已有连接', kind: 'api', endpoint: 'https://api.openai.com/v1',
  protocol: 'responses', autoAdapt: true, tools: true, maxOutputTokens: 4096, hasKey: true,
};
function makeAssistant() {
  return reactive({
    available: true, canConfigure: true, demo: false, busy: false, loading: false,
    connections: [{ ...connection }],
    reloadConnections: vi.fn(async () => {}),
    saveConnection: vi.fn(async (_config: Omit<AssistantConnection, 'hasKey'>, _key?: string) => {}),
    removeConnection: vi.fn(async (_id: string) => {}),
    checkConnection: vi.fn(async (_id: string, _signal: AbortSignal) => 2),
  });
}
let assistant: ReturnType<typeof makeAssistant>;
let app: App;
let root: HTMLDivElement;
const changed = vi.fn<() => void>();
const showModal = HTMLDialogElement.prototype.showModal;
const close = HTMLDialogElement.prototype.close;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  assistant = makeAssistant(); changed.mockReset();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantSettings, { onChanged: changed })); app.mount(root);
});
afterEach(() => {
  app.unmount(); root.remove();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  vi.restoreAllMocks();
});

function dialog() { return document.querySelector<HTMLDialogElement>('dialog')!; }
function button(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!;
}
function nameInput() { return dialog().querySelector<HTMLInputElement>('input')!; }
async function openEditor(edit = false) {
  const trigger = edit ? root.querySelector<HTMLButtonElement>('.assistant-connection-list button')! : button('添加连接');
  trigger.focus(); trigger.click(); await nextTick();
  return trigger;
}
async function input(element: HTMLInputElement, value: string) {
  element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
}
function submit() { dialog().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }

async function selectValue(element: HTMLSelectElement, value: string) {
  element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
}
it('keeps reasoning out of connection settings and does not set a default on new connections', async () => {
  await openEditor();
  await input(nameInput(), '文档问答');
  await selectValue(dialog().querySelector('select')!, 'codex-cli');
  expect(dialog().textContent).not.toContain('推理强度');
  submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'codex-cli', endpoint: '' }), undefined);
  expect(assistant.saveConnection.mock.lastCall?.[0].reasoningEffort).toBeUndefined();
  await openEditor(); await input(nameInput(), 'API'); submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection.mock.lastCall?.[0].reasoningEffort).toBeUndefined();
});

it('preserves a legacy reasoning default when editing unrelated connection settings', async () => {
  assistant.connections[0] = { ...connection, kind: 'codex-cli', reasoningEffort: 'high' };
  await nextTick(); await openEditor(true);
  expect(dialog().textContent).not.toContain('推理强度');
  await input(nameInput(), '重命名连接');
  submit(); await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection.mock.lastCall?.[0].reasoningEffort).toBe('high');
});

async function openMenu(index = 0) {
  const trigger = root.querySelectorAll<HTMLButtonElement>('.assistant-connection-more')[index];
  trigger.focus(); trigger.click(); await nextTick();
  return trigger;
}

async function openDeletion() {
  const trigger = root.querySelector<HTMLButtonElement>('[aria-label="删除连接 已有连接"]')!;
  trigger.focus(); trigger.click(); await nextTick();
  return trigger;
}

it('requires confirmation before deletion and preserves the connection when cancelled or dismissed', async () => {
  const trigger = await openDeletion();
  expect(dialog().open).toBe(true);
  expect(dialog().getAttribute('role')).toBe('alertdialog');
  expect(dialog().textContent).toContain('确定删除「已有连接」吗？');
  expect(document.activeElement).toBe(button('取消', dialog()));
  expect(assistant.removeConnection).not.toHaveBeenCalled();
  button('取消', dialog()).click(); await nextTick();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await openDeletion();
  dialog().dispatchEvent(new Event('cancel', { cancelable: true })); await nextTick();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(assistant.connections).toEqual([connection]);
  expect(assistant.removeConnection).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it('deletes only the confirmed connection once and updates the list without a success notice', async () => {
  assistant.connections.push({ ...connection, id: 'other', name: '保留连接' });
  let finish!: () => void;
  assistant.removeConnection.mockImplementation(async id => {
    await new Promise<void>(resolve => { finish = resolve; });
    assistant.connections = assistant.connections.filter(item => item.id !== id);
  });
  await openDeletion(); submit(); await nextTick(); submit();
  expect(assistant.removeConnection).toHaveBeenCalledExactlyOnceWith(connection.id);
  expect(button('取消', dialog()).disabled).toBe(true);
  expect(button('删除中…', dialog()).disabled).toBe(true);
  dialog().dispatchEvent(new Event('cancel', { cancelable: true })); await nextTick();
  expect(dialog().open).toBe(true);
  finish();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.connections.map(item => item.id)).toEqual(['other']);
  expect(root.querySelector('.assistant-connection-list')?.textContent).toContain('保留连接');
  expect(root.querySelector('[role="status"]')).toBeNull();
  expect(document.activeElement).toBe(button('添加连接'));
  expect(changed).toHaveBeenCalledOnce();
});

it('keeps a failed deletion in the confirmation dialog for retry', async () => {
  assistant.removeConnection.mockRejectedValueOnce(new Error('删除失败，请重试'));
  await openDeletion(); submit();
  await vi.waitFor(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('删除失败'));
  expect(assistant.connections).toEqual([connection]);
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(button('确认删除', dialog()).disabled).toBe(false);
  submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.removeConnection).toHaveBeenCalledTimes(2);
  expect(root.querySelector('[role="status"]')).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
});

it('opens only one actions menu and supports keyboard navigation, Escape, and outside dismissal', async () => {
  assistant.connections.push({ ...connection, id: 'second', name: '第二连接' });
  await nextTick();
  const trigger = await openMenu();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.parentElement).toBe(document.body);
  expect(document.activeElement).toBe(menu);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(button('检测连通', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(button('编辑连接', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(button('检测连通', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await openMenu();
  const reopenedMenu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(document.activeElement).toBe(reopenedMenu);
  reopenedMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement).toBe(button('编辑连接', reopenedMenu));
  reopenedMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await nextTick();
  expect(document.activeElement).toBe(button('检测连通'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  await openMenu(); await openMenu(1);
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('第二连接 操作');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('checks the chosen connection, blocks repeated checks, and shows its result without editing', async () => {
  let finish!: (count: number) => void;
  assistant.checkConnection.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openMenu(); button('检测连通').click(); await nextTick();
  expect(assistant.checkConnection).toHaveBeenCalledWith(connection.id, expect.any(AbortSignal));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(root.querySelector('[role="status"]')?.textContent).toContain('正在检测');
  expect(root.querySelector<HTMLButtonElement>('[aria-label="删除连接 已有连接"]')!.disabled).toBe(true);
  await openMenu();
  expect(button('正在检测…').disabled).toBe(true);
  button('正在检测…').click();
  expect(assistant.checkConnection).toHaveBeenCalledOnce();
  finish(3);
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('已读取 3 个模型'));
  expect(root.querySelector<HTMLButtonElement>('[aria-label="删除连接 已有连接"]')!.disabled).toBe(false);
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it('shows a failed connectivity check and allows retrying', async () => {
  assistant.checkConnection.mockRejectedValueOnce('API 密钥无效或无权读取模型列表');
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('API 密钥无效'));
  expect(root.querySelector('[role="status"]')).toBeNull();
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('连接成功'));
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('describes CLI discovery accurately and cancels pending checks when unmounted', async () => {
  assistant.connections[0].kind = 'codex-cli';
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('CLI 可执行文件可用'));
  expect(root.querySelector('[role="status"]')?.textContent).toContain('登录状态与模型连通需在会话中确认');
  let finish!: (count: number) => void;
  assistant.checkConnection.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openMenu(); button('检测连通').click(); await nextTick();
  const signal = assistant.checkConnection.mock.lastCall![1];
  app.unmount();
  expect(signal.aborted).toBe(true);
  finish(1); await nextTick();
});

it('opens the connection editor from the actions menu and restores focus to the more button', async () => {
  const trigger = await openMenu(); button('编辑连接').click(); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(nameInput().value).toBe(connection.name);
  button('取消', dialog()).click(); await nextTick();
  expect(document.activeElement).toBe(trigger);
});

it('opens a separate modal for a new connection and restores focus when cancelled', async () => {
  const trigger = await openEditor();
  expect(dialog().open).toBe(true);
  expect(dialog().parentElement).toBe(document.body);
  expect(root.querySelector('form')).toBeNull();
  expect(dialog().querySelector('h2')?.textContent).toBe('新建连接');
  expect(document.activeElement).toBe(nameInput());
  expect(trigger.isConnected).toBe(true);
  await input(nameInput(), '未保存的连接');
  const outerKeydown = vi.fn(); document.addEventListener('keydown', outerKeydown);
  try {
    nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outerKeydown).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', outerKeydown); }
  dialog().dispatchEvent(new Event('cancel', { cancelable: true })); await nextTick();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  await openEditor();
  expect(nameInput().value).toBe('');
});

it('edits a copy in the modal and discards unsaved fields and secrets on cancel', async () => {
  const trigger = await openEditor(true);
  expect(dialog().querySelector('h2')?.textContent).toBe('编辑连接');
  expect(nameInput().value).toBe(connection.name);
  await input(nameInput(), '修改后的连接');
  await input(dialog().querySelector<HTMLInputElement>('input[type="password"]')!, 'draft-secret');
  button('取消', dialog()).click(); await nextTick();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(assistant.connections[0]).toEqual(connection);
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  await openEditor(true);
  expect(nameInput().value).toBe(connection.name);
  expect(dialog().querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('');
});

it('locks the modal while saving, prevents duplicate submits, and returns to the updated list', async () => {
  let finish!: () => void;
  assistant.saveConnection.mockImplementation(async config => {
    await new Promise<void>(resolve => { finish = resolve; });
    assistant.connections.push({ ...config, hasKey: false });
  });
  const trigger = await openEditor(); await input(nameInput(), '新连接');
  submit(); await nextTick(); submit();
  expect(assistant.saveConnection).toHaveBeenCalledTimes(1);
  expect(dialog().querySelector('fieldset')!.disabled).toBe(true);
  expect(button('取消', dialog()).disabled).toBe(true);
  dialog().dispatchEvent(new Event('cancel', { cancelable: true })); await nextTick();
  expect(dialog().open).toBe(true);
  finish();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(root.querySelector('.assistant-connection-list')?.textContent).toContain('新连接');
  expect(root.querySelector('[role="status"]')?.textContent).toBe('模型连接已保存');
  expect(document.activeElement).toBe(trigger);
  expect(changed).toHaveBeenCalledOnce();
});

it('keeps a failed edit and its error in the modal so it can be retried', async () => {
  assistant.saveConnection.mockRejectedValueOnce(new Error('保存失败，请重试'));
  await openEditor(true); await input(nameInput(), '重试连接');
  const secret = dialog().querySelector<HTMLInputElement>('input[type="password"]')!;
  await input(secret, 'retry-secret'); submit();
  await vi.waitFor(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('保存失败'));
  expect(nameInput().value).toBe('重试连接');
  expect(secret.value).toBe('retry-secret');
  expect(dialog().querySelector('fieldset')!.disabled).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection).toHaveBeenLastCalledWith(expect.objectContaining({ id: connection.id, name: '重试连接' }), 'retry-secret');
  expect(changed).toHaveBeenCalledOnce();
});

it('clears the saved-key mask on focus while preserving the key when saved without a replacement', async () => {
  await openEditor(true);
  const secret = dialog().querySelector<HTMLInputElement>('#assistant-api-key')!;
  expect(secret.type).toBe('password');
  expect(secret.placeholder).toMatch(/^•+$/);
  expect(secret.value).toBe('');
  expect(dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!.disabled).toBe(true);
  secret.focus(); await nextTick();
  expect(secret.placeholder).toBe('');
  await input(secret, 'test-replacement');
  await input(secret, '');
  secret.blur(); await nextTick();
  expect(secret.placeholder).toBe('');
  await input(nameInput(), '仅修改名称');
  submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: '仅修改名称' }), '');
  await openEditor(true);
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.placeholder).toMatch(/^•+$/);
});

it('reveals only the entered key and resets visibility when cleared or reopened', async () => {
  await openEditor();
  const secret = dialog().querySelector<HTMLInputElement>('#assistant-api-key')!;
  const toggle = dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!;
  expect(secret.placeholder).toBe('');
  expect(toggle.disabled).toBe(true);
  await input(secret, 'test-only-key');
  expect(secret.type).toBe('password');
  expect(toggle.disabled).toBe(false);
  toggle.click(); await nextTick();
  expect(secret.type).toBe('text');
  expect(secret.value).toBe('test-only-key');
  expect(toggle.getAttribute('aria-label')).toBe('隐藏 API 密钥');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  toggle.click(); await nextTick();
  expect(secret.type).toBe('password');
  toggle.click(); await nextTick();
  await input(secret, '');
  expect(secret.type).toBe('password');
  expect(toggle.disabled).toBe(true);
  await input(secret, 'another-test-key');
  toggle.click(); await nextTick();
  button('取消', dialog()).click(); await nextTick();
  await openEditor();
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.type).toBe('password');
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.value).toBe('');
});

it('shows platform connections without personal editing actions', async () => {
  assistant.canConfigure = false; assistant.connections = [{ ...connection, name: '同页官方', managed: true }];
  await nextTick(); expect(button('添加连接')).toBeUndefined();
  expect(root.querySelector('button[title="删除模型连接"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('.assistant-connection-more')!.click(); await nextTick();
  expect(button('编辑连接')).toBeUndefined(); button('刷新模型名单').click();
  await vi.waitFor(() => expect(root.textContent).toContain('平台已开放 2 个模型'));
});
