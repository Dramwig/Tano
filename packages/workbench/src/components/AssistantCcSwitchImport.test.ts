// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import AssistantCcSwitchImport from './AssistantCcSwitchImport.vue';

vi.mock('../assistant/store', () => ({ useAssistantStore: () => assistant }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => '/custom/cc-switch.db') }));
const records = [
  { id: 'a', name: 'Provider A', source: 'codex', endpoint: 'https://example.com/v1', reason: null },
  { id: 'b', name: 'Provider B', source: 'opencode', endpoint: 'https://example.org/v1', reason: null },
  { id: 'c', name: 'Provider C', source: 'claude', endpoint: '', reason: '暂不支持此接口协议' },
];
const assistant = reactive({ canImportCcSwitch: true, busy: false, loading: false, connections: [] as unknown[], scanCcSwitch: vi.fn(async (_path?: string) => records), importCcSwitch: vi.fn(async (_ids: string[], _path?: string) => {}) });
let app: App;
let root: HTMLDivElement;
const changed = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  assistant.canImportCcSwitch = true; assistant.connections = [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantCcSwitchImport, { onChanged: changed })); app.mount(root);
});
afterEach(() => { app.unmount(); root.remove(); vi.restoreAllMocks(); });
function button(text: string) { return [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!; }
async function show() { button('从 CC Switch 导入').click(); await vi.waitFor(() => expect(document.querySelectorAll('li')).toHaveLength(3)); }
function checkboxes() { return [...document.querySelectorAll<HTMLInputElement>('li input')]; }

it('lists all providers, disables unsupported records and imports only the selected IDs', async () => {
  await show();
  expect(checkboxes()[2].disabled).toBe(true);
  expect(button('导入所选连接').disabled).toBe(true);
  checkboxes()[1].click(); await nextTick(); button('导入所选连接').click();
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(assistant.importCcSwitch).toHaveBeenCalledWith(['b'], undefined);
  expect(document.querySelector('dialog')).toBeNull();
});
it('selects only eligible records, enforces capacity and cancels without writing', async () => {
  assistant.connections = Array(19).fill({}); await show();
  document.querySelector<HTMLInputElement>('.cc-import-selection input')!.click(); await nextTick();
  expect(checkboxes().map(c => c.checked)).toEqual([true, true, false]);
  expect(button('导入所选连接').disabled).toBe(true);
  button('取消').click(); await nextTick();
  expect(assistant.importCcSwitch).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button('从 CC Switch 导入'));
});
it('shows scan errors and can recover by choosing a custom database', async () => {
  assistant.scanCcSwitch.mockRejectedValueOnce(new Error('missing database'));
  button('从 CC Switch 导入').click();
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('missing database'));
  button('选择数据库文件').click();
  await vi.waitFor(() => expect(document.querySelectorAll('li')).toHaveLength(3));
  expect(assistant.scanCcSwitch).toHaveBeenLastCalledWith('/custom/cc-switch.db');
});
it('keeps the selection available after an import failure', async () => {
  await show(); assistant.importCcSwitch.mockRejectedValueOnce(new Error('credential store unavailable'));
  checkboxes()[0].click(); await nextTick(); button('导入所选连接').click();
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('credential store unavailable'));
  expect(checkboxes()[0].checked).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});
it('hides the entry when the host does not support native import', async () => {
  assistant.canImportCcSwitch = false; await nextTick();
  expect(root.querySelector('button')).toBeNull();
});
