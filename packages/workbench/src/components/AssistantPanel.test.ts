// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { Ref } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';
import { useAssistantStore } from '../assistant/store';
import AssistantPanel from './AssistantPanel.vue';
import { setUiLocale } from '../i18n';
let app: ReturnType<typeof createApp> | undefined;
let pinia: ReturnType<typeof createPinia>;
let root: HTMLDivElement;
afterEach(() => { setUiLocale('zh-CN'); app?.unmount(); root?.remove(); useWorkspaceStore(pinia).dispose(); disposePinia(pinia); vi.unstubAllGlobals(); });
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
  expect(root.querySelector<HTMLButtonElement>('.tano-reference button')!.dataset.tooltip).toContain('已完成');
  assistant.session.workspaceId = 'another-workspace'; await nextTick();
  expect(root.querySelector<HTMLButtonElement>('.tano-reference button')!.disabled).toBe(true);
});

async function mountEmptyConversation(fullscreenTarget?: string | Ref<HTMLElement | undefined>) {
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
  app = createApp(() => h(AssistantPanel, { fullscreenTarget: typeof fullscreenTarget === 'string' ? fullscreenTarget : fullscreenTarget?.value })).use(pinia); app.mount(root);
  await nextTick();
  return { workspace, assistant };
}

it('offers one translation starter with explicit targets without rewriting a draft on locale change', async () => {
  const { assistant } = await mountEmptyConversation();
  setUiLocale('en-US'); await nextTick();
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.assistant-starter > button')];
  expect(buttons().map(button => button.textContent)).toEqual(['Summarize this note', 'Polish this note', 'Translate this note', 'Extract action items']);
  buttons()[2]!.click(); await nextTick();
  const targets = () => [...root.querySelectorAll<HTMLButtonElement>('#assistant-translation-options button')];
  targets().find(button => button.textContent === 'Translate to Chinese')!.click();
  expect(assistant.prompt).toBe('Translate this note into Simplified Chinese and preserve its Markdown formatting.');
  await nextTick();
  expect(targets()).toHaveLength(0);
  assistant.prompt = '用户草稿 {0}: please answer in Japanese';
  setUiLocale('zh-CN'); await nextTick();
  expect(assistant.prompt).toBe('用户草稿 {0}: please answer in Japanese');
  expect(buttons().map(button => button.textContent)).toContain('翻译这篇笔记');
  buttons()[2]!.click(); await nextTick();
  expect(assistant.prompt).toBe('用户草稿 {0}: please answer in Japanese');
  targets()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(targets()).toHaveLength(0);
  expect(document.activeElement).toBe(buttons()[2]);
  buttons()[2]!.click(); await nextTick();
  targets().find(button => button.textContent === '翻译成英文')!.click();
  expect(assistant.prompt).toBe('Translate this note into English and preserve its Markdown formatting.');
});

it.each(['zh-CN', 'en-US'] as const)('shows live work, collapses it on completion and copies only the final answer (%s)', async locale => {
  const { assistant } = await mountEmptyConversation();
  setUiLocale(locale);
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  assistant.session!.messages = [{ id: 'activity-reply', role: 'assistant', createdAt: 1, state: 'running',
    content: '先查资料。\n\n最终总结。', toolResults: [], activity: [
      { kind: 'text', start: 0, end: 5, phase: 'working' },
      { kind: 'tool', name: 'search_documents', status: 'running' },
    ] }];
  await nextTick();
  const reply = assistant.session!.messages[0];
  const process = root.querySelector<HTMLDetailsElement>('.assistant-process')!;
  expect(process.open).toBe(true);
  expect(process.textContent).toContain(locale === 'en-US' ? 'Running' : '执行中');
  reply.toolResults!.push({ name: 'search_documents', status: 'succeeded' });
  Object.assign(reply.activity![1], { status: 'succeeded', resultIndex: 0 });
  reply.activity!.push({ kind: 'text', start: 7, end: 12, phase: 'pending' });
  await vi.waitFor(() => expect(root.querySelector('.assistant-message-assistant > .assistant-answer')?.textContent).toContain('最终总结。'));
  const answerView = root.querySelector('.assistant-message-assistant > .assistant-answer .ProseMirror');
  Object.assign(reply.activity![2], { phase: 'answer' });
  reply.state = 'completed'; await nextTick();
  expect(process.open).toBe(false);
  expect(root.querySelector('.assistant-message-assistant > .assistant-answer .ProseMirror')).toBe(answerView);
  root.querySelector<HTMLButtonElement>(locale === 'en-US' ? '[aria-label="Copy assistant answer"]' : '[aria-label="复制助手回答"]')!.click();
  expect(writeText).toHaveBeenCalledWith('最终总结。');
  process.querySelector('summary')!.click(); await nextTick();
  expect(process.open).toBe(true);
  await vi.waitFor(() => expect(process.textContent).toContain('先查资料。'));
  expect(process.textContent).toContain(locale === 'en-US' ? 'Completed' : '已完成');
});

it('keeps failure counts visible after folding and does not export intermediate commentary as an answer', async () => {
  const { assistant } = await mountEmptyConversation();
  assistant.session!.messages = [{ id: 'failed-work', role: 'assistant', createdAt: 1, state: 'failed',
    content: '先查资料。', error: '连接中断', toolResults: [{ name: 'read_document', status: 'failed', error: '文档已移除' }], activity: [
      { kind: 'text', start: 0, end: 5, phase: 'working' },
      { kind: 'tool', name: 'read_document', status: 'failed', resultIndex: 0 },
    ] }];
  await nextTick();
  expect(root.querySelector('.assistant-process summary')?.textContent).toContain('1 次失败');
  expect(root.querySelector('.assistant-message-error')?.textContent).toContain('连接中断');
  expect(root.querySelector<HTMLButtonElement>('[aria-label="复制助手回答"]')!.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('[aria-label="将助手回答保存为文档"]')!.disabled).toBe(true);
  root.querySelector<HTMLElement>('.assistant-process summary')!.click(); await nextTick();
  expect(root.querySelector('.assistant-tool-step-error')?.textContent).toBe('文档已移除');
});

it.each(['zh-CN', 'en-US'] as const)('keeps waiting work open and shows real partial results after interruption (%s)', async locale => {
  const { assistant } = await mountEmptyConversation();
  setUiLocale(locale);
  assistant.session!.messages = [{ id: 'waiting-work', role: 'assistant', createdAt: 1, state: 'waiting',
    content: 'Waiting for an answer.', activity: [{ kind: 'text', start: 0, end: 22, phase: 'working' }],
    proposals: ['applied', 'ready', 'unknown'].map(status => ({ id: status, runId: 'waiting-work', workspaceId: assistant.session!.workspaceId,
      kind: 'create', path: `${status}.md`, base: '', content: 'text', reason: 'test', status: status as 'applied' | 'ready' | 'unknown' })),
  }];
  await nextTick();
  const process = root.querySelector<HTMLDetailsElement>('.assistant-process')!;
  expect(process.open).toBe(true);
  expect(process.querySelector('summary')?.textContent).toContain(locale === 'en-US' ? 'Waiting for your answer' : '等待你的回答');
  expect(root.querySelector('.assistant-run-summary')).toBeNull();
  expect(root.querySelector('[aria-label="Copy assistant answer"], [aria-label="复制助手回答"]')).toBeNull();
  const reply = assistant.session!.messages[0];
  reply.state = 'failed'; reply.termination = { reason: 'round_limit' };
  await nextTick();
  expect(process.open).toBe(false);
  const summary = root.querySelector('.assistant-run-summary')!;
  expect(summary.textContent).toContain(locale === 'en-US' ? 'Request round limit reached' : '已达到请求轮数上限');
  expect([...summary.querySelectorAll('li')].map(item => item.textContent)).toEqual(['applied.md', 'ready.md', 'unknown.md']);
  expect(root.querySelector('.assistant-message-assistant > .assistant-answer')).toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[aria-label="Copy assistant answer"], [aria-label="复制助手回答"]')!.disabled).toBe(true);
});

it('selects reasoning beside the model, restores focus, and hides it for other connections', async () => {
  const { assistant } = await mountEmptyConversation();
  expect(root.querySelector('[aria-label="选择推理强度"]')).toBeNull();
  assistant.connections[0].kind = 'codex-cli';
  assistant.reasoningEffort = 'medium';
  await nextTick();
  const trigger = root.querySelector<HTMLButtonElement>('[aria-label="选择推理强度"]')!;
  expect(trigger.closest('.assistant-composer')).not.toBeNull();
  expect(trigger.textContent?.trim()).toBe('中');
  trigger.click(); await nextTick();
  const menu = root.querySelector('#assistant-reasoning-options')!;
  expect(menu.querySelector('[aria-label="中"]')!.getAttribute('aria-checked')).toBe('true');
  menu.querySelector<HTMLButtonElement>('[aria-label="低"]')!.click();
  await vi.waitFor(() => expect(root.querySelector('#assistant-reasoning-options')).toBeNull());
  expect(assistant.reasoningEffort).toBe('low');
  expect(assistant.session!.reasoningEffort).toBe('low');
  expect(document.activeElement).toBe(trigger);
  trigger.click(); await nextTick();
  root.querySelector('#assistant-reasoning-options')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick(); expect(document.activeElement).toBe(trigger);
  assistant.busy = true; await nextTick(); expect(trigger.disabled).toBe(true);
  assistant.busy = false; assistant.connections[0].kind = 'claude-cli'; await nextTick();
  expect(root.querySelector('[aria-label="选择推理强度"]')).toBeNull();
});

it('hides the notice for absent proposals while preserving failed receipts and actual proposals', async () => {
  const { assistant, workspace } = await mountEmptyConversation();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  assistant.session!.messages = [{ id: 'reply', role: 'assistant', createdAt: 1, state: 'completed',
    content: '我已经提出了创建 test.md 的建议，请采纳。', proposals: [],
    toolResults: [{ name: 'propose_create', status: 'failed', error: '新文档路径或正文无效' }] }];
  await nextTick();
  expect(root.querySelector('.assistant-result-notice')).toBeNull();
  expect(root.querySelector('.assistant-proposal')).toBeNull();
  const failures = root.querySelector<HTMLDetailsElement>('.assistant-tool-errors')!;
  failures.querySelector('summary')!.click();
  expect(failures.open).toBe(true);
  expect(failures.textContent).toContain('创建文档建议：新文档路径或正文无效');
  assistant.session!.messages[0].proposals!.push({ id: 'real-proposal', runId: 'reply', workspaceId: workspace.workspace!.id,
    kind: 'create', path: 'test.md', content: '# Test', base: '', reason: '测试', status: 'ready' });
  await nextTick();
  expect(root.querySelector('.assistant-result-notice')).toBeNull();
  expect(root.querySelector('.assistant-change-list')?.textContent).toContain('1 个文件 · 1 项操作');
  root.querySelector<HTMLElement>('.assistant-file-change summary')!.click();
  await vi.waitFor(() => expect(root.querySelector('.assistant-proposal')).not.toBeNull());
  expect(root.querySelector('.assistant-proposal')?.textContent).toContain('新增 · test.md');
  expect(root.querySelector('.assistant-proposal')?.textContent).toContain('查看差异');
});

it('renders Markdown as answer chunks arrive and keeps the same view when generation completes', async () => {
  const { assistant } = await mountEmptyConversation();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  assistant.session!.messages = [
    { id: 'question', role: 'user', content: '**总结**', createdAt: 1 },
    { id: 'streaming-answer', role: 'assistant', content: '', createdAt: 1, state: 'running' },
  ];
  await nextTick();
  const message = assistant.session!.messages[1]!;
  const reply = root.querySelector('.assistant-message-assistant')!;
  expect(reply.querySelector('.assistant-answer')).toBeNull();
  message.content = '## 文档总结\n\n**主要内容**\n\n- 数学公式';
  await nextTick();
  // More content can arrive while the editor is still initializing.
  message.content += '\n- 代码示例';
  await vi.waitFor(() => {
    expect(reply.querySelector('h2')?.textContent).toBe('文档总结');
    expect(reply.querySelector('strong')?.textContent).toBe('主要内容');
    expect(reply.querySelectorAll('li')).toHaveLength(2);
  });
  const view = reply.querySelector('.ProseMirror')!;
  expect(view.getAttribute('contenteditable')).toBe('false');
  expect(root.querySelector('.assistant-message-user .assistant-message-text')?.textContent).toBe('**总结**');
  expect(reply.querySelector('.assistant-message-actions')).toBeNull();
  message.content += '\n\n公式：$a^2+b^2=c^2$\n\n```js\nconst answer =';
  await vi.waitFor(() => {
    expect(reply.querySelector('.katex')).not.toBeNull();
    expect(reply.querySelector('pre')?.textContent).toContain('const answer =');
  });
  message.content += ' 42;\n```\n\n**生成完成**';
  await vi.waitFor(() => {
    expect(reply.querySelector('pre')?.textContent).toContain('const answer = 42;');
    expect([...view.querySelectorAll('strong')].at(-1)?.textContent).toBe('生成完成');
  });
  expect(message.state).toBe('running');
  expect(reply.querySelector('.ProseMirror')).toBe(view);
  message.state = 'completed';
  await nextTick();
  expect(reply.querySelector('.ProseMirror')).toBe(view);
  expect(reply.querySelector('[aria-label="复制助手回答"]')).not.toBeNull();
});

it('preserves partially streamed Markdown in the folded work log after interruption', async () => {
  const { assistant } = await mountEmptyConversation();
  assistant.session!.messages = [{ id: 'partial-answer', role: 'assistant',
    content: '## 已生成内容\n\n```text\n尚未写完', createdAt: 1, state: 'running' }];
  await vi.waitFor(() => expect(root.querySelector('.assistant-answer h2')?.textContent).toBe('已生成内容'));
  assistant.session!.messages[0]!.state = 'interrupted';
  await nextTick();
  expect(root.querySelector('.assistant-message-assistant > .assistant-answer')).toBeNull();
  const process = root.querySelector<HTMLDetailsElement>('.assistant-process')!;
  expect(process.open).toBe(false);
  process.querySelector('summary')!.click();
  await vi.waitFor(() => expect(process.querySelector('.assistant-answer pre')?.textContent).toContain('尚未写完'));
  expect(root.querySelector('.assistant-message-error')?.textContent).toContain('已中断');
});

it('shows sent documents above the user bubble while keeping retrieved sources and answer links with the reply', async () => {
  const { workspace, assistant } = await mountEmptyConversation();
  const source = await workspace.assistantSnapshot({ id: workspace.workspace!.id, path: workspace.workspace!.path }, workspace.active!.id);
  source.id = 'S1';
  const retrieved = { ...source, id: 'S2', fileId: 'other-file', path: '检索结果.md' };
  source.selection = { text: '当时划选的文字' };
  assistant.session!.messages = [
    { id: 'question', role: 'user', content: '你好', createdAt: 1 },
    { id: 'answer', role: 'assistant', content: '', createdAt: 1, state: 'running', sources: [source, retrieved], attachedSourceIds: ['S1'] },
  ];
  await nextTick();
  const user = root.querySelector('.assistant-message-user')!;
  const reply = root.querySelector('.assistant-message-assistant')!;
  expect(user.querySelector('.assistant-message-text')!.previousElementSibling).toBe(user.querySelector('.assistant-attachments'));
  expect(user.querySelector('.assistant-attachments')!.textContent).toBe(source.selection.text);
  expect(user.querySelector('.assistant-sent-selection')!.textContent).toBe(source.selection.text);
  expect(reply.querySelector('.assistant-citations')!.textContent).toBe('S2 · 检索结果.md');
  assistant.files = [];
  assistant.selection = { fileId: source.fileId, text: '后来划选的另一段文字' };
  await nextTick();
  expect(user.querySelector('.assistant-sent-selection')!.textContent).toBe(source.selection.text);
  assistant.selection = null;
  assistant.session = JSON.parse(JSON.stringify(assistant.session));
  await nextTick();
  expect(user.querySelector('.assistant-attachments')!.textContent).toBe(source.selection.text);
  const open = vi.spyOn(workspace, 'openFileInNewTab');
  const tabsBefore = workspace.tabs.map(tab => tab.id);
  user.querySelector<HTMLButtonElement>('.assistant-attachments button')!.click();
  await nextTick();
  expect(workspace.active?.id).toBe(source.fileId);
  assistant.session!.messages[1]!.content = '参见[来源:S1]。';
  await vi.waitFor(() => expect(reply.querySelector('.assistant-answer a')).not.toBeNull());
  reply.querySelector<HTMLAnchorElement>('.assistant-answer a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  await nextTick();
  user.querySelector<HTMLButtonElement>('.assistant-sent-selection')!.click();
  await nextTick();
  expect(open).not.toHaveBeenCalled();
  expect(workspace.tabs.map(tab => tab.id)).toEqual(tabsBefore);
  // Older saved conversations still place their reference cards above the prompt.
  delete assistant.session!.messages[1]!.attachedSourceIds;
  await nextTick();
  expect(user.querySelectorAll('.assistant-attachments button')).toHaveLength(2);
  expect(reply.querySelector('.assistant-citations')).toBeNull();
  assistant.session!.messages[1]!.attachedSourceIds = [];
  await nextTick();
  expect(user.querySelector('.assistant-attachments')).toBeNull();
  expect(reply.querySelectorAll('.assistant-citations button')).toHaveLength(2);
});

it('moves the same conversation between sidebar, floating and the current tab with a keyboard-accessible mode menu', async () => {
  const { workspace, assistant } = await mountEmptyConversation('#assistant-test-fullscreen');
  const host = document.createElement('div'); host.id = 'assistant-test-fullscreen'; root.append(host);
  const originalPanel = root.querySelector('.assistant-panel');
  const originalInput = root.querySelector('textarea');
  assistant.prompt = '未发送的草稿';
  const files = [...assistant.files];
  await nextTick();
  const choose = async (mode: string) => {
    document.querySelector<HTMLButtonElement>('[aria-label="切换助手显示模式"]')!.click(); await nextTick();
    const menu = document.querySelector('#assistant-display-options')!;
    expect(menu.querySelector('[aria-checked="true"]')!.textContent).toContain(({ sidebar: '侧栏', floating: '浮动', fullscreen: '全屏' })[assistant.displayMode]);
    [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === mode)!.click();
    await nextTick(); await nextTick();
    expect(document.querySelector('#assistant-display-options')).toBeNull();
    expect(document.querySelector('textarea')).toBe(originalInput);
    expect(assistant.prompt).toBe('未发送的草稿');
  };
  await choose('浮动');
  expect(document.body.querySelector('.assistant-panel-floating')).toBe(originalPanel);
  expect(originalPanel!.parentElement).toBe(document.body);
  expect(root.querySelector('.assistant-panel')).toBeNull();
  expect(document.querySelector('[aria-label="调整浮动助手大小"]')).toBeNull();
  await choose('全屏');
  expect(host.querySelector('.assistant-panel-fullscreen')).toBe(originalPanel);
  expect(assistant.fullscreenTabId).toBe(workspace.activeId);
  document.querySelector<HTMLButtonElement>('[aria-label="切换助手显示模式"]')!.click(); await nextTick();
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(document.activeElement!.textContent).toBe('全屏');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(document.activeElement).toBe(document.querySelector('[aria-label="切换助手显示模式"]'));
  await choose('侧栏');
  expect(root.querySelector('.assistant-panel-sidebar')).toBe(originalPanel);
  expect(host.querySelector('.assistant-panel')).toBeNull();
  await choose('浮动');
  expect(originalPanel!.parentElement).toBe(document.body);
  await choose('全屏');
  expect(originalPanel!.parentElement).toBe(host);
  await choose('侧栏');
  expect(assistant.files).toEqual(files);
});

it('opens model recovery after a provider error without sending or changing the draft and references', async () => {
  const { assistant } = await mountEmptyConversation();
  const message = { id: 'failed-answer', role: 'assistant' as const, content: '', createdAt: 1,
    state: 'failed' as const, error: '模型服务返回 HTTP 403；服务要求通过标准 Codex 客户端使用此模型' };
  assistant.session = { version: 1, id: crypto.randomUUID(), workspaceId: useWorkspaceStore().workspace!.id,
    title: '失败问题', createdAt: 1, updatedAt: 1, revision: 0, messages: [message] };
  assistant.prompt = '保留草稿';
  const files = [...assistant.files];
  await nextTick();
  root.querySelector<HTMLButtonElement>('.assistant-recovery-actions button')!.click(); await nextTick();
  expect(root.querySelector('#assistant-model-options')).not.toBeNull();
  expect(assistant.session.messages).toHaveLength(1);
  expect(assistant.prompt).toBe('保留草稿');
  expect(assistant.files).toEqual(files);
  assistant.busy = true; await nextTick();
  expect(root.querySelector<HTMLButtonElement>('.assistant-recovery-actions button')!.disabled).toBe(true);
  assistant.busy = false;
});

it('restores the same fullscreen conversation when a compact pane replaces its host', async () => {
  const target = ref<HTMLElement>();
  const { assistant } = await mountEmptyConversation(target);
  const originalPanel = root.querySelector<HTMLElement>('.assistant-panel')!;
  const host = document.createElement('div'); root.append(host); target.value = host;
  assistant.prompt = '保留草稿'; assistant.setDisplayMode('fullscreen');
  await nextTick(); await nextTick();
  expect(originalPanel.parentElement).toBe(host);
  target.value = undefined; host.remove();
  await nextTick(); await nextTick();
  expect(originalPanel.parentElement).toBe(document.body);
  expect(originalPanel.style.display).toBe('none');
  const replacement = document.createElement('div'); root.append(replacement); target.value = replacement;
  await nextTick(); await nextTick();
  expect(replacement.querySelector('.assistant-panel')).toBe(originalPanel);
  expect(originalPanel.style.display).not.toBe('none');
  expect(originalPanel.querySelector('textarea')!.value).toBe('保留草稿');
  expect(assistant.displayMode).toBe('fullscreen');
});

it('prepares a starter draft with the current document without sending', async () => {
  const { workspace, assistant } = await mountEmptyConversation();
  root.querySelector<HTMLButtonElement>('.assistant-starters button')!.click();
  await nextTick();
  expect(assistant.prompt).toBe('Summarize this note and extract its key ideas and main points.');
  expect(assistant.files).toEqual([workspace.active!.id]);
  expect(assistant.session!.messages).toHaveLength(0);
  expect(document.activeElement).toBe(root.querySelector('textarea'));
  root.querySelector<HTMLButtonElement>('.assistant-starters button')!.click();
  expect(assistant.files).toHaveLength(1);
});

it('selects a model in the composer and dismisses menus without losing focus', async () => {
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
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  root.querySelector('textarea')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(root.querySelector('#assistant-model-options')).toBeNull();
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
  root.querySelector<HTMLButtonElement>('[aria-label="搜索模型列表"]')!.click(); await nextTick();
  const search = root.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!;
  search.value = 'previous-model'; search.dispatchEvent(new Event('input')); await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="选择模型连接"]')!.click(); await nextTick();
  const connections = root.querySelectorAll<HTMLButtonElement>('#assistant-model-options .assistant-detail-option');
  connections[1]!.click();
  await vi.waitFor(() => expect(root.querySelector('.assistant-connection-option')).not.toBeNull());
  expect(assistant.connectionId).toBe(connection.id);
  expect(assistant.modelId).toBe('');
  expect(root.querySelector('.assistant-connection-option')!.textContent).toContain('备用连接');
  expect(root.querySelector('[aria-label="搜索模型"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="搜索模型列表"]')!.click(); await nextTick();
  expect(root.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!.value).toBe('');
  expect(root.querySelector('#assistant-model-options')).not.toBeNull();
});

it('searches all discovered models, preserves a custom selection and accepts manual IDs after discovery fails', async () => {
  const { assistant } = await mountEmptyConversation();
  await vi.waitFor(() => expect(assistant.modelsLoading).toBe(false));
  assistant.models = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  await assistant.selectModel('custom-model');
  root.querySelector<HTMLButtonElement>('[aria-label="选择助手模型"]')!.click(); await nextTick();
  expect(root.querySelector('[aria-label="使用模型 custom-model"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelectorAll('.assistant-model-option')).toHaveLength(6);
  expect(root.querySelector('[aria-label="查看全部模型"]')).toBeNull();
  expect(root.querySelector('[aria-label="搜索模型"]')).toBeNull();
  const searchToggle = root.querySelector<HTMLButtonElement>('[aria-label="搜索模型列表"]')!;
  expect(searchToggle.getAttribute('aria-expanded')).toBe('false');
  searchToggle.click(); await nextTick();
  let search = root.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!;
  expect(document.activeElement).toBe(search);
  expect(searchToggle.getAttribute('aria-expanded')).toBe('true');
  search.value = 'ECHO'; search.dispatchEvent(new Event('input')); await nextTick();
  expect(root.querySelectorAll('.assistant-model-option')).toHaveLength(1);
  searchToggle.click(); await nextTick();
  expect(root.querySelector('[aria-label="搜索模型"]')).toBeNull();
  expect(root.querySelectorAll('.assistant-model-option')).toHaveLength(6);
  expect(document.activeElement).toBe(searchToggle);
  searchToggle.click(); await nextTick();
  search = root.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!;
  expect(search.value).toBe('');
  search.value = 'ECHO'; search.dispatchEvent(new Event('input')); await nextTick();
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

it('uses an inline reference picker to attach a document', async () => {
  const { workspace, assistant } = await mountEmptyConversation();
  root.querySelector<HTMLButtonElement>('[aria-label="添加内容"]')!.click(); await nextTick();
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
