import type { Ref } from 'vue';
import {
  isDataTableFilePath,
  type AssistantProposal,
  type AssistantSession,
  type AssistantTransport,
} from '@tano/protocol';
import { uiLocale } from '../i18n/i18n';
import { canPluginToolExecute } from '../plugins/assistant-bridge';
import { resolveAssistantExtension, type useWorkbenchRuntime } from '../runtime';
import { useSuggestionStore } from '../stores/suggestions';
import type { useWorkspaceStore } from '../stores/workspace';
import type { AssistantExecutionResult } from './execution';
import { assistantCopy, formatAssistantText } from './language';

export interface AssistantScopeSnapshot {
  id: string;
  path: string;
  epoch: number;
}

export interface AssistantProposalActionDeps {
  workspace: ReturnType<typeof useWorkspaceStore>;
  runtime: ReturnType<typeof useWorkbenchRuntime>;
  transport: AssistantTransport | undefined;
  guard?: () => Promise<void>;
  busy: Ref<boolean>;
  applying: Ref<boolean>;
  error: Ref<string>;
  progress: Ref<string>;
  session: Ref<AssistantSession | null>;
  scope: () => AssistantScopeSnapshot;
  persist: (target?: AssistantSession | null) => Promise<void>;
  isManaged: (fileId: string) => boolean;
}

export function createAssistantProposalActions(deps: AssistantProposalActionDeps) {
  const { workspace, runtime, transport, guard, busy, applying, error, progress, session, scope, persist, isManaged } = deps;

  async function executeChange(
    proposal: AssistantProposal,
    target: AssistantSession,
    expected: AssistantScopeSnapshot,
    signal: AbortSignal,
  ): Promise<AssistantExecutionResult> {
    let submitted = false;
    applying.value = true;
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (workspace.workspace?.id !== expected.id || workspace.workspace.path !== expected.path || workspace.assistantEpoch !== expected.epoch)
        throw new Error('工作区已切换，停止执行');
      if (proposal.fileId && isManaged(proposal.fileId)) throw new Error('此文档正由协作会话管理，暂时不能直接修改');
    };
    try {
      await guard?.();
      assertCurrent();
      if (target.messages.some(message => message.proposals?.some(item => item.id !== proposal.id &&
          ['unknown', 'applying'].includes(item.status) && (item.path === proposal.path || (!!proposal.fileId && item.fileId === proposal.fileId)))))
        throw new Error('此目标有结果待核对的操作，请先核对，不自动重试');
      progress.value = formatAssistantText(assistantCopy(uiLocale.value).progress.executing, [proposal.path]);
      const preview = await workspace.reviewAssistantProposal(expected, proposal, undefined, true, signal);
      if (preview.status === 'saved') {
        proposal.applied = preview.applied; proposal.status = 'applied';
      } else {
        proposal.preview = preview.preview;
        if (preview.status !== 'preview' || !preview.preview) {
          proposal.status = preview.status === 'conflict' ? 'conflicted' : 'ready';
          throw new Error('修改存在冲突或文档已变化，已暂停此项操作，请核对原文与建议');
        }
        proposal.status = 'applying';
        await persist(target); // A crash must leave a durable intent, never an invisible write.
        await guard?.();
        assertCurrent();
        submitted = true;
        const result = await workspace.reviewAssistantProposal(expected, proposal, proposal.preview, true, signal);
        if (result.status === 'saved') {
          proposal.applied = result.applied; proposal.status = 'applied'; proposal.error = undefined;
        } else {
          proposal.preview = result.preview;
          proposal.status = result.status === 'conflict' ? 'conflicted' : 'ready';
          proposal.error = '执行前文档发生变化，已暂停此项操作，请核对后处理';
        }
      }
      await persist(target);
    } catch (reason) {
      if (proposal.applied) {
        proposal.status = 'applied';
        proposal.error = `修改已完成，记录或刷新失败：${String(reason)}`;
      } else {
        if (proposal.status === 'applying') proposal.status = submitted ? 'unknown' : 'ready';
        proposal.error = String(reason);
      }
      try { await persist(target); } catch { /* Preserve the in-memory outcome; never retry the write. */ }
    } finally { applying.value = false; }
    const written = proposal.status === 'applied' ? true : proposal.status === 'unknown' ? null : false;
    const result: AssistantExecutionResult = { status: proposal.status, written, ...(proposal.error ? { error: proposal.error } : {}) };
    if (written && proposal.applied) {
      result.fileId = proposal.applied.fileId;
      result.path = proposal.preview?.destination ?? proposal.preview?.path ?? proposal.path;
      // Return committed bytes as a new immutable source; never widen an original selection.
      if (['edit', 'create', 'rename', 'move'].includes(proposal.kind) && !target.messages.some(message => message.id === proposal.runId &&
          message.sources?.some(source => source.fileId === proposal.fileId && source.selection))) {
        result.source = {
          id: '', workspaceId: expected.id, fileId: result.fileId, path: result.path,
          content: proposal.applied.after, hash: proposal.applied.hash, origin: 'disk',
        };
      }
    }
    return result;
  }

  async function review(proposal: AssistantProposal, apply = false) {
    if (busy.value || applying.value || !transport) return;
    if (proposal.suggestionGroupId) { error.value = '此提案已转为文档建议，请在文档中逐项审阅'; return; }
    const expected = scope();
    if (proposal.status === 'applied' || proposal.status === 'rejected') return;
    if (proposal.status === 'unknown' || proposal.status === 'applying') { error.value = '请先核对待确认的写入结果'; return; }
    if (proposal.fileId && isManaged(proposal.fileId)) { error.value = '此文档正由协作会话管理，暂时只能进行问答'; return; }
    applying.value = true; error.value = '';
    const target = session.value;
    const originalStatus = proposal.status;
    let submitting = false;
    try {
      if (proposal.kind === 'extension') {
        const extAction = proposal.extensionAction;
        if (!extAction) throw new Error('扩展操作元数据缺失');
        if (!apply) {
          proposal.preview = { before: '', after: proposal.content, diskHash: null, path: proposal.path };
          proposal.status = 'ready';
          await persist(target);
          return;
        }
        const assistantExtension = resolveAssistantExtension(runtime);
        if (!assistantExtension?.applyProposal) throw new Error('当前宿主未注册该扩展操作处理器');
        proposal.status = 'applying';
        await persist(target);
        submitting = true;
        const extApplied = await assistantExtension.applyProposal(proposal, extAction.payload);
        if (!extApplied) throw new Error('当前宿主不支持执行此扩展操作');
        proposal.applied = {
          before: extApplied.before ?? '',
          after: extApplied.after,
          hash: extApplied.hash,
          fileId: extApplied.fileId,
          ...(extApplied.undoSnapshot !== undefined ? { undoSnapshot: extApplied.undoSnapshot } : {}),
        };
        proposal.status = 'applied';
        proposal.error = undefined;
        await persist(target);
        return;
      }
      if (proposal.kind === 'plugin') {
        const action = proposal.pluginAction;
        if (!action) throw new Error('插件操作元数据缺失');
        if (!apply) {
          proposal.preview = { before: '', after: proposal.content, diskHash: null, path: proposal.path };
          proposal.status = 'ready';
          await persist(target);
          return;
        }
        const parsedArgs = JSON.parse(proposal.content) as Record<string, unknown>;
        const assistantExtension = resolveAssistantExtension(runtime);
        if (assistantExtension?.applyProposal) {
          proposal.status = 'applying';
          await persist(target);
          submitting = true;
          const extApplied = await assistantExtension.applyProposal(proposal, parsedArgs);
          if (extApplied) {
            proposal.applied = {
              before: extApplied.before ?? '',
              after: extApplied.after,
              hash: extApplied.hash,
              fileId: extApplied.fileId,
              ...(extApplied.undoSnapshot !== undefined ? { undoSnapshot: extApplied.undoSnapshot } : {}),
            };
            proposal.status = 'applied';
            proposal.error = undefined;
            await persist(target);
            return;
          }
          submitting = false;
        }
        const installation = workspace.installedPlugins.find(item => item.manifest.id === action.pluginId);
        const toolDef =
          installation?.manifest.manifestVersion === 2
            ? installation.manifest.assistantTools?.find(tool => tool.name === action.toolName)
            : undefined;
        if (!installation || !toolDef || !canPluginToolExecute(installation, toolDef, !!workspace.workspace?.readOnly))
          throw new Error('插件已停用、未授权或受当前工作区策略限制，无法执行此操作');
        proposal.status = 'applying';
        await persist(target);
        submitting = true;
        const output = await workspace.invokePluginAssistantTool(action.pluginId, action.toolName, parsedArgs);
        proposal.applied = {
          before: '',
          after: JSON.stringify(output ?? null, null, 2),
          hash: action.toolName,
          fileId: action.pluginId,
        };
        proposal.status = 'applied';
        proposal.error = undefined;
        await persist(target);
        return;
      }
      const acceptance = apply ? proposal.preview : undefined;
      if (apply && !acceptance) throw new Error('请先查看最新差异');
      if (apply) {
        proposal.status = 'applying';
        await persist(target);
        submitting = true;
      }
      const result = await workspace.reviewAssistantProposal(expected, proposal, acceptance, false, undefined, !!target?.external);
      if (result.status === 'saved') {
        proposal.status = 'applied'; proposal.applied = result.applied; proposal.error = undefined;
      } else {
        proposal.preview = result.preview;
        proposal.status = result.status === 'conflict' ? 'conflicted' : 'ready';
        proposal.error = result.status === 'stale' ? (result.preview ? '文档已变化，请审阅更新后的差异再应用' : '文档在保存时变化，请重新查看差异')
          : result.status === 'conflict' ? '修改存在重叠，原文与建议均已保留' : undefined;
      }
      await persist(target);
      if (target?.external && proposal.id === target.id) await transport.recordExternalResult?.(target);
    } catch (reason) {
      if (proposal.applied) {
        proposal.status = 'applied';
        proposal.error = `内容已保存，会话记录保存失败：${String(reason)}`;
      } else {
        proposal.status = submitting ? 'unknown' : originalStatus;
        proposal.error = String(reason);
      }
      error.value = proposal.error;
      try { await persist(target); } catch { /* Keep the in-memory result visible. */ }
    } finally { applying.value = false; }
  }

  async function publishSuggestions(proposal: AssistantProposal) {
    if (busy.value || applying.value || proposal.kind !== 'edit' || !['ready', 'conflicted'].includes(proposal.status)) return;
    if (isDataTableFilePath(proposal.path)) { error.value = '数据表修改请在助手中查看差异并应用'; return; }
    if (proposal.fileId && isManaged(proposal.fileId)) { error.value = '此文档正由协作会话管理，暂不支持建议模式'; return; }
    applying.value = true;
    const target = session.value;
    try {
      await useSuggestionStore().publish(proposal);
      proposal.suggestionGroupId = proposal.id;
      await persist(target);
      error.value = '';
    } catch (reason) { error.value = String(reason); }
    finally { applying.value = false; }
  }

  async function verify(proposal: AssistantProposal) {
    if (applying.value || busy.value || !proposal.preview) return;
    applying.value = true; error.value = '';
    const target = session.value;
    try {
      const expected = scope();
      if (expected.id !== proposal.workspaceId) throw new Error('工作区已切换');
      const current = await runtime.adapter.refresh();
      if (current.id !== expected.id || current.path !== expected.path) throw new Error('工作区已切换');
      if (['delete', 'rename', 'move'].includes(proposal.kind)) {
        const file = current.files.find(file => file.id === proposal.fileId);
        if (!file) throw new Error('原文件已不存在，无法确认是否由此次操作移除；请核对回收站，保留此记录');
        const disk = await runtime.adapter.read(file.path);
        if (proposal.kind !== 'delete' && file.path === proposal.preview.destination && disk.hash === proposal.preview.diskHash) {
          proposal.applied = { before: proposal.preview.before, after: disk.content, hash: disk.hash, fileId: file.id };
          proposal.status = 'applied'; proposal.error = undefined;
        } else if (file.path === proposal.preview.path && disk.hash === proposal.preview.diskHash) {
          proposal.status = 'ready'; proposal.preview = undefined; proposal.error = '未发现此次文件操作，请重新审阅';
        } else throw new Error('文件位置或内容已变化，请人工核对；不自动重试');
        await persist(target);
        if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target);
        return;
      }
      const file = current.files.find(file => proposal.kind === 'edit' ? file.id === proposal.fileId : file.path === proposal.path);
      if (!file || current.id !== expected.id || current.path !== expected.path) throw new Error('原目标不存在，请保留建议并核对工作区');
      const disk = await runtime.adapter.read(file.path);
      if (disk.content === proposal.preview.after) {
        proposal.applied = { before: proposal.preview.before, after: disk.content, hash: disk.hash, fileId: file.id };
        proposal.status = 'applied'; proposal.error = undefined;
      } else if (proposal.kind === 'edit' && disk.hash === proposal.preview.diskHash) {
        proposal.status = 'ready'; proposal.preview = undefined; proposal.error = '未发现此次写入，请重新审阅';
      } else throw new Error('磁盘内容与写入前后均不同，请打开文档人工核对；不自动重试');
      await persist(target);
      if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target);
    } catch (reason) { error.value = String(reason); }
    finally { applying.value = false; }
  }

  async function reject(proposal: AssistantProposal) {
    if (applying.value || busy.value || !['ready', 'conflicted'].includes(proposal.status)) return;
    proposal.status = 'rejected';
    const target = session.value;
    try { await persist(target); if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target); }
    catch (reason) { error.value = String(reason); }
  }

  async function undo(proposal: AssistantProposal) {
    if (!proposal.applied || applying.value || busy.value) return;
    if (proposal.kind === 'extension' || proposal.kind === 'plugin') {
      const undoExt = resolveAssistantExtension(runtime)?.undoProposal;
      if (!undoExt) return;
      applying.value = true;
      error.value = '';
      try {
        await undoExt(proposal);
      } catch (reason) {
        error.value = String(reason);
      } finally {
        applying.value = false;
      }
      return;
    }
    if (!['edit', 'create'].includes(proposal.kind)) return;
    if (proposal.kind === 'create' && isDataTableFilePath(proposal.path)) return;
    const reply = session.value?.messages.find(message => message.id === proposal.runId);
    if (!reply) return;
    const reversed: AssistantProposal = {
      id: crypto.randomUUID(), runId: reply.id, workspaceId: proposal.workspaceId,
      kind: 'edit', fileId: proposal.applied.fileId, path: proposal.path, base: proposal.applied.after,
      content: proposal.applied.before, reason: `撤回内容：${proposal.reason}`, status: 'ready',
    };
    reply.proposals!.push(reversed);
    const current = reply.proposals!.at(-1)!;
    current.execution = 'direct';
    await executeChange(current, session.value!, scope(), new AbortController().signal);
  }

  return {
    executeChange,
    review,
    publishSuggestions,
    verify,
    reject,
    undo,
  };
}
