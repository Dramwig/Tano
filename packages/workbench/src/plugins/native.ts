import { invoke } from '@tauri-apps/api/core';
import { parsePluginConnectionInput, parsePluginConnectionRequest, pluginConnectionOrigin, type PluginConnectionProvider, type PluginConnection, type PluginOAuthFlow, type PluginOAuthProvider, type PluginOAuthStatus } from '@tano/protocol';
import type { PluginNativeContext, PluginRuntimeServices } from './host';

/** Install only for a desktop NativeAdapter; an online workspace never inherits a local root. */
export function createNativePluginServices(): NonNullable<PluginRuntimeServices['native']> {
  async function request(command: string, args: unknown, context: PluginNativeContext) {
    context.signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const cancel = () => { void invoke('plugin_native_cancel', { requestId }).catch(() => {}); };
    context.signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await invoke('plugin_native_request', { request: {
        requestId, workspaceId: context.workspaceId, pluginId: context.pluginId,
        integrity: context.integrity, command, args: args ?? {},
      } });
      context.signal.throwIfAborted();
      return result;
    } finally { context.signal.removeEventListener('abort', cancel); }
  }
  return Object.fromEntries(['git.status', 'git.diff', 'git.log'].map(command => [command,
    (args: unknown, context: PluginNativeContext) => request(command, args, context)]));
}

/** OS-user credentials for a local desktop workspace, separate from cloud accounts. */
export function createNativePluginConnections(): PluginConnectionProvider {
  async function operation<T>(command: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const cancel = () => { void invoke('plugin_native_cancel', { requestId }).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await invoke<T>(command, command === 'plugin_connections_request'
        ? { input: { ...params, requestId } } : { ...params, requestId });
      signal.throwIfAborted();
      return result;
    } finally { signal.removeEventListener('abort', cancel); }
  }
  return {
    storageLabel: '由当前系统用户的凭据库保管 API 密钥和账号令牌，仅此设备的本地工作区使用',
    oauth: {
      loginHint: '在系统浏览器中登录所选服务，完成后返回同页。本地账号连接仅保存在此设备。',
      providers: (workspaceId, signal) => operation<PluginOAuthProvider[]>('plugin_connections_oauth_providers', { workspaceId }, signal),
      start: (workspaceId, input, signal) => operation<PluginOAuthFlow>('plugin_connections_oauth_start', { workspaceId, input }, signal),
      status: (workspaceId, flowId, signal) => operation<PluginOAuthStatus>('plugin_connections_oauth_status', { workspaceId, flowId }, signal),
      cancel: (workspaceId, flowId, signal) => operation<void>('plugin_connections_oauth_cancel', { workspaceId, flowId }, signal),
    },
    list: (workspaceId, signal) => operation<PluginConnection[]>('plugin_connections_list', { workspaceId }, signal),
    save: (workspaceId, input, signal) => operation<PluginConnection>('plugin_connections_save', { workspaceId, input: parsePluginConnectionInput(input) }, signal),
    remove: (workspaceId, pluginId, origin, version, signal) => operation<void>('plugin_connections_remove', { workspaceId, pluginId, origin: pluginConnectionOrigin(origin), version }, signal),
    request: (context, origin, request) => operation('plugin_connections_request', {
      workspaceId: context.workspaceId, pluginId: context.pluginId, integrity: context.integrity,
      origin: pluginConnectionOrigin(origin), request: parsePluginConnectionRequest(request),
    }, context.signal),
  };
}
