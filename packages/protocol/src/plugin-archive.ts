import {
  canonicalPluginJson,
  parsePluginManifest,
  parsePluginPackage,
  pluginRecord,
  type PluginPackage,
  type PluginUiBundle,
} from './extensions';
import { parseFileIconTheme, type FileIconTheme } from './appearance';

export const PLUGIN_ARCHIVE_V2_VERSION = 2 as const;
export const PLUGIN_ARCHIVE_V2_LIMIT = 16 * 1024 * 1024;
export const PLUGIN_ARCHIVE_MAX_ENTRIES = 256;

export interface PluginArchiveV2 {
  packageVersion: typeof PLUGIN_ARCHIVE_V2_VERSION;
  pkg: PluginPackage;
  binaryAssets: Record<string, Uint8Array>;
  entries: string[];
}

export interface PluginArchiveV2Input {
  pkg: PluginPackage;
  binaryAssets?: Record<string, Uint8Array>;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function validateArchiveEntryPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('//') ||
    /[\u0000-\u001f]/.test(normalized) ||
    normalized.split('/').some(seg => !seg || seg === '.' || seg === '..')
  ) {
    throw new Error(`插件归档条目路径无效：${path}`);
  }
  return normalized;
}

function validateBinaryAssetPath(path: string): string {
  const normalized = validateArchiveEntryPath(path);
  if (normalized.startsWith('assets/bin/')) return normalized.slice('assets/bin/'.length);
  return normalized;
}

/**
 * Deterministic STORED (method 0) ZIP encoder.
 * Fixed DOS date/time (1980-01-01 00:00:00), fixed mode, UTF-8 sorted paths.
 * Guarantees bit-for-bit identical bytes and SHA-256 across all OSes and runtimes.
 */
export function encodeDeterministicZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries = [...files.entries()]
    .map(([name, data]) => [validateArchiveEntryPath(name), data] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  if (entries.length > PLUGIN_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`插件归档文件数超过 ${PLUGIN_ARCHIVE_MAX_ENTRIES} 上限`);
  }

  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  // Fixed DOS timestamp: 1980-01-01 00:00:00 (time = 0, date = 0x0021)
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021;
  const UTF8_FLAG = 0x0800;

  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const checksum = crc32(data);
    const size = data.byteLength;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed: 2.0
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true); // Compression method 0 (STORE)
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, (3 << 8) | 20, true); // Version made by: Unix, 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number
    cv.setUint16(36, 0, true); // Internal attrs
    cv.setUint32(38, 0o100644 << 16, true); // Normalized regular file mode
    cv.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + data.byteLength;
    if (offset > PLUGIN_ARCHIVE_V2_LIMIT) {
      throw new Error(`插件归档体积超过 ${PLUGIN_ARCHIVE_V2_LIMIT} 字节上限`);
    }
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.byteLength;
  if (totalSize > PLUGIN_ARCHIVE_V2_LIMIT) {
    throw new Error(`插件归档体积超过 ${PLUGIN_ARCHIVE_V2_LIMIT} 字节上限`);
  }

  const output = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  output.set(eocd, cursor);
  return output;
}

/**
 * Strict ZIP decoder for deterministic STORED (method 0) plugin archives.
 * Rejects path traversal, duplicate names, compression bombs, symlinks, and CRC mismatches.
 */
export function decodeDeterministicZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength < 22 || bytes.byteLength > PLUGIN_ARCHIVE_V2_LIMIT) {
    throw new Error('插件 ZIP 归档体积无效');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.byteLength - 22 - 65535);
  for (let i = bytes.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('无效的 ZIP 归档（缺少目录尾）');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (totalEntries > PLUGIN_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`插件 ZIP 条目超过 ${PLUGIN_ARCHIVE_MAX_ENTRIES} 上限`);
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error('ZIP 中央目录边界无效');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = new Map<string, Uint8Array>();
  let pos = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > centralOffset + centralSize || view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error('ZIP 中央目录条目损坏');
    }
    const method = view.getUint16(pos + 10, true);
    if (method !== 0) {
      throw new Error('packageVersion 2 归档当前仅支持无损确定性 STORED（method 0）条目');
    }
    const expectedCrc = view.getUint32(pos + 16, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    if (compSize !== uncompSize) throw new Error('ZIP 条目压缩长度不一致');
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const extAttrs = view.getUint32(pos + 38, true);
    const unixMode = (extAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) throw new Error('插件归档禁止包含符号链接');
    const localOffset = view.getUint32(pos + 42, true);
    const name = validateArchiveEntryPath(
      decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)),
    );
    if (files.has(name)) throw new Error(`插件归档包含重复条目：${name}`);

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`ZIP 本地文件头损坏：${name}`);
    }
    if (
      view.getUint16(localOffset + 8, true) !== 0 ||
      view.getUint32(localOffset + 14, true) !== expectedCrc ||
      view.getUint32(localOffset + 22, true) !== uncompSize
    ) {
      throw new Error(`ZIP 本地文件头与中央目录不一致：${name}`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + uncompSize;
    if (dataEnd > centralOffset) throw new Error(`ZIP 文件数据越界：${name}`);
    const data = bytes.slice(dataStart, dataEnd);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP 条目 CRC32 校验失败：${name}`);
    files.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function isPluginArchiveV2Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Pack a PluginPackage plus optional raw binary assets (WASM/PNG/SVG/fonts) into a deterministic v2 ZIP. */
export function packPluginArchiveV2(input: PluginArchiveV2Input): Uint8Array {
  const pkg = parsePluginPackage(JSON.stringify(input.pkg));
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();

  files.set('manifest.json', encoder.encode(canonicalPluginJson(pkg.manifest)));
  if (pkg.source !== undefined) {
    files.set('worker.js', encoder.encode(pkg.source));
  }
  if (pkg.automationSource !== undefined) {
    files.set('automation.js', encoder.encode(pkg.automationSource));
  }
  if (pkg.ui) {
    for (const [viewId, bundle] of Object.entries(pkg.ui)) {
      files.set(`ui/${viewId}/index.html`, encoder.encode(bundle.html));
      files.set(`ui/${viewId}/style.css`, encoder.encode(bundle.css));
      files.set(`ui/${viewId}/main.js`, encoder.encode(bundle.source));
    }
  }
  if (pkg.assets?.icons?.length) {
    files.set('assets/icons.json', encoder.encode(canonicalPluginJson(pkg.assets.icons)));
  }

  const binaryPaths: string[] = [];
  if (input.binaryAssets) {
    for (const [rawPath, data] of Object.entries(input.binaryAssets)) {
      const rel = validateBinaryAssetPath(rawPath);
      if (!(data instanceof Uint8Array)) throw new Error(`二进制资产必须为 Uint8Array：${rawPath}`);
      files.set(`assets/bin/${rel}`, data);
      binaryPaths.push(rel);
    }
  }
  binaryPaths.sort();
  files.set(
    'archive.json',
    encoder.encode(
      canonicalPluginJson({
        packageVersion: PLUGIN_ARCHIVE_V2_VERSION,
        format: 'tano-zip-v2',
        binaryAssets: binaryPaths,
      }),
    ),
  );
  return encodeDeterministicZip(files);
}

/** Unpack and strictly validate a deterministic packageVersion 2 ZIP container. */
export function unpackPluginArchiveV2(bytes: Uint8Array): PluginArchiveV2 {
  const files = decodeDeterministicZip(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const textOf = (name: string) => {
    const data = files.get(name);
    return data ? decoder.decode(data) : undefined;
  };

  const archiveMetaRaw = textOf('archive.json');
  if (!archiveMetaRaw) throw new Error('插件 ZIP 缺少 archive.json 元数据');
  const archiveMeta = JSON.parse(archiveMetaRaw);
  if (
    !pluginRecord(archiveMeta) ||
    archiveMeta.packageVersion !== PLUGIN_ARCHIVE_V2_VERSION ||
    archiveMeta.format !== 'tano-zip-v2'
  ) {
    throw new Error('不支持的插件归档版本或格式');
  }

  const manifestRaw = textOf('manifest.json');
  if (!manifestRaw) throw new Error('插件 ZIP 缺少 manifest.json');
  const manifest = parsePluginManifest(JSON.parse(manifestRaw));

  const source = textOf('worker.js');
  const automationSource = textOf('automation.js');

  const uiViewIds = new Set<string>();
  for (const name of files.keys()) {
    const match = name.match(/^ui\/([^/]+)\/(?:index\.html|style\.css|main\.js)$/);
    if (match) uiViewIds.add(match[1]!);
  }
  let ui: Record<string, PluginUiBundle> | undefined;
  if (uiViewIds.size > 0) {
    ui = {};
    for (const viewId of [...uiViewIds].sort()) {
      const html = textOf(`ui/${viewId}/index.html`);
      const css = textOf(`ui/${viewId}/style.css`);
      const uiSource = textOf(`ui/${viewId}/main.js`);
      if (html === undefined || css === undefined || uiSource === undefined) {
        throw new Error(`插件视图 ${viewId} 缺少完整界面资产`);
      }
      ui[viewId] = { html, css, source: uiSource };
    }
  }

  let icons: FileIconTheme[] | undefined;
  const iconsRaw = textOf('assets/icons.json');
  if (iconsRaw !== undefined) {
    const parsedIcons = JSON.parse(iconsRaw);
    if (!Array.isArray(parsedIcons)) throw new Error('assets/icons.json 格式无效');
    icons = parsedIcons.map((item: unknown) => parseFileIconTheme(item));
  }

  const pkg = parsePluginPackage(
    JSON.stringify({
      packageVersion: 1,
      manifest,
      ...(source !== undefined ? { source } : {}),
      ...(automationSource !== undefined ? { automationSource } : {}),
      ...(ui ? { ui } : {}),
      ...(icons?.length ? { assets: { icons } } : {}),
    }),
  );

  const binaryAssets: Record<string, Uint8Array> = {};
  for (const [name, data] of files.entries()) {
    if (name.startsWith('assets/bin/')) {
      binaryAssets[name.slice('assets/bin/'.length)] = data;
    }
  }

  return {
    packageVersion: PLUGIN_ARCHIVE_V2_VERSION,
    pkg,
    binaryAssets,
    entries: [...files.keys()].sort(),
  };
}

/** Compute SHA-256 hex digest of deterministic archive bytes (Web Crypto, browser + Node 24+). */
export async function pluginArchiveDigest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
