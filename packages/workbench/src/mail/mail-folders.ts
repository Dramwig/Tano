// SPDX-License-Identifier: MIT
import type { MailAccount, MailFolder } from './types';

export const PRIMARY_SPECIAL_USES = [
  'inbox',
  'flagged',
  'important',
  'sent',
  'drafts',
  'archive',
  'all',
  'junk',
  'trash',
] as const;

const PRIMARY_RANK = new Map<string, number>(
  PRIMARY_SPECIAL_USES.map((role, index) => [role, index]),
);

const GMAIL_NAMESPACE_RE = /^\[(?:gmail|google mail)\]$/i;

export interface MailFolderTreeNode {
  /** Stable key within the account, used for expand/collapse state. */
  key: string;
  /** Label rendered for this row (leaf segment when nested). */
  label: string;
  /** Full decoded folder path for tooltips. */
  fullPath: string;
  /** Underlying IMAP folder, or null for a non-selectable container (e.g. QQ 其他文件夹). */
  folder: MailFolder | null;
  specialUse: string | null;
  primary: boolean;
  depth: number;
  children: MailFolderTreeNode[];
  /** Virtual container nodes default to expanded; real folders with children default collapsed. */
  defaultExpanded: boolean;
}

export interface AccountFolderTree {
  primary: MailFolderTreeNode[];
  secondary: MailFolderTreeNode[];
  hasNested: boolean;
}

function decodedPathOf(folder: MailFolder): string {
  return folder.decodedPath && folder.decodedPath.length > 0
    ? folder.decodedPath
    : folder.remoteName;
}

function resolveDelimiter(folder: MailFolder, decodedPath: string): string | null {
  if (folder.delimiter && folder.delimiter.length > 0) return folder.delimiter;
  if (decodedPath.includes('/')) return '/';
  if (decodedPath.length > 6 && /^inbox\./i.test(decodedPath)) return '.';
  return null;
}

function splitPath(decodedPath: string, delimiter: string | null): string[] {
  if (!decodedPath) return [];
  if (!delimiter) return [decodedPath];
  return decodedPath.split(delimiter).filter(Boolean);
}

function pathKey(segments: readonly string[]): string {
  return segments.map((s) => s.trim().toLowerCase()).join('\0');
}

function isInboxDotPersonalNamespace(
  entries: readonly { folder: MailFolder; delimiter: string | null; rawSegments: string[] }[],
): boolean {
  let nonInboxCount = 0;
  for (const item of entries) {
    if (
      item.folder.specialUse === 'inbox' ||
      (item.rawSegments.length === 1 && item.rawSegments[0]!.toLowerCase() === 'inbox')
    ) {
      continue;
    }
    nonInboxCount += 1;
    if (
      item.delimiter !== '.' ||
      item.rawSegments.length < 2 ||
      item.rawSegments[0]!.toLowerCase() !== 'inbox'
    ) {
      return false;
    }
  }
  return nonInboxCount > 0;
}

function compareNodes(a: MailFolderTreeNode, b: MailFolderTreeNode): number {
  const rankA = a.specialUse === 'notes' ? 0 : 1;
  const rankB = b.specialUse === 'notes' ? 0 : 1;
  if (rankA !== rankB) return rankA - rankB;
  return a.label.localeCompare(b.label, 'zh-CN', { sensitivity: 'base' });
}

function sortTreeChildren(nodes: MailFolderTreeNode[], depth: number): void {
  for (const node of nodes) {
    node.depth = depth;
    if (node.children.length > 1) {
      node.children.sort(compareNodes);
    }
    if (node.children.length > 0) {
      sortTreeChildren(node.children, depth + 1);
    }
  }
}

/**
 * Organizes a flat account folder list into primary system mailboxes and a collapsible
 * hierarchy of custom / nested folders.
 *
 * - Primary special-use folders stay at the top level (even under `[Gmail]/` or `INBOX.`).
 * - Subfolders of primary folders (e.g. Outlook `Deleted/POP`) nest under their parent.
 * - Courier / Cyrus `INBOX.*` personal namespaces strip the `INBOX.` wrapper for custom folders.
 * - Missing non-selectable parents (e.g. QQ `其他文件夹`, Proton `Folders`) become collapsible
 *   virtual containers so nested folders never display redundant path prefixes.
 */
export function buildAccountFolderTree(folders: readonly MailFolder[]): AccountFolderTree {
  const entries = folders.map((folder) => {
    const decodedPath = decodedPathOf(folder);
    const delimiter = resolveDelimiter(folder, decodedPath);
    const rawSegments = splitPath(decodedPath, delimiter);
    return { folder, decodedPath, delimiter, rawSegments };
  });

  const stripInboxDot = isInboxDotPersonalNamespace(entries);

  const normalized = entries.map((item) => {
    let segments = item.rawSegments;
    if (segments.length >= 2 && GMAIL_NAMESPACE_RE.test(segments[0]!)) {
      segments = segments.slice(1);
    } else if (
      stripInboxDot &&
      segments.length >= 2 &&
      segments[0]!.toLowerCase() === 'inbox'
    ) {
      segments = segments.slice(1);
    }
    return { ...item, segments };
  });

  const primary: MailFolderTreeNode[] = [];
  const secondary: MailFolderTreeNode[] = [];
  const nodeByPath = new Map<string, MailFolderTreeNode>();

  // Phase 1: Register all primary special-use folders at top level.
  const primaryEntries = normalized
    .filter((item) => item.folder.specialUse !== null && PRIMARY_RANK.has(item.folder.specialUse))
    .sort((a, b) => {
      const ra = PRIMARY_RANK.get(a.folder.specialUse!) ?? 99;
      const rb = PRIMARY_RANK.get(b.folder.specialUse!) ?? 99;
      return ra - rb || a.folder.displayName.localeCompare(b.folder.displayName, 'zh-CN');
    });

  for (const item of primaryEntries) {
    const node: MailFolderTreeNode = {
      key: `folder:${item.folder.id}`,
      label: item.folder.displayName,
      fullPath: item.decodedPath,
      folder: item.folder,
      specialUse: item.folder.specialUse,
      primary: true,
      depth: 0,
      children: [],
      defaultExpanded: false,
    };
    primary.push(node);
    if (item.segments.length > 0) {
      const key = pathKey(item.segments);
      if (!nodeByPath.has(key)) nodeByPath.set(key, node);
    }
  }

  // Phase 2: Insert non-primary folders shallowest-first so real parent folders exist
  // before their descendants.
  const secondaryEntries = normalized
    .filter((item) => !(item.folder.specialUse !== null && PRIMARY_RANK.has(item.folder.specialUse)))
    .sort(
      (a, b) =>
        a.segments.length - b.segments.length ||
        a.decodedPath.localeCompare(b.decodedPath, 'zh-CN', { sensitivity: 'base' }),
    );

  function ensureVirtualParent(
    parentSegments: readonly string[],
    delimiter: string | null,
  ): MailFolderTreeNode {
    const key = pathKey(parentSegments);
    const existing = nodeByPath.get(key);
    if (existing) return existing;

    const label = parentSegments[parentSegments.length - 1] ?? '';
    const fullPath = parentSegments.join(delimiter ?? '/');
    const virtualNode: MailFolderTreeNode = {
      key: `virtual:${key}`,
      label,
      fullPath,
      folder: null,
      specialUse: null,
      primary: false,
      depth: 0,
      children: [],
      defaultExpanded: true,
    };

    if (parentSegments.length === 1) {
      secondary.push(virtualNode);
    } else {
      const grandParent = ensureVirtualParent(parentSegments.slice(0, -1), delimiter);
      virtualNode.primary = grandParent.primary;
      grandParent.children.push(virtualNode);
    }
    nodeByPath.set(key, virtualNode);
    return virtualNode;
  }

  for (const item of secondaryEntries) {
    const segs = item.segments;
    const key = segs.length > 0 ? pathKey(segs) : '';
    const leafLabel =
      item.folder.specialUse !== null || item.folder.displayName !== item.decodedPath
        ? item.folder.displayName
        : (segs[segs.length - 1] ?? item.folder.displayName);

    const existing = key ? nodeByPath.get(key) : undefined;
    if (existing && !existing.folder) {
      // Upgrade an earlier virtual container to a real selectable folder.
      existing.folder = item.folder;
      existing.specialUse = item.folder.specialUse;
      existing.label = leafLabel;
      existing.fullPath = item.decodedPath;
      existing.defaultExpanded = false;
      continue;
    }

    const node: MailFolderTreeNode = {
      key: `folder:${item.folder.id}`,
      label: leafLabel,
      fullPath: item.decodedPath,
      folder: item.folder,
      specialUse: item.folder.specialUse,
      primary: false,
      depth: 0,
      children: [],
      defaultExpanded: false,
    };

    if (segs.length <= 1) {
      secondary.push(node);
    } else {
      const parent = ensureVirtualParent(segs.slice(0, -1), item.delimiter);
      node.primary = parent.primary;
      parent.children.push(node);
    }
    if (key && !nodeByPath.has(key)) {
      nodeByPath.set(key, node);
    }
  }

  secondary.sort(compareNodes);
  sortTreeChildren(primary, 0);
  sortTreeChildren(secondary, 0);

  const hasNested =
    primary.some((n) => n.children.length > 0) || secondary.some((n) => n.children.length > 0);

  return { primary, secondary, hasNested };
}

/**
 * Flattens visible tree nodes in display order according to the caller's expansion predicate.
 */
export function flattenVisibleNodes(
  nodes: readonly MailFolderTreeNode[],
  isExpanded: (node: MailFolderTreeNode) => boolean,
): MailFolderTreeNode[] {
  const result: MailFolderTreeNode[] = [];
  function walk(list: readonly MailFolderTreeNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children.length > 0 && isExpanded(node)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

/**
 * Returns ancestor node keys leading to `folderId` so the sidebar can auto-reveal
 * a selected nested folder.
 */
export function ancestorKeysForFolder(tree: AccountFolderTree, folderId: string): string[] {
  if (!folderId) return [];
  const path: string[] = [];
  function search(nodes: readonly MailFolderTreeNode[]): boolean {
    for (const node of nodes) {
      if (node.folder?.id === folderId) return true;
      if (node.children.length > 0) {
        path.push(node.key);
        if (search(node.children)) return true;
        path.pop();
      }
    }
    return false;
  }
  if (search(tree.primary) || search(tree.secondary)) {
    return path;
  }
  return [];
}

export interface MoveTargetSection {
  primary: MailFolderTreeNode[];
  secondary: MailFolderTreeNode[];
  filtered: boolean;
}

/**
 * Returns flattened folder nodes for a "Move to folder" picker.
 *
 * - Without a query, preserves primary/secondary grouping and full tree indentation
 *   (including non-selectable virtual parent headings such as QQ `其他文件夹`).
 * - With a query, returns matching selectable folders flattened to depth 0.
 */
export function buildMoveTargetSections(
  tree: AccountFolderTree,
  query: string,
  labelOf: (node: MailFolderTreeNode) => string = (node) => node.label,
): MoveTargetSection {
  const needle = query.trim().toLowerCase();
  const allPrimary = flattenVisibleNodes(tree.primary, () => true);
  const allSecondary = flattenVisibleNodes(tree.secondary, () => true);
  if (!needle) {
    return { primary: allPrimary, secondary: allSecondary, filtered: false };
  }
  const matches = (node: MailFolderTreeNode) => {
    if (!node.folder) return false;
    return (
      labelOf(node).toLowerCase().includes(needle) ||
      node.fullPath.toLowerCase().includes(needle)
    );
  };
  return {
    primary: allPrimary.filter(matches).map((node) => ({ ...node, depth: 0 })),
    secondary: allSecondary.filter(matches).map((node) => ({ ...node, depth: 0 })),
    filtered: true,
  };
}

/**
 * Decides whether opening a folder should trigger an automatic background IMAP sync.
 *
 * Covers both newly discovered folders (`syncedAt === null`) and legacy local caches
 * where folder metadata was previously stamped with `synced_at` before any messages were
 * fetched (`totalCount > 0 && cachedAllCount === 0`).
 */
export function shouldAutoSyncFolder(
  folder: Pick<MailFolder, 'id' | 'syncedAt' | 'totalCount'>,
  options: {
    cachedAllCount: number;
    alreadyAttempted: boolean;
    accountSyncing: boolean;
  },
): boolean {
  if (options.alreadyAttempted || options.accountSyncing) return false;
  if (folder.syncedAt === null) return true;
  return folder.totalCount > 0 && options.cachedAllCount === 0;
}

export interface AccountDisplayMeta {
  /** Primary title shown on the sidebar account header. */
  title: string;
  /** Secondary email subtitle shown when multiple accounts exist or labels collide. */
  subtitle: string;
  /** Compact tag shown on Unified Inbox / search rows to identify the account. */
  shortTag: string;
  /** True when another connected account has the exact same label (case-insensitive). */
  duplicateLabel: boolean;
}

/**
 * Computes unambiguous display metadata for connected mail accounts so two accounts
 * under the same provider (e.g. two "Outlook" accounts) are always distinguishable.
 */
export function buildAccountDisplayMeta(
  accounts: readonly Pick<MailAccount, 'id' | 'label' | 'email' | 'provider'>[],
): Map<string, AccountDisplayMeta> {
  const labelCounts = new Map<string, number>();
  for (const acc of accounts) {
    const key = (acc.label.trim() || acc.email.trim()).toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  const localPartCounts = new Map<string, number>();
  for (const acc of accounts) {
    const local = acc.email.split('@')[0]?.trim().toLowerCase() ?? '';
    if (local) localPartCounts.set(local, (localPartCounts.get(local) ?? 0) + 1);
  }

  const multiple = accounts.length > 1;
  const map = new Map<string, AccountDisplayMeta>();
  for (const acc of accounts) {
    const title = acc.label.trim() || acc.email.trim();
    const key = title.toLowerCase();
    const duplicateLabel = (labelCounts.get(key) ?? 0) > 1;
    const emailSameAsTitle = acc.email.trim().toLowerCase() === key;
    const subtitle =
      !emailSameAsTitle && (multiple || duplicateLabel) ? acc.email.trim() : '';

    let shortTag = title;
    if (duplicateLabel) {
      const local = acc.email.split('@')[0]?.trim() ?? '';
      const localDuplicated = (localPartCounts.get(local.toLowerCase()) ?? 0) > 1;
      shortTag = !local || localDuplicated ? acc.email.trim() : local;
    }

    map.set(acc.id, { title, subtitle, shortTag, duplicateLabel });
  }
  return map;
}

