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
    connectionCheckResults: {}, connectionQuotaResults: {},
    reloadConnections: vi.fn(async () => {}),
    readConnectionKey: vi.fn(async (_id: string) => 'saved-test-key'),
    saveConnection: vi.fn(async (_config: Omit<AssistantConnection, 'hasKey'>, _key?: string) => {}),
    removeConnection: vi.fn(async (_id: string) => {}),
    checkConnection: vi.fn(async (_id: string, _signal: AbortSignal) => 2),
    queryQuota: vi.fn(async (_id: string) => ({ checkedAt: Date.now(), items: [{ label: '额度', remaining: 75, unit: '%' }] })),
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

it('duplicates settings and the saved API key under a new identity only after saving', async () => {
  assistant.connections[0] = { ...connection, icon: 'openrouter', quota: { mode: 'openrouter' } };
  await openMenu(); button('复制连接').click(); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(dialog().textContent).toContain('新建连接');
  expect(nameInput().value).toBe('已有连接（副本）');
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  expect(assistant.readConnectionKey).not.toHaveBeenCalled();
  submit(); await vi.waitFor(() => expect(dialog()).toBeNull());
  const copied = assistant.saveConnection.mock.lastCall![0];
  expect(copied.id).not.toBe(connection.id);
  const { hasKey, ...config } = connection;
  expect(copied).toMatchObject({ ...config, id: copied.id, name: '已有连接（副本）', icon: 'openrouter', quota: { mode: 'openrouter' } });
  expect(copied.quota).not.toBe(assistant.connections[0].quota);
  expect(assistant.saveConnection.mock.lastCall![1]).toBe('saved-test-key');
  expect(assistant.connections[0].name).toBe(connection.name);
});

it('keeps a failed key copy editable for retry or replacement', async () => {
  assistant.readConnectionKey.mockRejectedValueOnce(new Error('读取密钥失败'));
  await openMenu(); button('复制连接').click(); await nextTick();
  submit();
  await vi.waitFor(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('读取密钥失败'));
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  await input(dialog().querySelector('#assistant-api-key')!, 'replacement-key');
  submit(); await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.readConnectionKey).toHaveBeenCalledTimes(1);
  expect(assistant.saveConnection.mock.lastCall![1]).toBe('replacement-key');
});

it('cancels a copy without saving and duplicates CLI settings without reading an API key', async () => {
  const trigger = await openMenu(); button('复制连接').click(); await nextTick();
  button('取消', dialog()).click(); await nextTick();
  expect(document.activeElement).toBe(trigger);
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  assistant.connections[0] = { ...connection, kind: 'codex-cli', cliPath: 'C:/tools/codex.exe', reasoningEffort: 'high' };
  await openMenu(); button('复制连接').click(); await nextTick();
  submit(); await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.readConnectionKey).not.toHaveBeenCalled();
  expect(assistant.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ kind: 'codex-cli', cliPath: 'C:/tools/codex.exe', reasoningEffort: 'high' }), undefined);
});

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
  expect(document.activeElement).toBe(button('复制连接', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(button('配置额度查询', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(button('检测连通', menu));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await openMenu();
  const reopenedMenu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(document.activeElement).toBe(reopenedMenu);
  reopenedMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement).toBe(button('配置额度查询', reopenedMenu));
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

it('checks the chosen connection independently and blocks only duplicate checks', async () => {
  let finish!: (count: number) => void;
  assistant.checkConnection.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openMenu(); button('检测连通').click(); await nextTick();
  expect(assistant.checkConnection).toHaveBeenCalledWith(connection.id, expect.any(AbortSignal));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(root.querySelector('[role="status"]')?.textContent).toContain('正在检测');
  expect(root.querySelector<HTMLButtonElement>('[aria-label="删除连接 已有连接"]')!.disabled).toBe(false);
  await openMenu();
  expect(button('正在检测…', document.querySelector('[role="menu"]')!).disabled).toBe(true);
  for (const label of ['编辑连接', '复制连接', '配置额度查询']) expect(button(label).disabled).toBe(false);
  button('正在检测…', document.querySelector('[role="menu"]')!).click();
  expect(assistant.checkConnection).toHaveBeenCalledOnce();
  finish(3);
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('已读取 3 个模型'));
  expect(root.querySelector<HTMLButtonElement>('[aria-label="删除连接 已有连接"]')!.disabled).toBe(false);
  expect(root.querySelector('.connection-check .connection-status-summary')?.textContent).toMatch(/\d+ ms/);
  expect(root.querySelector('.connection-check-values')?.textContent).toContain('检测时间');
  expect(assistant.saveConnection).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  assistant.connections[0].endpoint = 'https://changed.example/v1';
  await nextTick();
  expect(root.querySelector('.connection-check')).toBeNull();
});

it('restores completed check results when settings are reopened', async () => {
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('.connection-check-values')).not.toBeNull());
  const summary = root.querySelector('.connection-check .connection-status-summary')!.textContent;
  app.unmount();
  app = createApp(() => h(AssistantSettings, { onChanged: changed })); app.mount(root);
  await nextTick();
  expect(root.querySelector('.connection-check .connection-status-summary')?.textContent).toBe(summary);
  expect(assistant.checkConnection).toHaveBeenCalledOnce();
});

it('allows checks on different connections and quota queries while a check is pending', async () => {
  assistant.connections[0].kind = 'codex-cli';
  assistant.connections.push({ ...connection, id: 'second', name: '第二连接' });
  const finish = new Map<string, (count: number) => void>();
  assistant.checkConnection.mockImplementation(id => new Promise(resolve => finish.set(id, resolve)));
  await openMenu(); button('检测连通').click(); await nextTick();
  await openMenu(); button('查询额度').click();
  await vi.waitFor(() => expect(assistant.queryQuota).toHaveBeenCalledWith('existing'));
  await openMenu(1);
  expect(button('检测连通').disabled).toBe(false);
  button('检测连通').click(); await nextTick();
  expect(assistant.checkConnection).toHaveBeenCalledTimes(2);
  finish.get('second')!(4);
  await vi.waitFor(() => expect(root.textContent).toContain('已读取 4 个模型'));
  await openMenu();
  expect(button('正在检测…', document.querySelector('[role="menu"]')!).disabled).toBe(true);
  button('编辑连接').click(); await nextTick();
  expect(dialog().open).toBe(true);
  finish.get('existing')!(1); await nextTick();
});

it('cancels stale checks after edits or deletion without clearing a newer check', async () => {
  const finish: Array<(count: number) => void> = [];
  assistant.checkConnection.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  await openMenu(); button('检测连通').click(); await nextTick();
  const oldSignal = assistant.checkConnection.mock.lastCall![1];
  assistant.connections[0].endpoint = 'https://changed.example/v1'; await nextTick();
  expect(oldSignal.aborted).toBe(true);
  expect(root.querySelector('.connection-check')).toBeNull();
  await openMenu(); button('检测连通').click(); await nextTick();
  const newSignal = assistant.checkConnection.mock.lastCall![1];
  finish[0](99); await nextTick(); await nextTick();
  expect(root.textContent).not.toContain('已读取 99 个模型');
  await openMenu();
  expect(button('正在检测…', document.querySelector('[role="menu"]')!).disabled).toBe(true);
  assistant.connections.splice(0, 1); await nextTick();
  expect(newSignal.aborted).toBe(true);
  finish[1](3); await nextTick(); await nextTick();
  expect(root.querySelector('.connection-check')).toBeNull();
});

it('shows a failed connectivity check and allows retrying', async () => {
  assistant.checkConnection.mockRejectedValueOnce('API 密钥无效或无权读取模型列表');
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('API 密钥无效'));
  expect(root.querySelector('[role="status"]')).toBeNull();
  expect(root.querySelector('.connection-check .connection-status-summary')?.textContent).toMatch(/检测失败 · \d+ ms/);
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('连接成功'));
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('describes CLI discovery accurately and cancels pending checks when unmounted', async () => {
  assistant.connections[0].kind = 'codex-cli';
  await openMenu(); button('检测连通').click();
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('CLI 可执行文件可用'));
  expect(root.querySelector('[role="status"]')?.textContent).toContain('登录状态与模型连通需在会话中确认');
  expect(root.querySelector('.connection-check .connection-status-summary')?.textContent?.trim()).toMatch(/^\d+ ms$/);
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

it('restores the saved-key mask on blur while preserving the key without a replacement', async () => {
  await openEditor(true);
  const secret = dialog().querySelector<HTMLInputElement>('#assistant-api-key')!;
  expect(secret.type).toBe('password');
  expect(secret.placeholder).toMatch(/^•+$/);
  expect(secret.value).toBe('');
  expect(dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!.disabled).toBe(false);
  secret.focus(); await nextTick();
  expect(secret.placeholder).toBe('');
  secret.blur(); await nextTick();
  expect(secret.placeholder).toMatch(/^•+$/);
  secret.focus(); await nextTick();
  expect(secret.placeholder).toBe('');
  await input(secret, 'test-replacement');
  await input(secret, '');
  secret.blur(); await nextTick();
  expect(secret.placeholder).toMatch(/^•+$/);
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
  expect(root.querySelector('button[data-tooltip="删除模型连接"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('.assistant-connection-more')!.click(); await nextTick();
  expect(button('编辑连接')).toBeUndefined(); button('刷新模型名单').click();
  await vi.waitFor(() => expect(root.textContent).toContain('平台已开放 2 个模型'));
});

it('edits and saves a connection avatar without changing its identity', async () => {
  assistant.connections[0]!.icon = 'deepseek';
  await openEditor(true);
  const trigger = dialog().querySelector<HTMLButtonElement>('.connection-avatar-trigger')!;
  trigger.click(); await nextTick(); await nextTick();
  expect(dialog().querySelector('[aria-label="DeepSeek"]')?.getAttribute('aria-pressed')).toBe('true');
  dialog().querySelector<HTMLButtonElement>('[aria-label="硅基流动"]')!.click();
  await nextTick();
  expect(dialog().querySelector('.connection-avatar-popover')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  submit();
  await nextTick();
  expect(assistant.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing', icon: 'siliconcloud' }), '');
});

it('keeps quota configuration out of the model connection editor', async () => {
  await openEditor(true);
  expect(dialog().querySelector('.quota-panel')).toBeNull();
  expect(dialog().textContent).not.toContain('额度查询');
});
it('places quota actions in the connection menu and focuses quota configuration', async () => {
  assistant.connections[0]!.kind = 'codex-cli';
  await nextTick();
  expect(root.textContent).not.toContain('查询额度');
  await openMenu();
  button('查询额度', document.querySelector('[role="menu"]')!).click();
  await vi.waitFor(() => expect(root.textContent).toContain('剩余 75'));
  expect(assistant.queryQuota).toHaveBeenCalledExactlyOnceWith('existing');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await openMenu();
  button('配置额度查询', document.querySelector('[role="menu"]')!).click();
  await nextTick(); await nextTick();
  expect(dialog().open).toBe(true);
  expect(dialog().classList.contains('assistant-quota-dialog')).toBe(true);
  expect(root.querySelector('.quota-panel')).toBeNull();
  expect(document.activeElement).toBe(dialog().querySelector('[role="switch"]'));
  dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  await nextTick();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(root.querySelector('.assistant-connection-more'));
});

it('reads a saved key on demand, hides it again, and saves without replacing it', async () => {
  await openEditor(true);
  expect(assistant.readConnectionKey).not.toHaveBeenCalled();
  const field = dialog().querySelector<HTMLInputElement>('#assistant-api-key')!;
  const toggle = dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!;
  toggle.click();
  await vi.waitFor(() => expect(field.type).toBe('text'));
  expect(field.value).toBe('saved-test-key');
  expect(assistant.readConnectionKey).toHaveBeenCalledWith('existing');
  toggle.click(); await nextTick();
  expect(field.type).toBe('password');
  expect(field.value).toBe('');
  toggle.click();
  await vi.waitFor(() => expect(field.type).toBe('text'));
  submit();
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(assistant.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing' }), '');
  await openEditor(true);
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.value).toBe('');
});

it('ignores a late key read after closing and reopening the editor', async () => {
  let resolve!: (key: string) => void;
  assistant.readConnectionKey.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await openEditor(true);
  dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!.click(); await nextTick();
  button('取消', dialog()).click(); await nextTick();
  await openEditor(true);
  resolve('stale-test-key'); await nextTick(); await nextTick();
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.value).toBe('');
  expect(dialog().querySelector<HTMLInputElement>('#assistant-api-key')!.type).toBe('password');
});

it('allows retry after a failed key read and preserves a replacement typed while loading', async () => {
  await openEditor(true);
  const toggle = dialog().querySelector<HTMLButtonElement>('.assistant-secret-toggle')!;
  assistant.readConnectionKey.mockRejectedValueOnce(new Error('vault unavailable'));
  toggle.click();
  await vi.waitFor(() => expect(dialog().textContent).toContain('无法读取已保存的 API 密钥'));
  expect(toggle.disabled).toBe(false);
  let resolve!: (key: string) => void;
  assistant.readConnectionKey.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  toggle.click(); await nextTick();
  const field = dialog().querySelector<HTMLInputElement>('#assistant-api-key')!;
  await input(field, 'replacement-key');
  resolve('stale-test-key'); await nextTick(); await nextTick();
  expect(field.value).toBe('replacement-key');
  expect(field.type).toBe('password');
});
