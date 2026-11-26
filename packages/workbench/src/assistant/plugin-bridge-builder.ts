import type { AssistantToolCall } from '@tano/protocol';
import {
  canPluginToolExecute,
  compilePluginAssistantTools,
  createPluginToolProposal,
  describeInstalledPluginsForAssistant,
  wrapUntrustedPluginData,
} from '../plugins/assistant-bridge';
import { resolveAssistantExtension, type useWorkbenchRuntime } from '../runtime';
import type { useWorkspaceStore } from '../stores/workspace';

export function buildAssistantPluginBridge(options: {
  runtime: ReturnType<typeof useWorkbenchRuntime>;
  workspace: ReturnType<typeof useWorkspaceStore>;
  expected: { id: string; path: string };
  runId: string;
  inline: boolean;
  background: boolean;
}) {
  const { runtime, workspace, expected, runId, inline, background } = options;
  const assistantExtension = resolveAssistantExtension(runtime);
  const extensionTools = assistantExtension
    ? assistantExtension.listTools({
        workspaceReadOnly: !!workspace.workspace?.readOnly,
        inline,
        background,
      })
    : [];
  const extensionToolNames = new Set(extensionTools.map(tool => tool.function.name));
  const compiledPlugins = compilePluginAssistantTools(
    workspace.installedPlugins ?? [],
    workspace.pluginRuntime ?? [],
    !!workspace.workspace?.readOnly,
  );
  const combinedExtraTools = [...extensionTools, ...compiledPlugins.tools];
  const extensionPromptHints =
    assistantExtension?.promptHints?.({ workspaceReadOnly: !!workspace.workspace?.readOnly }) ?? [];

  const pluginBridge = combinedExtraTools.length || extensionPromptHints.length
    ? {
        tools: combinedExtraTools,
        ...(extensionPromptHints.length ? { promptHints: extensionPromptHints } : {}),
        isPluginTool: (name: string) =>
          name === 'inspect_plugins' ||
          name === 'inspect_plugin_logs' ||
          name === 'open_plugin_view' ||
          extensionToolNames.has(name) ||
          compiledPlugins.pluginTools.has(name),
        executeTool: async (call: AssistantToolCall, signal: AbortSignal) => {
          signal.throwIfAborted();
          if (workspace.workspace?.id !== expected.id || workspace.workspace.path !== expected.path)
            throw new Error('工作区已切换');
          const parsedArgs: unknown = JSON.parse(call.function.arguments || '{}');
          if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs))
            throw new Error('插件工具参数必须为对象');
          const args = parsedArgs as Record<string, unknown>;
          if (assistantExtension && extensionToolNames.has(call.function.name)) {
            const extResult = await assistantExtension.executeTool(call.function.name, args, {
              workspaceId: expected.id,
              workspacePath: expected.path,
              runId,
              activeDocumentId: workspace.active?.id,
              signal,
            });
            if (extResult) return extResult;
          }
          if (call.function.name === 'inspect_plugins') {
            if (Object.keys(args).length) throw new Error('inspect_plugins 不接受参数');
            return {
              kind: 'result' as const,
              data: {
                plugins: describeInstalledPluginsForAssistant(
                  workspace.installedPlugins,
                  workspace.pluginRuntime,
                  !!workspace.workspace?.readOnly,
                ),
              },
            };
          }
          if (call.function.name === 'inspect_plugin_logs') {
            if (Object.keys(args).some(key => key !== 'pluginId' && key !== 'limit'))
              throw new Error('inspect_plugin_logs 参数无效');
            const pluginId = typeof args.pluginId === 'string' ? args.pluginId.trim() : '';
            if (!pluginId) throw new Error('inspect_plugin_logs 缺少有效的 pluginId');
            let limit = 20;
            if (args.limit !== undefined) {
              if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)
                throw new Error('inspect_plugin_logs 的 limit 必须为 1 至 50 的整数');
              limit = args.limit;
            }
            const installation = workspace.installedPlugins.find(item => item.manifest.id === pluginId);
            const runtimeState = workspace.pluginRuntime.find(item => item.id === pluginId);
            if (!installation && !runtimeState) throw new Error('未找到指定已安装插件');
            const logs = (runtimeState?.logs ?? []).slice(-limit);
            return {
              kind: 'result' as const,
              data: {
                pluginId,
                pluginName: installation?.manifest.name ?? runtimeState?.name ?? pluginId,
                enabled: installation?.enabled ?? false,
                authorized: installation?.authorized ?? false,
                status: runtimeState?.status ?? 'idle',
                logCount: logs.length,
                untrustedPluginData: wrapUntrustedPluginData(pluginId, 'runtime:logs', {
                  status: runtimeState?.status ?? 'idle',
                  message: runtimeState?.message ?? '',
                  logs,
                }),
              },
            };
          }
          if (call.function.name === 'open_plugin_view') {
            if (typeof args.pluginId !== 'string' || typeof args.viewId !== 'string' || Object.keys(args).length !== 2)
              throw new Error('open_plugin_view 参数无效');
            workspace.openPluginView(args.pluginId, args.viewId);
            return { kind: 'result' as const, data: { opened: true, pluginId: args.pluginId, viewId: args.viewId } };
          }
          const compiled = compiledPlugins.pluginTools.get(call.function.name);
          if (!compiled) throw new Error('插件工具不可用或未授权');
          const installation = workspace.installedPlugins.find(item => item.manifest.id === compiled.pluginId);
          if (!installation || !canPluginToolExecute(installation, compiled.tool, !!workspace.workspace?.readOnly))
            throw new Error('当前工作区权限或策略不允许执行此插件工具');
          if (compiled.tool.effect === 'read') {
            const raw = await workspace.invokePluginAssistantTool(compiled.pluginId, compiled.tool.name, args);
            return {
              kind: 'result' as const,
              data: {
                untrustedPluginData: wrapUntrustedPluginData(compiled.pluginId, `tool:${compiled.tool.name}`, raw),
              },
            };
          }
          return {
            kind: 'proposal' as const,
            proposal: createPluginToolProposal({
              workspaceId: expected.id,
              runId,
              compiled,
              rawArgs: args,
            }),
          };
        },
      }
    : undefined;

  return { assistantExtension, pluginBridge };
}
