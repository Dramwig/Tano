// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { parsePluginPackage, type PluginAutomationJob, type PluginAutomationProvider, type PluginAutomationRun } from '@tano/protocol';
import type { InstalledObjectPlugin } from '../workspace-plugins';
import PluginAutomations from './PluginAutomations.vue';

let provider: PluginAutomationProvider | undefined;
let store: { workspace: { id: string }; canManagePlugins: boolean; installedPlugins: InstalledObjectPlugin[] };
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({ plugins: { automations: provider, principal: 'owner' } }) }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => store }));
let app: App | undefined, root: HTMLDivElement;
const workspace = 'b06d150f-b129-4be4-a027-96acb72f1987';
const job: PluginAutomationJob = { id: '506d150f-b129-4be4-a027-96acb72f1987', version: '606d150f-b129-4be4-a027-96acb72f1987',
  pluginId: 'daily-report', automationId: 'daily', label: '工作区日报', integrity: 'a'.repeat(64), enabled: true, intervalMinutes: null,
  payload: {}, authorizedBy: 'owner', needsAuthorization: false, nextAt: null, webhookConfigured: false };
const execution: PluginAutomationRun = { id: '706d150f-b129-4be4-a027-96acb72f1987', jobId: job.id, trigger: 'manual', status: 'queued',
  createdAt: '2026-10-09T00:00:00Z', scheduledAt: '2026-10-09T00:00:00Z', startedAt: null, finishedAt: null, errorCode: null, result: null };
beforeEach(() => {
  localStorage.clear();
  const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: job.pluginId, name: '工作区日报插件', description: '', version: '1.0.0',
    permissions: ['documents.read', 'documents.write'], commands: [], views: [], objectTypes: [], relationTypes: [], automations: [{ id: 'daily', label: '工作区日报' }] }, source: 'return null;', automationSource: 'return null;' }));
  store = reactive({ workspace: { id: workspace }, canManagePlugins: true, installedPlugins: [{ manifest: pkg.manifest,
    enabled: false, authorized: false, rule: { manifest: pkg.manifest, integrity: job.integrity, mode: 'recommended', settings: { folder: '日报' } } }] });
  provider = { list: vi.fn(async () => []), save: vi.fn(async (_workspace, id, input) => ({ ...job, ...input, id, version: crypto.randomUUID() })),
    run: vi.fn(async () => ({ id: execution.id })), runs: vi.fn(async () => [execution]), remove: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
});
afterEach(() => { app?.unmount(); app = undefined; root?.remove(); vi.restoreAllMocks(); });
async function mount() {
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(PluginAutomations)); app.mount(root);
  const details = root.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle'));
  await nextTick(); await vi.waitFor(() => expect(button('刷新后台任务')?.disabled ?? false).toBe(false));
}
function button(text: string) { return [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === text || item.getAttribute('aria-label') === text)!; }
async function input(label: string, value: string) {
  const element = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  element.value = value; element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await nextTick();
}
async function checkbox(text: string) {
  const element = [...root.querySelectorAll('label')].find(item => item.textContent?.includes(text))!.querySelector('input')!;
  element.click(); await nextTick();
}
it('requires explicit owner approval of the exact package and settings independently of foreground activation', async () => {
  await mount(); button('新建后台任务').click(); await nextTick(); await input('自动化插件', job.pluginId);
  expect(button('保存并授权后台任务').disabled).toBe(true);
  await checkbox('我已核对版本与权限'); expect(button('保存并授权后台任务').disabled).toBe(false);
  await input('自动化执行方式', 'interval'); expect(button('保存并授权后台任务').disabled).toBe(true);
  await input('自动化间隔分钟', '1440'); await input('自动化参数 JSON', '{"days":1}'); await checkbox('我已核对版本与权限');
  button('保存并授权后台任务').click();
  await vi.waitFor(() => expect(provider!.save).toHaveBeenCalledOnce());
  expect(provider!.save).toHaveBeenCalledWith(workspace, expect.any(String), expect.objectContaining({ pluginId: job.pluginId, integrity: job.integrity, intervalMinutes: 1440, payload: { days: 1 }, enabled: true }), expect.any(AbortSignal));
  expect(provider!.run).not.toHaveBeenCalled();
});
it('preserves an uncertain submission identity across reopening and retries only on explicit action', async () => {
  vi.mocked(provider!.list).mockResolvedValue([job]); vi.mocked(provider!.run).mockRejectedValueOnce(new Error('连接中断'));
  await mount(); button('运行 工作区日报').click(); await vi.waitFor(() => expect(root.textContent).toContain('连接中断'));
  const first = vi.mocked(provider!.run).mock.calls[0]!;
  expect(button('确认上次提交 工作区日报')).toBeDefined();
  app!.unmount(); app = undefined; root.remove(); await mount();
  expect(provider!.run).toHaveBeenCalledOnce(); button('确认上次提交 工作区日报').click();
  await vi.waitFor(() => expect(root.textContent).toContain('已确认提交'));
  expect(vi.mocked(provider!.run).mock.calls[1]!.slice(0, 4)).toEqual(first.slice(0, 4));
  expect(button('运行 工作区日报')).toBeDefined(); expect(root.textContent).toContain('等待执行');
});
it('shows execution history, stops only the chosen run, and requires a separate deletion action', async () => {
  vi.mocked(provider!.list).mockResolvedValue([job]); await mount();
  button('查看 工作区日报 运行记录').click(); await vi.waitFor(() => expect(root.textContent).toContain('等待执行'));
  button(`停止执行 ${execution.id}`).click(); await vi.waitFor(() => expect(provider!.cancel).toHaveBeenCalledOnce());
  expect(provider!.cancel).toHaveBeenCalledWith(workspace, job.id, execution.id, expect.any(AbortSignal));
  await vi.waitFor(() => expect(button('删除 工作区日报').disabled).toBe(false));
  button('删除 工作区日报').click(); await nextTick(); expect(provider!.remove).not.toHaveBeenCalled();
  button('删除任务与记录').click(); await vi.waitFor(() => expect(provider!.remove).toHaveBeenCalledWith(workspace, job.id, job.version, expect.any(AbortSignal)));
});
it('aborts a previous workspace load and ignores late results even if the provider ignores cancellation', async () => {
  let finish!: (value: PluginAutomationJob[]) => void;
  vi.mocked(provider!.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mounting = mount(); await vi.waitFor(() => expect(finish).toBeDefined());
  const signal = vi.mocked(provider!.list).mock.calls[0]![1];
  store.workspace = { id: '806d150f-b129-4be4-a027-96acb72f1987' }; await nextTick();
  expect(signal.aborted).toBe(true); finish([job]); await mounting; await nextTick();
  expect(button('运行 工作区日报')).toBeUndefined(); expect(provider!.save).not.toHaveBeenCalled();
});
it('invalidates an approval when the portable policy changes or owner access is lost', async () => {
  await mount(); button('新建后台任务').click(); await nextTick(); await input('自动化插件', job.pluginId); await checkbox('我已核对版本与权限');
  store.installedPlugins[0]!.rule!.settings = { folder: '新目录' }; await nextTick();
  expect(button('保存并授权后台任务')).toBeUndefined();
  store.canManagePlugins = false; await nextTick(); expect(root.textContent).toContain('由工作区所有者配置'); expect(root.querySelector('form')).toBeNull();
  expect(provider!.save).not.toHaveBeenCalled();
});
it('does not load owner data for members or offer unsupported local execution', async () => {
  store.canManagePlugins = false; await mount(); expect(provider!.list).not.toHaveBeenCalled();
  app!.unmount(); app = undefined; root.remove(); provider = undefined; await mount();
  expect(root.textContent).toContain('当前环境没有后台任务服务'); expect(button('新建后台任务')).toBeUndefined();
});
it('refreshes a changed task version and clears approval without overwriting edits for an unchanged version', async () => {
  vi.mocked(provider!.list).mockResolvedValue([job]); await mount(); button('编辑 工作区日报').click(); await nextTick();
  await input('后台任务名称', '修改中的名字'); button('刷新后台任务').click();
  await vi.waitFor(() => expect(button('刷新后台任务').disabled).toBe(false));
  expect(root.querySelector<HTMLInputElement>('[aria-label="后台任务名称"]')!.value).toBe('修改中的名字');
  vi.mocked(provider!.list).mockResolvedValue([{ ...job, label: '另一位管理员的任务', version: crypto.randomUUID() }]);
  await checkbox('我已核对版本与权限'); button('刷新后台任务').click();
  await vi.waitFor(() => expect(root.textContent).toContain('任务已被修改'));
  expect(root.querySelector<HTMLInputElement>('[aria-label="后台任务名称"]')!.value).toBe('另一位管理员的任务'); expect(button('保存并授权后台任务').disabled).toBe(true);
});
