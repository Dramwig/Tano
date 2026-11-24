import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
import { documentLinks, referenceInsertionPoint } from '@tano/editor/document-links';
import {
  basename,
  referenceMarkdown,
  referenceUrl,
  type AssistantProposal,
  type CommentKind,
  type CommentThread,
  type ReferenceTarget,
} from '@tano/protocol';
import { createButterflyIdleTrigger } from '../assistant/butterfly-idle';
import type { ButterflyController } from '../assistant/butterfly';
import { inlineAssistantResult } from '../assistant/inline-result';
import { assistantDiscussionPrompt } from '../assistant/language';
import { assistantSourceRange } from '../assistant/source-selection';
import type { useAssistantStore, useInlineAssistantStore } from '../assistant/store';
import type { InlineAssistantAnchor } from '../assistant/components/InlineAssistantInput.vue';
import { isTableTab, tableFileId } from '../data-tables/data-tables';
import { t } from '../i18n/i18n';
import type { WorkbenchExtensions } from '../runtime';
import { selectionTodoSession, type SelectionTodoSession } from '../plans/selection-todo';
import type { OpenDocument, useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { DocumentComments, MarkdownEditor, SourceEditor } from '../shell/workbench-async-components';

export type InlineAssistantTarget = {
  paneId: string;
  fileId: string;
  text: string;
  sourceSelection: { text: string; from?: number; to?: number };
  anchor: InlineAssistantAnchor;
  blankBlock?: boolean;
  sessionId?: string;
};

type AssistantEditorSelection = {
  text: string;
  spans: { from: number; to: number; text: string }[];
  from?: number;
  to?: number;
};

export interface InlineAssistantDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  inlineRunner: ReturnType<typeof useInlineAssistantStore>;
  butterfly: ButterflyController;
  editing: WorkbenchExtensions['editing'];
  activeWindow: Ref<WindowContext>;
  sidebar: Ref<boolean>;
  paneEditors: Map<string, InstanceType<typeof MarkdownEditor>>;
  paneSourceEditors: Map<string, InstanceType<typeof SourceEditor>>;
  paneComments: Map<string, InstanceType<typeof DocumentComments>>;
  paneSelections: Record<string, EditorSelectionContext>;
  paneSourceSelections: Record<string, boolean>;
  paneSource: (id: string) => boolean;
  paneReadonly: (doc: OpenDocument) => boolean;
  source: Ref<boolean>;
  editor: Ref<InstanceType<typeof MarkdownEditor> | undefined>;
  sourceEditor: Ref<InstanceType<typeof SourceEditor> | undefined>;
  paneButterflyScope: (paneId: string, fileId: string) => string;
}

export function useInlineAssistant(deps: InlineAssistantDeps) {
  const {
    store,
    assistant,
    inlineRunner,
    butterfly,
    editing,
    activeWindow,
    sidebar,
    paneEditors,
    paneSourceEditors,
    paneComments,
    paneSelections,
    paneSourceSelections,
    paneSource,
    paneReadonly,
    source,
    editor,
    sourceEditor,
    paneButterflyScope,
  } = deps;
  const { workspace } = storeToRefs(store);

  const inlineAssistant = shallowRef<InlineAssistantTarget>();
  const inlineAssistantPrompt = ref('');
  const inlineAssistantState = ref<'input' | 'loading' | 'completed' | 'response' | 'error'>('input');
  const inlineAssistantError = ref('');
  const inlineAssistantMessage = ref('');
  let inlineAssistantProposal: AssistantProposal | undefined;

  watch(
    () => [store.activePaneId, store.activeId, store.workspace?.id, store.workspace?.path],
    ([paneId, fileId, workspaceId, workspacePath], previous) => {
      if (
        inlineAssistant.value &&
        (inlineAssistant.value.paneId !== paneId ||
          inlineAssistant.value.fileId !== fileId ||
          workspaceId !== previous[2] ||
          workspacePath !== previous[3])
      )
        closeInlineAssistant();
    },
  );

  /** The page owns one lightweight AI task. Keep a running task attached to its card. */
  function assistantTaskActive() {
    return inlineAssistantState.value === 'loading' || inlineRunner.busy || inlineRunner.applying;
  }

  function closeInlineAssistant() {
    inlineAssistant.value?.anchor.dispose();
    inlineAssistant.value = undefined;
    inlineAssistantPrompt.value = '';
    inlineAssistantError.value = '';
    inlineAssistantState.value = 'input';
    inlineAssistantMessage.value = '';
    inlineAssistantProposal = undefined;
  }

  function openInlineAssistant(
    paneId: string,
    fileId: string,
    text: string,
    sourceSelection: { text: string; from?: number; to?: number } = { text },
    options: { anchor?: InlineAssistantAnchor; blankBlock?: boolean } = {},
  ) {
    const { document } = activeWindow.value;
    if (assistantTaskActive()) {
      options.anchor?.dispose();
      return;
    }
    const anchor = options.anchor ?? paneEditors.get(paneId)?.captureVisualAnchor({ highlight: true });
    if (!anchor || (!text.trim() && !options.blankBlock) || !assistant.connection || !assistant.modelId) {
      anchor?.dispose();
      return openAssistant(paneId, fileId, { forcePanel: true });
    }
    closeInlineAssistant();
    inlineAssistant.value = {
      paneId,
      fileId,
      text,
      sourceSelection,
      anchor,
      ...(options.blankBlock ? { blankBlock: true } : {}),
    };
    inlineAssistantState.value = 'input';
    void nextTick(() =>
      document.querySelector<HTMLInputElement>(`[aria-label="${t('输入助手任务')}"]`)?.focus(),
    );
  }

  async function submitInlineAssistant() {
    const target = inlineAssistant.value;
    const request = inlineAssistantPrompt.value.trim();
    if (!target || !request || inlineAssistantState.value !== 'input') return;
    inlineAssistantState.value = 'loading';
    inlineAssistantError.value = '';
    try {
      // Keep this one-shot path out of the visible conversation while reusing the
      // same guarded direct-edit execution and conflict checks as the full panel.
      const wholeEmptyDocument =
        target.blankBlock &&
        target.sourceSelection.from === undefined &&
        target.sourceSelection.to === undefined;
      if (inlineRunner.loading) throw new Error(t('助手正在初始化，请稍后重试'));
      inlineRunner.connections = assistant.connections.map((connection) => ({ ...connection }));
      inlineRunner.connectionId = assistant.connectionId;
      inlineRunner.modelId = assistant.modelId;
      inlineRunner.reasoningEffort = assistant.reasoningEffort;
      inlineRunner.newSession();
      target.sessionId = inlineRunner.session?.id;
      inlineRunner.files = [target.fileId];
      inlineRunner.selection = wholeEmptyDocument
        ? null
        : { fileId: target.fileId, ...target.sourceSelection };
      inlineRunner.prompt = request;
      const previousReplyId = inlineRunner.session?.messages.at(-1)?.id;
      await inlineRunner.send();
      if (inlineAssistant.value !== target) return;
      const reply = inlineRunner.session?.messages.at(-1);
      const result = inlineAssistantResult(
        reply && reply.id !== previousReplyId && reply.role === 'assistant' ? reply : undefined,
        inlineRunner.error,
      );
      inlineAssistantProposal = result.proposal;
      inlineAssistantMessage.value = result.message;
      inlineAssistantError.value = result.state === 'error' ? result.message : '';
      inlineAssistantState.value = result.state;
    } catch (error) {
      if (inlineAssistant.value !== target) return;
      inlineAssistantError.value = error instanceof Error ? error.message : String(error);
      inlineAssistantState.value = 'error';
    }
  }

  function openBlankBlockAssistant(paneId: string, fileId: string) {
    if (!assistant.available) return;
    const ed = paneEditors.get(paneId) as unknown as
      | {
          assistantBlankBlockSelection?: () => { text: string; from?: number; to?: number } | null;
          captureBlankBlockAnchor?: () => InlineAssistantAnchor | null;
        }
      | undefined;
    const selection = ed?.assistantBlankBlockSelection?.();
    const anchor = ed?.captureBlankBlockAnchor?.();
    if (!selection || selection.from === undefined || !anchor) {
      anchor?.dispose();
      return;
    }
    const doc = store.documentForTab(fileId);
    const target = doc?.content === '' ? { text: '' } : selection;
    openInlineAssistant(paneId, fileId, '', target, { anchor, blankBlock: true });
  }

  async function undoInlineAssistant() {
    if (inlineAssistantProposal) await inlineRunner.undo(inlineAssistantProposal);
    closeInlineAssistant();
  }

  function continueInlineConversation() {
    const target = inlineAssistant.value;
    if (!target) return;
    const completedSession = inlineRunner.session;
    let capturedSelection: InlineAssistantTarget['sourceSelection'] | undefined;
    if (
      completedSession &&
      completedSession.id === target.sessionId &&
      !inlineRunner.busy &&
      !inlineRunner.applying
    ) {
      // Transfer a snapshot only after the independent run has finished saving.
      const snapshot = JSON.parse(JSON.stringify(completedSession));
      const index = assistant.sessions.findIndex((session) => session.id === completedSession.id);
      if (index < 0) assistant.sessions.unshift(snapshot);
      else assistant.sessions[index] = snapshot;
      if (!assistant.busy && !assistant.applying) {
        assistant.selectSession(completedSession.id);
        // The editor selection has already collapsed when focus moved to the
        // inline input. Carry the original task scope through the panel handoff.
        const selected = inlineRunner.selection;
        if (selected?.fileId === target.fileId)
          capturedSelection = { text: selected.text, from: selected.from, to: selected.to };
      } else store.report(t('选区任务已加入会话列表，当前会话结束后可切换继续。'));
    }
    openAssistant(target.paneId, target.fileId, { forcePanel: true, capturedSelection });
    closeInlineAssistant();
  }

  function captureButterflyTextTarget(paneId: string, fileId: string) {
    if (paneSource(fileId)) return null;
    const anchor = paneEditors.get(paneId)?.captureVisualAnchor();
    if (!anchor) return null;
    const scope = paneButterflyScope(paneId, fileId);
    const id = `text:${scope}:${crypto.randomUUID()}`;
    const registration = butterfly.registerTarget({
      id,
      scope,
      get label() {
        return t('所选文字');
      },
      kind: 'text',
      temporary: true,
      element: () => anchor.element,
      rects: anchor.getRects,
      onDispose: anchor.dispose,
      available: () =>
        !paneSource(fileId) &&
        store.panes.some((pane) => pane.id === paneId && pane.activeId === fileId),
    });
    return { id, dispose: registration.dispose };
  }

  let butterflyIdle: ReturnType<typeof createButterflyIdleTrigger> | undefined;
  onMounted(() => {
    butterflyIdle = createButterflyIdleTrigger({
      selection: () => {
        if (paneSource(store.activeId)) return null;
        const selection = paneEditors.get(store.activePaneId)?.visualSelection();
        return selection
          ? { ...selection, scope: paneButterflyScope(store.activePaneId, store.activeId) }
          : null;
      },
      enabled: () =>
        butterfly.state.enabled &&
        butterfly.state.phase === 'docked' &&
        !assistant.busy &&
        !assistant.applying,
      onIdle: () => {
        const target = captureButterflyTextTarget(store.activePaneId, store.activeId);
        if (target) void butterfly.flyTo(target.id);
      },
    });
  });
  watch(
    () => [
      butterfly.state.scope,
      butterfly.state.enabled,
      butterfly.state.phase,
      assistant.busy,
      assistant.applying,
      paneSource(store.activeId),
      paneEditors.get(store.activePaneId),
      paneSelections[store.activePaneId],
    ],
    () => butterflyIdle?.refresh(),
    { flush: 'post' },
  );
  onBeforeUnmount(() => butterflyIdle?.dispose());

  // Selection-to-todo dialog
  const selectionTodo = shallowRef<SelectionTodoSession>();

  function showSourceTodo(paneId: string, doc: OpenDocument) {
    return (
      paneSource(doc.id) &&
      !!paneSourceSelections[paneId] &&
      store.capabilities.features.objectReferences &&
      !paneReadonly(doc) &&
      !editing.isManaging(doc.id)
    );
  }

  function beginSelectionTodo(paneId: string, fileId: string) {
    const scope = workspace.value;
    const doc = store.documentForTab(fileId);
    if (
      !scope ||
      !doc ||
      paneReadonly(doc) ||
      editing.isManaging(fileId) ||
      !store.capabilities.features.objectReferences
    )
      return;
    const captured = (
      paneSource(fileId) ? paneSourceEditors.get(paneId) : paneEditors.get(paneId)
    )?.captureTodoSelection();
    if (!captured) {
      store.report(t('请先选择要创建任务或事件的文字'));
      return;
    }
    const sourceSpan = paneSource(fileId)
      ? paneSourceEditors.get(paneId)?.assistantSelection()?.spans[0]
      : paneEditors.get(paneId)?.assistantSelection();
    const location = sourceSpan
      ? { text: sourceSpan.text, from: sourceSpan.from, to: sourceSpan.to }
      : { text: captured.text };
    const expected = { id: scope.id, path: scope.path, content: doc.content };
    const refSource: ReferenceTarget = {
      workspace: scope.id,
      type: 'document',
      id: doc.id,
      path: doc.path,
      name: basename(doc.path).replace(/\.(md|markdown)$/i, ''),
    };
    function originalDocument() {
      if (workspace.value?.id !== expected.id || workspace.value.path !== expected.path)
        throw new Error(t('工作区已切换，请返回原工作区后重试'));
      const original = store.documentForTab(fileId);
      if (
        !original ||
        paneReadonly(original) ||
        original.missing ||
        editing.isManaging(fileId) ||
        !store.capabilities.features.objectReferences
      )
        throw new Error(t('原文档已关闭或不可编辑，请重新打开原文档'));
      return original;
    }
    selectionTodo.value = selectionTodoSession(
      captured.text,
      refSource,
      {
        create: (draft) => {
          if (originalDocument().content !== expected.content)
            throw new Error(t('原文已变化，请重新选择文字'));
          return store.createObject(draft);
        },
        insert: async (record, append) => {
          const original = originalDocument();
          const url = referenceUrl(record.object);
          const alreadyInserted = documentLinks(original.content).some((link) => link.target === url);
          if (!alreadyInserted) {
            if (append)
              store.editDocument(
                fileId,
                `${original.content.replace(/\n*$/, '')}\n\n${referenceMarkdown(record.object, record.object.name)}\n`,
              );
            else {
              if (original.content !== expected.content)
                throw new Error(t('原文或选区已变化，任务已保留；可在原文末尾插入引用'));
              if (!captured.insert(record.object, record.object.name)) {
                const range = assistantSourceRange(original.content, location);
                if (!range)
                  throw new Error(t('原文或选区已变化，任务已保留；可在原文末尾插入引用'));
                const point = referenceInsertionPoint(original.content, range.to);
                const link = `${point.prefix}${referenceMarkdown(record.object, record.object.name)}${point.suffix}`;
                store.editDocument(
                  fileId,
                  original.content.slice(0, point.at) + link + original.content.slice(point.at),
                );
              }
            }
          }
          await nextTick();
          if (!documentLinks(original.content).some((link) => link.target === url))
            throw new Error(t('任务已保留，当前选区不能插入引用；可在原文末尾插入引用'));
          await store.flush();
          if (original.conflict || original.missing || original.error || store.dirty(original))
            throw new Error(t('任务已保留，原文保存发生冲突或失败，请处理文档提示后重试'));
        },
      },
      { workspaceName: scope.name, source: { workspaceId: scope.id, fileId: doc.id, selection: location } },
    );
  }

  // Full assistant panel handoff & discussion
  function openAssistant(
    paneId = store.activePaneId,
    fileId = store.activeId,
    options: { forcePanel?: boolean; capturedSelection?: InlineAssistantTarget['sourceSelection'] } = {},
  ) {
    const { window: activeWin } = activeWindow.value;
    const forcePanel = options.forcePanel;
    const tableId = isTableTab(fileId) ? tableFileId(fileId) : undefined;
    // forcePanel chooses the surface, not the context: the launcher still uses
    // the current selection before the panel takes focus.
    const selected: AssistantEditorSelection | null =
      (tableId
        ? null
        : paneSource(fileId)
          ? paneSourceEditors.get(paneId)?.assistantSelection()
          : paneSelections[paneId]?.textSelected
            ? ((paneEditors.get(paneId) as unknown as {
                assistantSelection?: () => AssistantEditorSelection | null;
              })?.assistantSelection?.() ?? null)
            : null) ?? null;
    const text = selected?.spans.map((span) => span.text).join('\n');
    const span = paneSource(fileId) && selected?.spans.length === 1 ? selected.spans[0] : undefined;
    const taskSelection = text
      ? {
          text: span?.text ?? selected?.text ?? text,
          ...(span
            ? { from: span.from, to: span.to }
            : selected?.from !== undefined
              ? { from: selected.from, to: selected.to }
              : {}),
        }
      : undefined;
    if (!forcePanel && !tableId && text) {
      openInlineAssistant(paneId, fileId, text, taskSelection!);
      return;
    }
    store.focusPane(paneId);
    assistant.open(
      tableId ?? (store.documentForTab(fileId) ? store.documentForTab(fileId)?.id : undefined),
      options.capturedSelection ?? taskSelection,
    );
    if (activeWin.innerWidth < 1100) sidebar.value = false;
  }

  function toggleAssistant() {
    if (!workspace.value || !assistant.available) return;
    if (assistant.opened) {
      assistant.opened = false;
      void nextTick(() => {
        if (!assistant.opened) (source.value ? sourceEditor.value : editor.value)?.focus();
      });
    } else openAssistant(store.activePaneId, store.activeId, { forcePanel: true });
  }

  function startDocumentDraft(paneId: string, fileId: string) {
    const { window: activeWin } = activeWindow.value;
    store.focusPane(paneId);
    assistant.startDocumentDraft(fileId);
    if (activeWin.innerWidth < 1100) sidebar.value = false;
  }

  function discussWithAssistant(
    paneId: string,
    fileId: string,
    request: {
      kind: CommentKind;
      thread: CommentThread;
      quote?: string;
    },
  ) {
    const { window: activeWin } = activeWindow.value;
    if (assistant.busy || assistant.applying) return;
    const comments = paneComments.get(paneId);
    const epoch = store.assistantEpoch;
    store.focusPane(paneId);
    assistant.open(fileId);
    assistant.setBuiltInPrompt(
      assistantDiscussionPrompt(
        request.quote,
        request.thread.messages.map((message) => ({ author: message.authorName, body: message.body })),
      ),
    );
    assistant.replyTarget = {
      label: request.thread.messages[0]?.body.slice(0, 40) ?? t('文档讨论'),
      draft: async (body) => {
        if (
          store.assistantEpoch !== epoch ||
          store.panes.find((pane) => pane.id === paneId)?.activeId !== fileId ||
          paneComments.get(paneId) !== comments ||
          !comments
        )
          throw new Error(t('原讨论页面已变化，请重新打开原讨论'));
        await comments.assistantReply(request.kind, request.thread.id, body);
      },
    };
    if (activeWin.innerWidth < 1100) sidebar.value = false;
  }

  return {
    inlineAssistant,
    inlineAssistantPrompt,
    inlineAssistantState,
    inlineAssistantError,
    inlineAssistantMessage,
    assistantTaskActive,
    closeInlineAssistant,
    openInlineAssistant,
    submitInlineAssistant,
    openBlankBlockAssistant,
    undoInlineAssistant,
    continueInlineConversation,
    selectionTodo,
    showSourceTodo,
    beginSelectionTodo,
    openAssistant,
    toggleAssistant,
    startDocumentDraft,
    discussWithAssistant,
  };
}
