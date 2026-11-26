import {
  canonicalPluginJson,
  parsePluginManifest,
  parsePluginPackage,
  parsePluginPathScopes,
  parsePluginSettings,
  pluginRecord,
  pluginText,
  type PluginManifest,
  type PluginPackage,
} from '@tano/protocol';
import type { PluginStorage } from './cache-storage';
import { PluginPackageCache, pluginApplicationStorage } from './packages';

export type PluginInstallScope = 'system' | 'workspace' | 'user';

/** Lightweight per-principal index stored in application storage; full package bytes live in PluginPackageCache. */
export interface UserPluginRecord {
  id: string;
  integrity: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  /** Optional directory prefix allowlist restricting document/attachment access. */
  pathScopes?: string[];
  sourceUrl?: string;
  /** Exact SHA-256 authorized by the user across owned/local workspaces. */
  authorizedIntegrity?: string;
  installedAt: string;
}

export interface ResolvedUserPlugin {
  record: UserPluginRecord;
  pkg: PluginPackage;
}

export const userPluginsKey = (principal: string) =>
  `tano.user-plugins.v1.${encodeURIComponent(principal)}`;

function validateSourceUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!pluginText(value, 2048)) throw new Error('插件下载地址无效');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('插件下载地址必须为 HTTPS');
  return value;
}

export function readUserPlugins(
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
): UserPluginRecord[] {
  const raw = storage.getItem(userPluginsKey(principal));
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!pluginRecord(data) || data.version !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 100)
    throw new Error('全局插件记录损坏，原记录已保留');
  const ids = new Set<string>();
  return data.plugins.map((item): UserPluginRecord => {
    if (
      !pluginRecord(item) ||
      typeof item.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.integrity !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.integrity) ||
      typeof item.enabled !== 'boolean' ||
      !pluginText(item.installedAt, 40) ||
      !Number.isFinite(Date.parse(item.installedAt))
    )
      throw new Error('全局插件记录无效或重复');
    if (
      item.authorizedIntegrity !== undefined &&
      (typeof item.authorizedIntegrity !== 'string' || !/^[a-f0-9]{64}$/.test(item.authorizedIntegrity))
    )
      throw new Error('全局插件授权摘要无效');
    ids.add(item.id);
    const sourceUrl = validateSourceUrl(item.sourceUrl);
    const pathScopes = item.pathScopes === undefined ? undefined : parsePluginPathScopes(item.pathScopes);
    return {
      id: item.id,
      integrity: item.integrity,
      enabled: item.enabled,
      settings: parsePluginSettings(item.settings ?? {}),
      ...(pathScopes?.length ? { pathScopes } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(item.authorizedIntegrity ? { authorizedIntegrity: item.authorizedIntegrity } : {}),
      installedAt: item.installedAt,
    };
  });
}

export function writeUserPlugins(
  records: readonly UserPluginRecord[],
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
) {
  if (records.length > 100) throw new Error('全局插件不能超过 100 个');
  storage.setItem(userPluginsKey(principal), JSON.stringify({ version: 1, plugins: records }));
}

export function userScopeUnsupportedReason(manifest: PluginManifest): string | undefined {
  if (manifest.manifestVersion !== 2) return undefined;
  if (
    manifest.permissions.includes('connections') ||
    manifest.permissions.includes('native') ||
    (manifest.automations?.length ?? 0) > 0
  )
    return '包含服务连接、本机能力或后台自动化的插件目前仅支持安装到工作区';
  return undefined;
}

export async function installUserPlugin(
  manifestInput: PluginManifest,
  pkgInput: PluginPackage | undefined,
  options: {
    storage?: PluginStorage;
    principal?: string;
    sourceUrl?: string;
    binaryAssets?: Record<string, Uint8Array>;
  } = {},
): Promise<UserPluginRecord> {
  const storage = options.storage ?? pluginApplicationStorage();
  const principal = options.principal ?? 'device';
  const manifest = parsePluginManifest(manifestInput);
  const unsupported = userScopeUnsupportedReason(manifest);
  if (unsupported) throw new Error(unsupported);
  const pkg: PluginPackage =
    manifest.manifestVersion === 2
      ? (() => {
          if (!pkgInput || canonicalPluginJson(pkgInput.manifest) !== canonicalPluginJson(manifest))
            throw new Error('请导入包含此版本脚本的插件包');
          return parsePluginPackage(JSON.stringify(pkgInput));
        })()
      : parsePluginPackage(
          JSON.stringify(
            pkgInput && canonicalPluginJson(pkgInput.manifest) === canonicalPluginJson(manifest)
              ? pkgInput
              : { packageVersion: 1, manifest },
          ),
        );
  const sourceUrl = validateSourceUrl(options.sourceUrl);
  const cache = new PluginPackageCache(storage);
  const integrity = await cache.put(pkg, options.binaryAssets);
  const existing = readUserPlugins(storage, principal);
  const prior = existing.find((row) => row.id === manifest.id);
  const record: UserPluginRecord = {
    id: manifest.id,
    integrity,
    enabled: prior?.enabled ?? true,
    settings: prior?.settings ?? {},
    ...(sourceUrl ? { sourceUrl } : prior?.sourceUrl ? { sourceUrl: prior.sourceUrl } : {}),
    ...(prior?.authorizedIntegrity === integrity ? { authorizedIntegrity: integrity } : {}),
    installedAt: new Date().toISOString(),
  };
  writeUserPlugins([...existing.filter((row) => row.id !== manifest.id), record], storage, principal);
  return record;
}

export function uninstallUserPlugin(
  id: string,
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
) {
  const existing = readUserPlugins(storage, principal);
  writeUserPlugins(existing.filter((row) => row.id !== id), storage, principal);
}

export function setUserPluginEnabled(
  id: string,
  enabled: boolean,
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
) {
  const existing = readUserPlugins(storage, principal);
  if (!existing.some((row) => row.id === id)) throw new Error('插件已被卸载，请刷新后重试');
  writeUserPlugins(
    existing.map((row) => (row.id === id ? { ...row, enabled } : row)),
    storage,
    principal,
  );
}

export function setUserPluginSettings(
  id: string,
  settings: Record<string, unknown>,
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
  pathScopes?: string[],
) {
  const parsed = parsePluginSettings(settings);
  const parsedScopes = pathScopes === undefined ? undefined : parsePluginPathScopes(pathScopes);
  const existing = readUserPlugins(storage, principal);
  if (!existing.some((row) => row.id === id)) throw new Error('插件已被卸载，请刷新后重试');
  writeUserPlugins(
    existing.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, settings: parsed };
      if (pathScopes !== undefined) {
        if (parsedScopes?.length) next.pathScopes = parsedScopes;
        else delete next.pathScopes;
      }
      return next;
    }),
    storage,
    principal,
  );
}

export function setUserPluginGlobalAuthorization(
  id: string,
  integrity: string | undefined,
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
) {
  const existing = readUserPlugins(storage, principal);
  const target = existing.find((row) => row.id === id);
  if (!target) throw new Error('全局插件不存在或已卸载');
  if (integrity && target.integrity !== integrity)
    throw new Error('插件版本已变化，请重新查看权限');
  writeUserPlugins(
    existing.map((row) => {
      if (row.id !== id) return row;
      const { authorizedIntegrity: _previous, ...rest } = row;
      return integrity ? { ...rest, authorizedIntegrity: integrity } : rest;
    }),
    storage,
    principal,
  );
}

export async function resolveUserPlugins(
  storage: PluginStorage = pluginApplicationStorage(),
  principal = 'device',
): Promise<ResolvedUserPlugin[]> {
  const records = readUserPlugins(storage, principal);
  if (!records.length) return [];
  const cache = new PluginPackageCache(storage);
  const resolved: ResolvedUserPlugin[] = [];
  for (const record of records) {
    const pkg = await cache.get(record.integrity).catch(() => null);
    if (!pkg || pkg.manifest.id !== record.id) continue;
    resolved.push({ record, pkg });
  }
  return resolved;
}

export function isAppearanceOnlyPlugin(manifest: PluginManifest): boolean {
  return (
    manifest.manifestVersion === 1 &&
    !!manifest.appearance &&
    manifest.objectTypes.length === 0 &&
    manifest.relationTypes.length === 0
  );
}
