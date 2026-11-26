export const TANO_PLUGIN_API_VERSION = '1.1' as const;

export const pluginPlatforms = ['web', 'desktop-local', 'desktop-online', 'mobile'] as const;
export type PluginPlatform = typeof pluginPlatforms[number];

export interface PluginEngines {
  /** Minimum required Tano Core version, e.g. '>=0.14.0'. */
  tano: string;
}

export interface PluginHostEnvironment {
  coreVersion: string;
  platform: PluginPlatform;
}

export interface PluginCompatibilityResult {
  compatible: boolean;
  code?: 'CORE_VERSION_TOO_OLD' | 'PLATFORM_UNSUPPORTED';
  reason?: string;
}

export const pluginErrorCodes = [
  'PERMISSION_DENIED',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'READ_ONLY',
  'CONFLICT',
  'STALE_BASELINE',
  'CURSOR_EXPIRED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'TIMEOUT',
  'UNAVAILABLE',
  'INSTANCE_STOPPED',
  'INTERNAL_ERROR',
] as const;
export type PluginErrorCode = typeof pluginErrorCodes[number];

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;
  constructor(code: PluginErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'TanoPluginError';
    this.code = code;
    this.retryable = retryable;
  }
}

const triplet = /^(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})$/;
const minEngine = /^>=(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function compareCoreVersions(left: string, right: string): number {
  const aParts = left.split('.');
  const bParts = right.split('.');
  for (let i = 0; i < 3; i++) {
    const a = BigInt(aParts[i] ?? '0');
    const b = BigInt(bParts[i] ?? '0');
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

export function parsePluginEngines(value: unknown): PluginEngines {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => key !== 'tano'))
    throw new Error('插件运行环境要求（engines）无效');
  if (typeof value.tano !== 'string' || !minEngine.test(value.tano))
    throw new Error('插件 engines.tano 必须为 >=X.Y.Z 格式的版本要求');
  return { tano: value.tano };
}

export function parsePluginPlatforms(value: unknown): PluginPlatform[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > pluginPlatforms.length ||
    value.some((item) => typeof item !== 'string' || !(pluginPlatforms as readonly string[]).includes(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error('插件支持平台（platforms）声明无效');
  return value as PluginPlatform[];
}

const platformLabels: Record<PluginPlatform, string> = {
  web: '浏览器在线端',
  'desktop-local': '桌面本地工作区',
  'desktop-online': '桌面在线工作区',
  mobile: '移动端',
};

export function checkPluginCompatibility(
  manifest: { engines?: PluginEngines; platforms?: PluginPlatform[] },
  host: PluginHostEnvironment,
): PluginCompatibilityResult {
  if (manifest.engines?.tano) {
    const required = manifest.engines.tano.slice(2);
    const current = host.coreVersion.replace(/-.*$/, '');
    if (triplet.test(current) && compareCoreVersions(current, required) < 0) {
      return {
        compatible: false,
        code: 'CORE_VERSION_TOO_OLD',
        reason: `需要同页核心 >=${required}（当前 ${current}），请升级应用后再启用`,
      };
    }
  }
  if (manifest.platforms?.length && !manifest.platforms.includes(host.platform)) {
    const allowed = manifest.platforms.map((item) => platformLabels[item] ?? item).join('、');
    return {
      compatible: false,
      code: 'PLATFORM_UNSUPPORTED',
      reason: `此插件仅支持 ${allowed}，当前环境为 ${platformLabels[host.platform] ?? host.platform}`,
    };
  }
  return { compatible: true };
}

export function classifyPluginError(error: unknown): {
  code: PluginErrorCode;
  message: string;
  retryable: boolean;
} {
  if (error instanceof PluginError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error:\s*/, '') || '插件调用失败';
  if (/已停止|已失效|工作区已切换|已关闭/.test(message))
    return { code: 'INSTANCE_STOPPED', message, retryable: false };
  if (/没有\s+[a-z.]+\s+权限|未经授权|未在插件清单中声明|未授权/.test(message))
    return { code: 'PERMISSION_DENIED', message, retryable: false };
  if (/只读|阅读权限/.test(message))
    return { code: 'READ_ONLY', message, retryable: false };
  if (/分页已过期|查询结果已变化/.test(message))
    return { code: 'CURSOR_EXPIRED', message, retryable: true };
  if (/先读取|版本摘要|编辑基线无效|文档版本无效|对象版本无效/.test(message))
    return { code: 'STALE_BASELINE', message, retryable: true };
  if (/冲突|重叠修改|已保存在|发生变化/.test(message))
    return { code: 'CONFLICT', message, retryable: true };
  if (/不存在|不可访问/.test(message))
    return { code: 'NOT_FOUND', message, retryable: false };
  if (/超时/.test(message))
    return { code: 'TIMEOUT', message, retryable: true };
  if (/速率|过多/.test(message))
    return { code: 'RATE_LIMITED', message, retryable: true };
  if (/超过|过大|空间不足|限额/.test(message))
    return { code: 'QUOTA_EXCEEDED', message, retryable: false };
  if (/尚未提供|不可用|不支持此|已关闭/.test(message))
    return { code: 'UNAVAILABLE', message, retryable: false };
  if (/无效|必须|不能|格式/.test(message))
    return { code: 'INVALID_ARGUMENT', message, retryable: false };
  return { code: 'INTERNAL_ERROR', message, retryable: false };
}
