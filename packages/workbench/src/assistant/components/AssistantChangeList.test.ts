// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, markRaw, nextTick, reactive } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { AssistantProposal, WorkspaceAdapter } from '@tano/protocol';
import { configureWorkbench, createLocalExtensions } from '../../runtime';
import AssistantChangeList from './AssistantChangeList.vue';

let app: ReturnType<typeof createApp>, root: HTMLDivElement;
let pinia: ReturnType<typeof createPinia> | undefined;
afterEach(() => {
  app?.unmount();
  root?.remove();
  if (pinia) {
    disposePinia(pinia);
    pinia = undefined;
  }
});
it('groups file operations within one turn, expands differences lazily, and routes each review separately', async () => {
  const proposals = reactive<AssistantProposal[]>([
    { id: '1', runId: 'run', workspaceId: 'workspace', kind: 'edit', fileId: 'abc123', path: 'note.md', base: 'old', content: 'new', status: 'ready', reason: 'edit' },
    { id: '2', runId: 'run', workspaceId: 'workspace', kind: 'rename', fileId: 'abc123', path: 'note.md', destination: 'renamed.md', base: 'old', content: 'old', status: 'ready', reason: 'rename' },
    { id: '3', runId: 'run', workspaceId: 'workspace', kind: 'delete', fileId: 'abc456', path: 'obsolete.md', base: 'obsolete', content: '', status: 'ready', reason: 'delete', preview: { before: 'obsolete', after: '', path: 'obsolete.md', diskHash: 'hash' } },
    { id: '4', runId: 'run', workspaceId: 'workspace', kind: 'create', path: 'new.md', base: '', content: 'created', status: 'rejected', reason: 'create' },
  ]);
  const review = vi.fn(), reject = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AssistantChangeList, { proposals, busy: false, onReview: review, onReject: reject })); app.mount(root);
  expect(root.querySelectorAll('.assistant-change-list')).toHaveLength(1);
  expect(root.querySelectorAll('.assistant-file-change')).toHaveLength(3);
  expect(root.textContent).toContain('3 个文件 · 4 项操作');
  expect(root.querySelector('.change-diff')).toBeNull();
  root.querySelector<HTMLElement>('summary')!.click();
  await vi.waitFor(() => expect(root.querySelectorAll('.assistant-proposal')).toHaveLength(2));
  expect(root.querySelector('.change-diff')!.textContent).toContain('new');
  expect(root.querySelector('.proposal-path')!.textContent).toContain('note.md → renamed.md');
  const preview = [...root.querySelectorAll('button')].filter(button => button.textContent?.includes('查看差异'));
  preview[1].click(); expect(review).toHaveBeenLastCalledWith(proposals[1]);
  root.querySelectorAll<HTMLElement>('summary')[1].click();
  await vi.waitFor(() => expect(root.querySelectorAll('.assistant-proposal')).toHaveLength(3));
  const deletion = [...root.querySelectorAll('button')].find(button => button.textContent === '删除文件')!;
  deletion.click(); expect(review).toHaveBeenLastCalledWith(proposals[2], true);
  proposals[2].status = 'applied'; await nextTick();
  expect(root.querySelectorAll('summary')[1].querySelector('small')).toBeNull();
  expect([...root.querySelectorAll('button')].some(button => button.textContent === '删除文件')).toBe(false);
  expect([...root.querySelectorAll('button')].some(button => button.textContent === '撤回内容')).toBe(false);
});

it('renders structured PluginToolProposalCard for write and external plugin proposals with real receipts', async () => {
  const proposals = reactive<AssistantProposal[]>([
    {
      id: 'p-write',
      runId: 'run',
      workspaceId: 'workspace',
      kind: 'plugin',
      path: '项目看板 · 新建卡片',
      base: '',
      content: JSON.stringify({ title: '上线评审', column: 'doing' }, null, 2),
      reason: '按用户要求新增看板卡片',
      status: 'ready',
      preview: { before: '', after: '{}', diskHash: null, path: '项目看板 · 新建卡片' },
      pluginAction: {
        pluginId: 'kanban',
        pluginName: '项目看板',
        toolName: 'create_card',
        label: '新建卡片',
        effect: 'write',
      },
    },
    {
      id: 'p-ext',
      runId: 'run',
      workspaceId: 'workspace',
      kind: 'plugin',
      path: 'GitHub 同步 · 创建 Issue',
      base: '',
      content: JSON.stringify({ repo: 'tano/core', title: 'Bug report' }, null, 2),
      reason: '同步问题到外部仓库',
      status: 'ready',
      preview: { before: '', after: '{}', diskHash: null, path: 'GitHub 同步 · 创建 Issue' },
      pluginAction: {
        pluginId: 'github-sync',
        pluginName: 'GitHub 同步',
        toolName: 'create_issue',
        label: '创建 Issue',
        effect: 'external',
      },
    },
  ]);
  const review = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(AssistantChangeList, { proposals, busy: false, onReview: review }));
  app.mount(root);
  await nextTick();

  // Plugin proposals are expanded by default and omit "0 个文件 ·"
  expect(root.textContent).not.toContain('0 个文件');
  expect(root.textContent).toContain('2 项操作');
  expect(root.querySelectorAll('.plugin-tool-card')).toHaveLength(2);
  expect(root.textContent).toContain('写入操作 · 需确认');
  expect(root.textContent).toContain('外部调用 · 需确认');
  expect(root.textContent).toContain('上线评审');
  expect(root.textContent).toContain('tano/core');
  expect(root.querySelector('.change-diff')).toBeNull();

  const extBtn = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('确认发起外部调用'))!;
  extBtn.click();
  expect(review).toHaveBeenCalledWith(proposals[1], true);

  proposals[0].status = 'applied';
  proposals[0].applied = {
    before: '',
    after: JSON.stringify({ id: 'card-9', created: true }, null, 2),
    hash: 'create_card',
    fileId: 'kanban',
  };
  await nextTick();
  expect(root.textContent).toContain('真实执行回执');
  expect(root.textContent).toContain('card-9');
});

it('delegates custom plugin proposal cards, undo hooks, and follow-up events to WorkbenchExtensions.assistant', async () => {
  const CustomCard = markRaw(
    defineComponent({
      props: { proposal: { type: Object, required: true } },
      emits: ['sendFollowUp'],
      setup(props, { emit }) {
        return () =>
          h('div', { class: 'custom-ext-card' }, [
            h('span', `CUSTOM:${(props.proposal as AssistantProposal).id}`),
            h(
              'button',
              {
                class: 'trigger-follow-up',
                onClick: () => emit('sendFollowUp', { prompt: '请修复草稿', autoSend: true }),
              },
              '发回修复',
            ),
          ]);
      },
    }),
  );

  pinia = createPinia();
  setActivePinia(pinia);
  const ext = {
    ...createLocalExtensions(),
    assistant: {
      listTools: () => [],
      executeTool: async () => undefined,
      canUndoProposal: () => true,
      proposalCard: () => ({
        component: CustomCard,
        kindLabel: '定制扩展卡',
        applyLabel: '确认定制操作',
        defaultOpen: true,
        hideDefaultDiff: true,
      }),
    },
  };
  configureWorkbench(pinia, {
    adapter: { mode: 'web' } as WorkspaceAdapter,
    native: false,
    mobile: false,
    extensions: () => ext,
  });

  const proposals = reactive<AssistantProposal[]>([
    {
      id: 'ext-1',
      runId: 'run',
      workspaceId: 'workspace',
      kind: 'plugin',
      path: '扩展动作',
      base: '',
      content: '{}',
      reason: '测试扩展卡',
      status: 'applied',
      applied: { before: '{}', after: '{}', hash: 'op', fileId: 'ext' },
      pluginAction: { pluginId: 'ext.custom', pluginName: 'Custom', toolName: 'op', effect: 'write' },
    },
  ]);
  const undo = vi.fn();
  const followUp = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() =>
    h(AssistantChangeList, { proposals, busy: false, onUndo: undo, onSendFollowUp: followUp }),
  ).use(pinia);
  app.mount(root);
  await nextTick();

  expect(root.querySelector('.custom-ext-card')?.textContent).toContain('CUSTOM:ext-1');
  expect(root.textContent).toContain('定制扩展卡');
  root.querySelector<HTMLButtonElement>('.trigger-follow-up')!.click();
  expect(followUp).toHaveBeenCalledWith({ prompt: '请修复草稿', autoSend: true });
  const undoBtn = root.querySelector<HTMLButtonElement>('.change-undo-action')!;
  undoBtn.click();
  expect(undo).toHaveBeenCalledWith(proposals[0]);
});

it('renders and undoes first-class kind="extension" proposals via stateless runtime.assistantExtension without invoking runtime.extensions()', async () => {
  const CustomCard = markRaw(
    defineComponent({
      props: { proposal: { type: Object, required: true }, busy: Boolean },
      setup(props) {
        return () => h('div', { class: 'first-class-ext-card' }, `EXT:${props.proposal.extensionAction?.namespace}:${props.proposal.extensionAction?.action}`);
      },
    }),
  );
  const lazyExtensionsSpy = vi.fn(() => createLocalExtensions());

  pinia = createPinia();
  setActivePinia(pinia);
  configureWorkbench(pinia, {
    adapter: { mode: 'web' } as WorkspaceAdapter,
    native: false,
    mobile: false,
    assistantExtension: {
      listTools: () => [],
      executeTool: async () => undefined,
      canUndoProposal: (proposal) => Boolean(proposal.applied?.undoSnapshot),
      proposalCard: (proposal) =>
        proposal.kind === 'extension'
          ? {
              component: CustomCard,
              kindLabel: '工作台微调',
              applyLabel: '应用工作台微调',
              defaultOpen: true,
              hideDefaultDiff: true,
            }
          : undefined,
    },
    extensions: lazyExtensionsSpy,
  });

  const proposals = reactive<AssistantProposal[]>([
    {
      id: 'ext-first-class',
      runId: 'run',
      workspaceId: 'workspace',
      kind: 'extension',
      path: '工作台微调 · 全局',
      base: '',
      content: '{"scope":"user","patch":{}}',
      reason: '第一公民扩展提案',
      status: 'applied',
      applied: { before: '', after: '{}', hash: 'apply_overlay', fileId: 'tano.overlay', undoSnapshot: '{"scope":"user","previous":null}' },
      extensionAction: {
        namespace: 'tano.overlay',
        action: 'apply_overlay',
        label: '应用工作台微调',
        effect: 'write',
        payload: { scope: 'user', patch: {} },
      },
    },
  ]);
  const undo = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(AssistantChangeList, { proposals, busy: false, onUndo: undo })).use(pinia);
  app.mount(root);
  await nextTick();

  expect(lazyExtensionsSpy).not.toHaveBeenCalled();
  expect(root.querySelector('.first-class-ext-card')?.textContent).toBe('EXT:tano.overlay:apply_overlay');
  root.querySelector<HTMLButtonElement>('.change-undo-action')!.click();
  expect(undo).toHaveBeenCalledWith(proposals[0]);
});
