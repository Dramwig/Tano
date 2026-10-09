import { parsePluginJson, pluginRecord, pluginText, type PluginJson } from './extensions';

export const pluginConnectionMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type PluginConnectionMethod = typeof pluginConnectionMethods[number];
export type PluginConnectionAuthentication = 'bearer' | 'x-api-key' | 'api-key' | 'private-token';
export interface PluginConnectionInput {
  pluginId: string;
  origin: string;
  integrity: string;
  methods: PluginConnectionMethod[];
  pathPrefix: string;
  authentication: PluginConnectionAuthentication;
  /** Omit only when renewing/updating an existing connection without changing its authentication kind. */
  secret?: string;
  /** Optimistic concurrency token. Omit when creating a connection. */
  version?: string;
}
export interface PluginConnection extends Omit<PluginConnectionInput, 'secret' | 'version'> {
  version: string;
  updatedAt: string;
  hasSecret: true;
  /** Host metadata only. Tokens are never exposed to the plugin SDK. */
  oauth?: { providerId: string };
}
export interface PluginOAuthProvider { id: string; label: string; origin: string; scopes: string[] }
export interface PluginOAuthInput extends Omit<PluginConnectionInput, 'secret' | 'authentication'> { providerId: string }
export interface PluginOAuthFlow { id: string; authorizationUrl: string; expiresAt: string }
export interface PluginOAuthStatus { status: 'pending' | 'exchanging' | 'completed' | 'cancelled' | 'failed' | 'expired' }
/** Account connection UI only; deliberately absent from the plugin SDK. */
export interface PluginOAuthHost {
  /** Shown while opening an external login page. Defaults to the online account requirement. */
  readonly loginHint?: string;
  providers(workspaceId: string, signal: AbortSignal): Promise<PluginOAuthProvider[]>;
  start(workspaceId: string, input: PluginOAuthInput, signal: AbortSignal): Promise<PluginOAuthFlow>;
  status(workspaceId: string, flowId: string, signal: AbortSignal): Promise<PluginOAuthStatus>;
  cancel(workspaceId: string, flowId: string, signal: AbortSignal): Promise<void>;
}
export interface PluginConnectionRequest { path: string; method?: PluginConnectionMethod; body?: PluginJson }
export interface PluginConnectionResponse { status: number; body: string; contentType: 'application/json' | 'text/plain' }
export interface PluginConnectionContext { workspaceId: string; pluginId: string; integrity: string; signal: AbortSignal }
/** API keys enter save(); OAuth tokens stay in the host. Metadata and SDK results contain no credential handle. */
export interface PluginConnectionProvider {
  readonly storageLabel: string;
  readonly oauth?: PluginOAuthHost;
  list(workspaceId: string, signal: AbortSignal): Promise<PluginConnection[]>;
  save(workspaceId: string, input: PluginConnectionInput, signal: AbortSignal): Promise<PluginConnection>;
  remove(workspaceId: string, pluginId: string, origin: string, version: string, signal: AbortSignal): Promise<void>;
  request(context: PluginConnectionContext, origin: string, request: PluginConnectionRequest): Promise<PluginConnectionResponse>;
}
export function pluginConnectionOrigin(value: unknown): string {
  if (!pluginText(value, 250)) throw new Error('连接来源无效');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) throw new Error('连接来源必须为不含路径或凭据的 HTTPS 来源');
  return value;
}
function connectionPath(value: unknown): string {
  if (!pluginText(value, 2048) || !value.startsWith('/') || value.startsWith('//') || /[\\#\s]/.test(value)) throw new Error('连接请求必须使用相对来源的绝对路径');
  const url = new URL(value, 'https://connection.invalid');
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f|25|2e|2f|5c)/i.test(url.pathname)) throw new Error('连接路径不能包含编码的控制字符、路径分隔符或跳转');
  return url.pathname + url.search;
}
export function parsePluginConnectionRequest(value: unknown): Required<Pick<PluginConnectionRequest, 'path' | 'method'>> & Pick<PluginConnectionRequest, 'body'> {
  if (!pluginRecord(value) || Object.keys(value).some(key => !['path', 'method', 'body'].includes(key))) throw new Error('连接请求格式无效');
  const method = value.method ?? 'GET';
  if (!pluginConnectionMethods.includes(method as PluginConnectionMethod)) throw new Error('连接请求方法无效');
  if (method === 'GET' && value.body !== undefined) throw new Error('GET 请求不能携带正文');
  return { path: connectionPath(value.path), method: method as PluginConnectionMethod,
    ...(value.body !== undefined ? { body: parsePluginJson(value.body, 64 * 1024) } : {}) };
}
export function parsePluginConnectionInput(value: unknown): PluginConnectionInput {
  if (!pluginRecord(value) || Object.keys(value).some(key => !['pluginId', 'origin', 'integrity', 'methods', 'pathPrefix', 'authentication', 'secret', 'version'].includes(key))) throw new Error('连接设置格式无效');
  if (typeof value.pluginId !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.pluginId) || typeof value.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(value.integrity) ||
      !Array.isArray(value.methods) || !value.methods.length || value.methods.length > 5 || value.methods.some(method => !pluginConnectionMethods.includes(method)) || new Set(value.methods).size !== value.methods.length ||
      !['bearer', 'x-api-key', 'api-key', 'private-token'].includes(String(value.authentication)) ||
      value.version !== undefined && (typeof value.version !== 'string' || !/^[a-f0-9-]{36}$/.test(value.version))) throw new Error('连接设置无效');
  const pathPrefix = connectionPath(value.pathPrefix);
  if (pathPrefix !== value.pathPrefix || pathPrefix.includes('?') || !pathPrefix.endsWith('/')) throw new Error('连接路径范围必须以 / 结尾且不能包含查询或路径跳转');
  if (value.secret !== undefined && (typeof value.secret !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(value.secret))) throw new Error('密钥必须为 8 至 4096 个可打印 ASCII 字符，不含空格');
  return { pluginId: value.pluginId, origin: pluginConnectionOrigin(value.origin), integrity: value.integrity, methods: value.methods as PluginConnectionMethod[], pathPrefix,
    authentication: value.authentication as PluginConnectionAuthentication, ...(value.secret !== undefined ? { secret: value.secret as string } : {}), ...(value.version ? { version: value.version as string } : {}) };
}
export function assertPluginConnectionRequest(connection: PluginConnectionInput, request: ReturnType<typeof parsePluginConnectionRequest>) {
  if (!connection.methods.includes(request.method) || !new URL(request.path, connection.origin).pathname.startsWith(connection.pathPrefix)) throw new Error('此连接未授权请求的方法或路径');
}
