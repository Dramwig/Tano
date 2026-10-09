// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { PluginAutomationJob, PluginAutomationProvider } from '@tano/protocol';
import PluginAutomationWebhook from './PluginAutomationWebhook.vue';

let provider: NonNullable<PluginAutomationProvider['webhook']>;
let store: { workspace: { id: string }; canManagePlugins: boolean };
let state: { job: PluginAutomationJob; disabled: boolean };
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({ plugins: { automations: { webhook: provider } } }) }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => store }));
let app: App | undefined, root: HTMLDivElement;
const token = 't'.repeat(43);
beforeEach(() => {
  localStorage.clear(); store = reactive({ workspace: { id: 'workspace-one' }, canManagePlugins: true });
  state = reactive({ job: { id: 'job-one', version: 'version-one', pluginId: 'example', automationId: 'daily', integrity: 'a'.repeat(64),
    label: '日报', enabled: true, intervalMinutes: null, payload: {}, authorizedBy: 'owner', needsAuthorization: false, nextAt: null, webhookConfigured: false }, disabled: false });
  provider = { url: (workspace, job) => `https://api.example.test/${workspace}/${job}/webhook`,
    rotate: vi.fn(async () => ({ job: { ...state.job, version: crypto.randomUUID(), webhookConfigured: true }, token })),
    revoke: vi.fn(async () => ({ ...state.job, version: crypto.randomUUID(), webhookConfigured: false })) };
});
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });
async function mount() {
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(PluginAutomationWebhook, { job: state.job, disabled: state.disabled, onChanged: (job: PluginAutomationJob) => { state.job = job; } })); app.mount(root);
  await toggle(true);
}
async function toggle(open: boolean) { const details = root.querySelector('details')!; details.open = open; details.dispatchEvent(new Event('toggle')); await nextTick(); }
function button(text: string) { return [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!; }
async function approve() { root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await nextTick(); }
function credential() { return root.querySelector<HTMLInputElement>('[aria-label="Webhook 触发凭据"]'); }
it('issues only after explicit approval, displays a masked one-time token, and clears it on close without persisting it', async () => {
  await mount(); expect(provider.rotate).not.toHaveBeenCalled(); expect(button('生成触发凭据').disabled).toBe(true);
  await approve(); button('生成触发凭据').click(); await vi.waitFor(() => expect(credential()?.value).toBe(token));
  expect(provider.rotate).toHaveBeenCalledWith('workspace-one', 'job-one', 'version-one', expect.any(AbortSignal));
  expect(credential()!.type).toBe('password'); expect(JSON.stringify(localStorage)).not.toContain(token);
  // A regular list poll replacing an equivalent job must not erase the token or abort the panel.
  state.job = { ...state.job }; await nextTick(); expect(credential()?.value).toBe(token);
  button('显示凭据').click(); await nextTick(); expect(credential()!.type).toBe('text');
  await toggle(false); expect(credential()).toBeNull(); await toggle(true); expect(credential()).toBeNull(); expect(provider.rotate).toHaveBeenCalledOnce();
});
it('ignores a late issuance response after workspace or task version changes', async () => {
  let finish!: (value: { job: PluginAutomationJob; token: string }) => void;
  vi.mocked(provider.rotate).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await approve(); button('生成触发凭据').click(); await vi.waitFor(() => expect(finish).toBeDefined());
  const signal = vi.mocked(provider.rotate).mock.calls[0]![3], old = { ...state.job };
  store.workspace = { id: 'workspace-two' }; await nextTick(); expect(signal.aborted).toBe(true);
  finish({ job: { ...old, version: 'old-response', webhookConfigured: true }, token }); await nextTick(); await nextTick();
  expect(credential()).toBeNull(); expect(state.job.version).toBe('version-one');
});
it('clears a revealed token after permission loss and permits revoking an invalid grant without issuing a new one', async () => {
  await mount(); await approve(); button('生成触发凭据').click(); await vi.waitFor(() => expect(credential()).not.toBeNull());
  state.job = { ...state.job, needsAuthorization: true }; await nextTick(); expect(credential()).toBeNull();
  expect(button('轮换触发凭据').disabled).toBe(true); button('撤销触发凭据').click();
  await vi.waitFor(() => expect(provider.revoke).toHaveBeenCalledOnce()); expect(provider.rotate).toHaveBeenCalledOnce();
  store.canManagePlugins = false; await nextTick(); expect(credential()).toBeNull();
});
it('does not automatically rotate again when the credential response is lost', async () => {
  vi.mocked(provider.rotate).mockRejectedValue(new Error('响应中断'));
  await mount(); await approve(); button('生成触发凭据').click(); await vi.waitFor(() => expect(root.textContent).toContain('暂未确认凭据操作结果'));
  expect(provider.rotate).toHaveBeenCalledOnce(); expect(credential()).toBeNull(); expect(button('生成触发凭据').disabled).toBe(true);
});
