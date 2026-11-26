import {
  pluginRecord,
  validateAgainstPluginJsonSchema,
  type AssistantProposal,
  type AssistantRequest,
  type AssistantTransport,
  type AssistantWireMessage,
  type ExecutablePluginManifest,
  type PluginAiCompleteRequest,
  type PluginAiCompleteResult,
  type PluginAiStructuredRequest,
  type PluginAiStructuredResult,
  type PluginAssistantContextProviderDefinition,
  type PluginAssistantToolDefinition,
  type PluginJson,
} from '@tano/protocol';
import {
  PLUGIN_UNTRUSTED_END,
  PLUGIN_UNTRUSTED_START,
  sanitizePluginBoundaryText,
  wrapUntrustedPluginData,
} from '@tano/protocol/untrusted-data';
import { AssistantStream } from '../assistant/engine';
import type { PluginRuntimeState } from './host';
import type { InstalledObjectPlugin } from './workspace-plugins';

export {
  PLUGIN_UNTRUSTED_END,
  PLUGIN_UNTRUSTED_START,
  sanitizePluginBoundaryText,
  wrapUntrustedPluginData,
};

export interface ActivePluginAssistantEntry {
  installation: InstalledObjectPlugin;
  manifest: ExecutablePluginManifest;
  runtime: PluginRuntimeState;
}

export interface CompiledPluginTool {
  wireName: string;
  pluginId: string;
  pluginName: string;
  tool: PluginAssistantToolDefinition;
}

export interface ActivePluginContextProvider {
  key: string;
  pluginId: string;
  pluginName: string;
  provider: PluginAssistantContextProviderDefinition;
}

export interface PluginAssistantContextBlock {
  key: string;
  pluginId: string;
  pluginName: string;
  providerId: string;
  title: string;
  content: string;
  metadata?: PluginJson;
}

export function activeAssistantPlugins(
  installed: readonly InstalledObjectPlugin[],
  runtimeStates: readonly PluginRuntimeState[],
): ActivePluginAssistantEntry[] {
  const byId = new Map(runtimeStates.map(state => [state.id, state]));
  const result: ActivePluginAssistantEntry[] = [];
  for (const installation of installed) {
    if (!installation.enabled || !installation.authorized) continue;
    if (installation.manifest.manifestVersion !== 2) continue;
    if (installation.scope === 'user' && installation.personalCodePolicy === 'block') continue;
    const runtime = byId.get(installation.manifest.id);
    if (!runtime || (runtime.status !== 'running' && runtime.status !== 'idle')) continue;
    result.push({ installation, manifest: installation.manifest, runtime });
  }
  return result;
}

/** Permission intersection: User/Workspace readOnly ∩ Team personalCodePolicy ∩ Plugin manifest. */
export function canPluginToolExecute(
  installation: InstalledObjectPlugin,
  tool: PluginAssistantToolDefinition,
  workspaceReadOnly: boolean,
): boolean {
  if (!installation.enabled || !installation.authorized) return false;
  if (installation.scope === 'user' && installation.personalCodePolicy === 'block') return false;
  if (tool.effect === 'write') {
    if (workspaceReadOnly) return false;
    if (installation.scope === 'user' && installation.personalCodePolicy === 'read-only') return false;
  }
  return true;
}

function stableWireHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

export function pluginAssistantWireName(pluginId: string, toolName: string): string {
  const safePlugin = pluginId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const candidate = `plugin__${safePlugin}__${safeTool}`;
  if (candidate.length <= 64) return candidate;
  const suffix = stableWireHash(`${pluginId}:${toolName}`);
  return `${candidate.slice(0, 57)}_${suffix}`;
}

export function describeInstalledPluginsForAssistant(
  installed: readonly InstalledObjectPlugin[],
  runtimeStates: readonly PluginRuntimeState[],
  workspaceReadOnly: boolean,
) {
  const runtimeById = new Map(runtimeStates.map(state => [state.id, state]));
  return installed
    .filter(item => item.enabled)
    .map(item => {
      const runtime = runtimeById.get(item.manifest.id);
      const manifest = item.manifest;
      const executable =
        manifest.manifestVersion === 2 &&
        item.authorized &&
        !(item.scope === 'user' && item.personalCodePolicy === 'block') &&
        !!runtime &&
        (runtime.status === 'running' || runtime.status === 'idle');
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        scope: item.scope,
        objectTypes: manifest.objectTypes.map(objType => ({ type: objType.type, label: objType.label })),
        ...(executable && manifest.manifestVersion === 2
          ? {
              commands: manifest.commands.map(cmd => ({ id: cmd.id, label: cmd.label })),
              views: manifest.views.map(view => ({
                id: view.id,
                label: view.label,
                location: view.location ?? 'panel',
              })),
              assistantTools: (manifest.assistantTools ?? [])
                .filter(tool => canPluginToolExecute(item, tool, workspaceReadOnly))
                .map(tool => ({
                  name: tool.name,
                  wireName: pluginAssistantWireName(manifest.id, tool.name),
                  label: tool.label,
                  description: tool.description,
                  effect: tool.effect,
                })),
              assistantContextProviders: (manifest.assistantContextProviders ?? []).map(provider => ({
                id: provider.id,
                label: provider.label,
                description: provider.description,
              })),
            }
          : {}),
      };
    });
}

export function listActivePluginContextProviders(
  installed: readonly InstalledObjectPlugin[],
  runtimeStates: readonly PluginRuntimeState[],
): ActivePluginContextProvider[] {
  const active = activeAssistantPlugins(installed, runtimeStates);
  const providers: ActivePluginContextProvider[] = [];
  for (const { manifest } of active) {
    for (const provider of manifest.assistantContextProviders ?? []) {
      providers.push({
        key: `${manifest.id}:${provider.id}`,
        pluginId: manifest.id,
        pluginName: manifest.name,
        provider,
      });
    }
  }
  return providers;
}

export function extractPluginContextMentions(
  prompt: string,
  providers: readonly ActivePluginContextProvider[],
  selectedKeys: readonly string[] = [],
  limit = 4,
): ActivePluginContextProvider[] {
  const chosen: ActivePluginContextProvider[] = [];
  const seen = new Set<string>();
  const add = (entry: ActivePluginContextProvider | undefined) => {
    if (!entry || seen.has(entry.key) || chosen.length >= limit) return;
    seen.add(entry.key);
    chosen.push(entry);
  };
  for (const key of selectedKeys) {
    add(providers.find(item => item.key === key));
  }
  const byKey = new Map(providers.map(item => [item.key.toLowerCase(), item]));
  const byShortId = new Map<string, ActivePluginContextProvider[]>();
  for (const item of providers) {
    const id = item.provider.id.toLowerCase();
    const list = byShortId.get(id) ?? [];
    list.push(item);
    byShortId.set(id, list);
  }
  const mentionPattern = /(?:^|[\s,，。；;（(])@([a-z][a-z0-9._-]{0,79}(?::[a-z][a-z0-9_-]{0,31})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(prompt)) !== null) {
    const token = match[1]!.toLowerCase();
    if (token.includes(':')) {
      add(byKey.get(token));
    } else {
      const candidates = byShortId.get(token);
      if (candidates?.length === 1) add(candidates[0]);
    }
  }
  return chosen;
}

const effectTag: Record<PluginAssistantToolDefinition['effect'], string> = {
  read: '[插件工具 · 只读]',
  write: '[插件工具 · 写入，须经用户确认]',
  external: '[插件工具 · 外部调用，须经用户确认]',
};

export interface PluginAssistantCapabilitySummary {
  tools: {
    pluginId: string;
    pluginName: string;
    tool: PluginAssistantToolDefinition;
    wireName: string;
    available: boolean;
    blockedReason?: 'workspace-read-only' | 'team-read-only' | 'team-blocked';
  }[];
  contexts: ActivePluginContextProvider[];
  blockedPersonalPluginCount: number;
  readOnlyPersonalPluginCount: number;
}

/** Summarize active & policy-restricted plugin assistant capabilities for UI visibility. */
export function summarizePluginAssistantCapabilities(
  installed: readonly InstalledObjectPlugin[],
  runtimeStates: readonly PluginRuntimeState[],
  workspaceReadOnly: boolean,
): PluginAssistantCapabilitySummary {
  const runtimeById = new Map(runtimeStates.map(state => [state.id, state]));
  const tools: PluginAssistantCapabilitySummary['tools'] = [];
  let blockedPersonalPluginCount = 0;
  let readOnlyPersonalPluginCount = 0;

  for (const installation of installed) {
    if (!installation.enabled || !installation.authorized) continue;
    if (installation.manifest.manifestVersion !== 2) continue;
    if (installation.scope === 'user' && installation.personalCodePolicy === 'block') {
      blockedPersonalPluginCount++;
      for (const tool of installation.manifest.assistantTools ?? []) {
        tools.push({
          pluginId: installation.manifest.id,
          pluginName: installation.manifest.name,
          tool,
          wireName: pluginAssistantWireName(installation.manifest.id, tool.name),
          available: false,
          blockedReason: 'team-blocked',
        });
      }
      continue;
    }
    const runtime = runtimeById.get(installation.manifest.id);
    if (!runtime || (runtime.status !== 'running' && runtime.status !== 'idle')) continue;
    if (installation.scope === 'user' && installation.personalCodePolicy === 'read-only') {
      readOnlyPersonalPluginCount++;
    }
    for (const tool of installation.manifest.assistantTools ?? []) {
      const available = canPluginToolExecute(installation, tool, workspaceReadOnly);
      const blockedReason = available
        ? undefined
        : installation.scope === 'user' && installation.personalCodePolicy === 'read-only'
          ? 'team-read-only'
          : 'workspace-read-only';
      tools.push({
        pluginId: installation.manifest.id,
        pluginName: installation.manifest.name,
        tool,
        wireName: pluginAssistantWireName(installation.manifest.id, tool.name),
        available,
        ...(blockedReason ? { blockedReason } : {}),
      });
    }
  }

  return {
    tools,
    contexts: listActivePluginContextProviders(installed, runtimeStates),
    blockedPersonalPluginCount,
    readOnlyPersonalPluginCount,
  };
}

export function compilePluginAssistantTools(
  installed: readonly InstalledObjectPlugin[],
  runtimeStates: readonly PluginRuntimeState[],
  workspaceReadOnly: boolean,
): {
  tools: NonNullable<AssistantRequest['tools']>;
  pluginTools: Map<string, CompiledPluginTool>;
  hasAnyPlugin: boolean;
} {
  const enabledPlugins = installed.filter(item => item.enabled);
  const active = activeAssistantPlugins(installed, runtimeStates);
  const tools: NonNullable<AssistantRequest['tools']> = [];
  const pluginTools = new Map<string, CompiledPluginTool>();

  if (enabledPlugins.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'inspect_plugins',
        description: '只读查看当前工作区及用户级已启用插件的对象类型、命令、视图与助手工具列表。',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    });
  }
  if (enabledPlugins.length > 0 || runtimeStates.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'inspect_plugin_logs',
        description: '只读查看指定已安装插件的当前运行状态与近期控制台/异常日志，用于排查插件运行问题。请先用 inspect_plugins 获取准确的 pluginId。',
        parameters: {
          type: 'object',
          properties: {
            pluginId: { type: 'string', description: '已安装插件 ID' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回最近日志条数（1–50，默认 20）' },
          },
          required: ['pluginId'],
          additionalProperties: false,
        },
      },
    });
  }
  const hasViews = active.some(entry => entry.manifest.views.length > 0);
  if (hasViews) {
    tools.push({
      type: 'function',
      function: {
        name: 'open_plugin_view',
        description: '打开指定已授权插件声明的视图（只读导航，不写入工作区内容）。请先用 inspect_plugins 获取准确的 pluginId 和 viewId。',
        parameters: {
          type: 'object',
          properties: {
            pluginId: { type: 'string', description: '插件 ID' },
            viewId: { type: 'string', description: '视图 ID' },
          },
          required: ['pluginId', 'viewId'],
          additionalProperties: false,
        },
      },
    });
  }

  for (const { installation, manifest } of active) {
    for (const tool of manifest.assistantTools ?? []) {
      if (!canPluginToolExecute(installation, tool, workspaceReadOnly)) continue;
      const wireName = pluginAssistantWireName(manifest.id, tool.name);
      if (pluginTools.has(wireName)) continue;
      pluginTools.set(wireName, {
        wireName,
        pluginId: manifest.id,
        pluginName: manifest.name,
        tool,
      });
      const parameters = JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>;
      if (tool.effect !== 'read') {
        const props = (parameters.properties as Record<string, unknown> | undefined) ?? {};
        parameters.properties = {
          ...props,
          _reason: {
            type: 'string',
            description: '简明说明执行此插件操作的原因，供用户审阅确认。',
          },
        };
      }
      tools.push({
        type: 'function',
        function: {
          name: wireName,
          description: `${effectTag[tool.effect]} ${manifest.name} · ${tool.label}：${tool.description}`,
          parameters,
        },
      });
    }
  }

  return { tools, pluginTools, hasAnyPlugin: enabledPlugins.length > 0 };
}

export function createPluginToolProposal(options: {
  workspaceId: string;
  runId: string;
  compiled: CompiledPluginTool;
  rawArgs: Record<string, unknown>;
}): AssistantProposal {
  const { workspaceId, runId, compiled, rawArgs } = options;
  if (compiled.tool.effect === 'read') {
    throw new Error('只读插件工具不需要生成审阅提案');
  }
  const cleanArgs: Record<string, unknown> = { ...rawArgs };
  const rawReason = cleanArgs._reason;
  delete cleanArgs._reason;
  validateAgainstPluginJsonSchema(cleanArgs, compiled.tool.parameters);
  const reason =
    typeof rawReason === 'string' && rawReason.trim()
      ? rawReason.trim().slice(0, 1000)
      : `调用插件「${compiled.pluginName}」执行「${compiled.tool.label}」`;
  const formattedArgs = JSON.stringify(cleanArgs, null, 2);
  const displayPath = `${compiled.pluginName} · ${compiled.tool.label}`.slice(0, 200);
  return {
    id: crypto.randomUUID(),
    runId,
    workspaceId,
    kind: 'plugin',
    path: displayPath,
    base: '',
    content: formattedArgs,
    reason,
    status: 'ready',
    preview: {
      before: '',
      after: formattedArgs,
      diskHash: null,
      path: displayPath,
    },
    pluginAction: {
      pluginId: compiled.pluginId,
      pluginName: compiled.pluginName,
      toolName: compiled.tool.name,
      label: compiled.tool.label,
      effect: compiled.tool.effect,
    },
  };
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1]!.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/** Host-managed inference for tano.ai.complete / tano.ai.structured. Credentials never enter the sandbox. */
export async function runPluginAiCompletion(options: {
  transport: AssistantTransport;
  connectionId: string;
  model: string;
  request: PluginAiCompleteRequest | PluginAiStructuredRequest;
  structured: boolean;
  signal: AbortSignal;
}): Promise<PluginAiCompleteResult | PluginAiStructuredResult> {
  const { transport, connectionId, model, request, structured, signal } = options;
  const messages: AssistantWireMessage[] = [];
  const systemParts: string[] = [];
  if (request.system) systemParts.push(request.system);
  if (structured) {
    const schema = (request as PluginAiStructuredRequest).schema;
    systemParts.push(
      `你必须只返回一个合法的 JSON 对象（不要输出额外解释或 Markdown 围栏），且严格满足以下 JSON Schema：\n${JSON.stringify(schema)}`,
    );
  }
  if (systemParts.length) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') });
  }
  messages.push({ role: 'user', content: request.prompt });

  const stream = new AssistantStream(() => {});
  await transport.request(
    connectionId,
    { model, messages },
    signal,
    bytes => {
      signal.throwIfAborted();
      stream.push(bytes);
    },
  );
  signal.throwIfAborted();
  stream.finish();
  const rawText = stream.content.trim();
  if (!rawText) throw new Error('模型未返回推理结果');
  const usage = stream.usage.input || stream.usage.output ? { ...stream.usage } : undefined;
  if (!structured) {
    return {
      text: rawText,
      model,
      ...(usage ? { usage } : {}),
    };
  }
  const schema = (request as PluginAiStructuredRequest).schema;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(rawText));
  } catch {
    throw new Error('模型未返回合法的结构化 JSON 输出');
  }
  if (!pluginRecord(parsed)) {
    throw new Error('结构化输出顶层必须为 JSON 对象');
  }
  validateAgainstPluginJsonSchema(parsed, schema);
  return {
    data: parsed,
    rawText,
    model,
    ...(usage ? { usage } : {}),
  };
}
