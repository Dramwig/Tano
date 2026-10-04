// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';
import { useAssistantStore } from '../assistant/store';
import AssistantPanel from './AssistantPanel.vue';
let app: ReturnType<typeof createApp> | undefined;
let pinia: ReturnType<typeof createPinia>;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); useWorkspaceStore(pinia).dispose(); disposePinia(pinia); vi.unstubAllGlobals(); });
it('opens task evidence from an assistant report and disables references in a different workspace', async () => {
  localStorage.clear();
  pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia); const workspace = useWorkspaceStore(); await workspace.openWorkspace();
  const task = await workspace.createObject({ type: 'event', name: '验收', description: '', archived: false, properties: { checkable: true, completed: true } });
  const assistant = useAssistantStore();
  await vi.waitFor(() => expect(assistant.loading).toBe(false));
  assistant.session = { version: 1, id: crypto.randomUUID(), workspaceId: workspace.workspace!.id, title: '周报', createdAt: 1, updatedAt: 1, revision: 0,
    messages: [{ id: 'answer', role: 'assistant', content: `本周完成 [@验收](object://event/${task.object.id})。`, createdAt: 1, state: 'completed' }] };
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  const opened = vi.fn(); root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantPanel, { onOpenReference: opened })).use(pinia); app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.tano-reference button')).not.toBeNull());
  root.querySelector<HTMLButtonElement>('.tano-reference button')!.click();
  expect(opened).toHaveBeenCalledWith({ type: 'event', id: task.object.id });
  expect(root.querySelector('.tano-reference')!.textContent).toContain('已完成');
  assistant.session.workspaceId = 'another-workspace'; await nextTick();
  expect(root.querySelector<HTMLButtonElement>('.tano-reference button')!.disabled).toBe(true);
});

async function mountEmptyConversation() {
  localStorage.clear();
  vi.stubGlobal('navigator', Object.create(navigator, { locks: { value: { request: async (_name: string, action: () => unknown) => action() } } }));
  pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  const workspace = useWorkspaceStore(); await workspace.openWorkspace();
  const file = workspace.workspace!.files.find(file => file.kind === 'file' && file.path.endsWith('.md'))!;
  await workspace.openFileInNewTab(file);
  const assistant = useAssistantStore();
  await vi.waitFor(() => expect(assistant.loading).toBe(false));
  assistant.open();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantPanel)).use(pinia); app.mount(root);
  await nextTick();
  return { workspace, assistant };
}

it('prepares a starter draft with the current document without sending or granting workspace access', async () => {
  const { workspace, assistant } = await mountEmptyConversation();
  root.querySelector<HTMLButtonElement>('.assistant-starters button')!.click();
  await nextTick();
  expect(assistant.prompt).toContain('请总结这篇笔记');
  expect(assistant.files).toEqual([workspace.active!.id]);
  expect(assistant.session!.messages).toHaveLength(0);
  expect(assistant.allowSearch).toBe(false);
  expect(assistant.allowStructures).toBe(false);
  expect(document.activeElement).toBe(root.querySelector('textarea'));
  root.querySelector<HTMLButtonElement>('.assistant-starters button')!.click();
  expect(assistant.files).toHaveLength(1);
});

it('selects a model in the composer and keeps permissions when its menu is dismissed', async () => {
  const { assistant } = await mountEmptyConversation();
  await vi.waitFor(() => expect(assistant.modelsLoading).toBe(false));
  expect(root.querySelector('.assistant-model-option')).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  expect(document.activeElement).toBe(root.querySelector('.assistant-connection-option'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(root.querySelector('.assistant-model-option'));
  root.querySelector<HTMLButtonElement>('.assistant-model-option')!.click();
  await vi.waitFor(() => expect(root.querySelector('#assistant-model-options')).toBeNull());
  expect(assistant.modelId).toBe(assistant.models[0]);
  expect(root.querySelector('.assistant-compose-model')!.textContent).toContain(assistant.modelId);
  root.querySelector<HTMLButtonElement>('[aria-label="工作区访问权限"]')!.click(); await nextTick();
  root.querySelector<HTMLButtonElement>('[role="radio"]:nth-child(2)')!.click(); await nextTick();
  expect(root.querySelector('#assistant-permission-options')).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="工作区访问权限"]')!.click(); await nextTick();
  root.querySelector('textarea')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(root.querySelector('#assistant-permission-options')).toBeNull();
  expect(assistant.allowSearch).toBe(true);
  expect(root.querySelector('.assistant-granted')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="助手更多选项"]')!.click(); await nextTick();
  root.querySelector('#assistant-more-options')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(root.querySelector('#assistant-more-options')).toBeNull();
  expect(document.activeElement).toBe(root.querySelector('[aria-label="助手更多选项"]'));
  root.querySelector('textarea')!.focus();
  root.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.activeElement).toBe(root.querySelector('textarea'));
});

it('switches the connection from its list and returns to model selection', async () => {
  const { assistant } = await mountEmptyConversation();
  await vi.waitFor(() => expect(assistant.modelsLoading).toBe(false));
  const connection = { ...assistant.connections[0]!, id: crypto.randomUUID(), name: '备用连接' };
  assistant.connections.push(connection);
  await assistant.selectModel('模拟响应');
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="选择模型连接"]')!.click(); await nextTick();
  const connections = root.querySelectorAll<HTMLButtonElement>('#assistant-model-options .assistant-detail-option');
  connections[1]!.click();
  await vi.waitFor(() => expect(root.querySelector('.assistant-connection-option')).not.toBeNull());
  expect(assistant.connectionId).toBe(connection.id);
  expect(assistant.modelId).toBe('');
  expect(root.querySelector('.assistant-connection-option')!.textContent).toContain('备用连接');
  expect(root.querySelector('#assistant-model-options')).not.toBeNull();
});

it('searches all discovered models, preserves a custom selection and accepts manual IDs after discovery fails', async () => {
  const { assistant } = await mountEmptyConversation();
  await vi.waitFor(() => expect(assistant.modelsLoading).toBe(false));
  assistant.models = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  await assistant.selectModel('custom-model');
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  expect(root.querySelector('[aria-label="使用模型 custom-model"]')!.getAttribute('aria-pressed')).toBe('true');
  root.querySelector<HTMLButtonElement>('[aria-label="查看全部模型"]')!.click(); await nextTick();
  const search = root.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!;
  search.value = 'ECHO'; search.dispatchEvent(new Event('input')); await nextTick();
  expect(root.querySelectorAll('.assistant-model-option')).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('[aria-label="使用模型 echo"]')!.click();
  await vi.waitFor(() => expect(root.querySelector('#assistant-model-options')).toBeNull());
  expect(assistant.modelId).toBe('echo');
  assistant.models = []; assistant.modelsError = '模型列表不可用';
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="手动指定对话模型"]')!.click(); await nextTick();
  const manual = root.querySelector<HTMLInputElement>('[aria-label="当前对话的模型 ID"]')!;
  manual.value = 'manual-model'; manual.dispatchEvent(new Event('input')); await nextTick();
  root.querySelector<HTMLFormElement>('.assistant-manual-model')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(assistant.modelId).toBe('manual-model'));
  expect(assistant.session!.model).toBe('manual-model');
});

it('uses an inline reference picker and changes only the selected workspace access flags', async () => {
  const { workspace, assistant } = await mountEmptyConversation();
  root.querySelector<HTMLButtonElement>('[aria-label="添加内容"]')!.click(); await nextTick();
  const toggle = root.querySelector<HTMLInputElement>('[aria-label="允许检索当前工作区"]')!;
  toggle.checked = true; toggle.dispatchEvent(new Event('change')); await nextTick();
  expect(assistant.allowSearch).toBe(true);
  expect(assistant.allowStructures).toBe(false);
  root.querySelector<HTMLButtonElement>('#assistant-add-options > button')!.click(); await nextTick();
  const search = root.querySelector<HTMLInputElement>('[aria-label="搜索参考文档"]')!;
  search.value = workspace.active!.path; search.dispatchEvent(new Event('input')); await nextTick();
  expect(root.querySelectorAll('.assistant-source-option')).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('.assistant-source-option')!.click(); await nextTick();
  expect(assistant.files).toEqual([workspace.active!.id]);
  expect(root.querySelector('.assistant-transcript')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="完成参考文档选择"]')!.click(); await nextTick();
  expect(root.querySelector('#assistant-add-options')).toBeNull();
  expect(root.querySelector('.assistant-context')!.textContent).toContain(workspace.active!.path);
  root.querySelector<HTMLButtonElement>('[aria-label="工作区访问权限"]')!.click(); await nextTick();
  root.querySelector<HTMLButtonElement>('[role="radio"]:nth-child(3)')!.click(); await nextTick();
  expect(assistant.allowStructures).toBe(true);
  expect(assistant.allowSearch).toBe(true);
  root.querySelector<HTMLButtonElement>('[aria-label="工作区访问权限"]')!.click(); await nextTick();
  root.querySelector<HTMLButtonElement>('[role="radio"]:nth-child(1)')!.click(); await nextTick();
  expect(assistant.allowStructures).toBe(false);
  expect(assistant.allowSearch).toBe(false);
});

it('groups and searches recent sessions in the title menu while keeping the conversation visible', async () => {
  const { assistant } = await mountEmptyConversation();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const older = new Date(today); older.setDate(older.getDate() - 7);
  assistant.sessions = [today, yesterday, older].map((date, index) => ({ ...assistant.session!, id: crypto.randomUUID(), title: ['今天的整理', '昨天的翻译', '上周的计划'][index]!, updatedAt: date.getTime(), messages: [] }));
  root.querySelector<HTMLButtonElement>('[aria-label="打开助手会话记录"]')!.click(); await nextTick();
  expect([...root.querySelectorAll('.assistant-history-group h3')].map(element => element.textContent)).toEqual(['今天', '昨天', '更早']);
  expect(root.querySelector('.assistant-transcript')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="搜索会话记录"]')!.click(); await nextTick();
  const search = root.querySelector<HTMLInputElement>('[aria-label="搜索助手会话"]')!;
  search.value = '翻译'; search.dispatchEvent(new Event('input')); await nextTick();
  expect(root.querySelectorAll('.assistant-session-option')).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('.assistant-session-option')!.click(); await nextTick();
  expect(assistant.session!.title).toBe('昨天的翻译');
  expect(root.querySelector('#assistant-history-options')).toBeNull();
});
