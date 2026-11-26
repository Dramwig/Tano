// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  ancestorKeysForFolder,
  buildAccountDisplayMeta,
  buildAccountFolderTree,
  buildMoveTargetSections,
  flattenVisibleNodes,
  shouldAutoSyncFolder,
} from './mail-folders';
import type { MailFolder } from './types';

function makeFolder(
  partial: Partial<MailFolder> & Pick<MailFolder, 'id' | 'remoteName' | 'displayName'>,
): MailFolder {
  return {
    accountId: 'acc-1',
    decodedPath: partial.decodedPath ?? partial.remoteName,
    specialUse: null,
    delimiter: '/',
    uidValidity: null,
    uidNext: null,
    unreadCount: 0,
    totalCount: 0,
    syncedAt: null,
    ...partial,
  };
}

describe('mail-folders tree builder', () => {
  it('nests Outlook Deleted/POP under 已删除 and separates primary mailboxes from Notes', () => {
    const folders: MailFolder[] = [
      makeFolder({ id: 'inbox', remoteName: 'INBOX', displayName: '收件箱', specialUse: 'inbox', unreadCount: 70 }),
      makeFolder({ id: 'sent', remoteName: 'Sent', displayName: '已发送', specialUse: 'sent' }),
      makeFolder({ id: 'drafts', remoteName: 'Drafts', displayName: '草稿箱', specialUse: 'drafts' }),
      makeFolder({ id: 'archive', remoteName: '&W1hoYw-', decodedPath: '存档', displayName: '归档', specialUse: 'archive' }),
      makeFolder({ id: 'junk', remoteName: 'Junk', displayName: '垃圾邮件', specialUse: 'junk', unreadCount: 118 }),
      makeFolder({ id: 'trash', remoteName: 'Deleted', displayName: '已删除', specialUse: 'trash' }),
      makeFolder({ id: 'pop', remoteName: 'Deleted/POP', displayName: 'Deleted/POP' }),
      makeFolder({ id: 'notes', remoteName: 'Notes', displayName: '便签', specialUse: 'notes' }),
    ];

    const tree = buildAccountFolderTree(folders);
    expect(tree.hasNested).toBe(true);
    expect(tree.primary.map((n) => n.specialUse)).toEqual([
      'inbox',
      'sent',
      'drafts',
      'archive',
      'junk',
      'trash',
    ]);

    const trash = tree.primary.find((n) => n.specialUse === 'trash')!;
    expect(trash.defaultExpanded).toBe(false);
    expect(trash.children).toHaveLength(1);
    expect(trash.children[0]!.label).toBe('POP');
    expect(trash.children[0]!.depth).toBe(1);
    expect(trash.children[0]!.folder?.id).toBe('pop');

    expect(tree.secondary.map((n) => n.label)).toEqual(['便签']);
    expect(ancestorKeysForFolder(tree, 'pop')).toEqual([trash.key]);

    // Collapsed by default hides POP; expanded reveals it.
    const collapsed = flattenVisibleNodes(tree.primary, (n) => n.defaultExpanded);
    expect(collapsed.map((n) => n.label)).not.toContain('POP');
    const expanded = flattenVisibleNodes(tree.primary, () => true);
    expect(expanded.map((n) => n.label)).toContain('POP');
  });

  it('strips [Gmail] namespace for Gmail special folders and nests user labels', () => {
    const folders: MailFolder[] = [
      makeFolder({ id: 'inbox', remoteName: 'INBOX', displayName: '收件箱', specialUse: 'inbox' }),
      makeFolder({ id: 'star', remoteName: '[Gmail]/Starred', displayName: '星标邮件', specialUse: 'flagged' }),
      makeFolder({ id: 'imp', remoteName: '[Gmail]/Important', displayName: '重要邮件', specialUse: 'important' }),
      makeFolder({ id: 'sent', remoteName: '[Gmail]/Sent Mail', displayName: '已发送', specialUse: 'sent' }),
      makeFolder({ id: 'all', remoteName: '[Gmail]/All Mail', displayName: '全部邮件', specialUse: 'all' }),
      makeFolder({ id: 'chats', remoteName: '[Gmail]/Chats', displayName: '聊天记录' }),
      makeFolder({ id: 'work', remoteName: 'Work', displayName: 'Work' }),
      makeFolder({ id: 'work-rec', remoteName: 'Work/Receipts', displayName: 'Work/Receipts' }),
    ];

    const tree = buildAccountFolderTree(folders);
    expect(tree.primary.map((n) => n.specialUse)).toEqual([
      'inbox',
      'flagged',
      'important',
      'sent',
      'all',
    ]);
    // No phantom `[Gmail]` container node in secondary!
    expect(tree.secondary.map((n) => n.label)).toEqual(['聊天记录', 'Work']);
    const work = tree.secondary.find((n) => n.label === 'Work')!;
    expect(work.children).toHaveLength(1);
    expect(work.children[0]!.label).toBe('Receipts');
  });

  it('creates an expanded virtual container for QQ Mail \\Noselect 其他文件夹', () => {
    const folders: MailFolder[] = [
      makeFolder({ id: 'inbox', remoteName: 'INBOX', displayName: '收件箱', specialUse: 'inbox' }),
      makeFolder({
        id: 'sub1',
        remoteName: '&UXZO1mWHTvZZOQ-/QQ&k85O9v6n4gA-',
        decodedPath: '其他文件夹/QQ邮件订阅',
        displayName: '其他文件夹/QQ邮件订阅',
      }),
      makeFolder({
        id: 'sub2',
        remoteName: '&UXZO1mWHTvZZOQ-/&W11PXA-',
        decodedPath: '其他文件夹/工作',
        displayName: '其他文件夹/工作',
      }),
      makeFolder({
        id: 'sub3',
        remoteName: '&UXZO1mWHTvZZOQ-/&W11PXA-/&YgV1UQ-',
        decodedPath: '其他文件夹/工作/报销',
        displayName: '其他文件夹/工作/报销',
      }),
    ];

    const tree = buildAccountFolderTree(folders);
    expect(tree.hasNested).toBe(true);
    expect(tree.secondary).toHaveLength(1);
    const group = tree.secondary[0]!;
    expect(group.folder).toBeNull();
    expect(group.label).toBe('其他文件夹');
    expect(group.defaultExpanded).toBe(true);
    expect(group.children.map((c) => c.label)).toEqual(['工作', 'QQ邮件订阅']);
    const work = group.children.find((c) => c.label === '工作')!;
    expect(work.depth).toBe(1);
    expect(work.children[0]!.label).toBe('报销');
    expect(work.children[0]!.depth).toBe(2);
  });

  it('strips transparent INBOX. personal namespace on Courier/Cyrus dot-delimited servers', () => {
    const folders: MailFolder[] = [
      makeFolder({ id: 'inbox', remoteName: 'INBOX', displayName: '收件箱', specialUse: 'inbox', delimiter: '.' }),
      makeFolder({ id: 'sent', remoteName: 'INBOX.Sent', displayName: '已发送', specialUse: 'sent', delimiter: '.' }),
      makeFolder({ id: 'work', remoteName: 'INBOX.Work', displayName: 'INBOX.Work', delimiter: '.' }),
      makeFolder({ id: 'inv', remoteName: 'INBOX.Work.Invoices', displayName: 'INBOX.Work.Invoices', delimiter: '.' }),
    ];

    const tree = buildAccountFolderTree(folders);
    expect(tree.primary.map((n) => n.specialUse)).toEqual(['inbox', 'sent']);
    expect(tree.primary[0]!.children).toHaveLength(0);
    expect(tree.secondary).toHaveLength(1);
    expect(tree.secondary[0]!.label).toBe('Work');
    expect(tree.secondary[0]!.children[0]!.label).toBe('Invoices');
  });

  it('builds and filters move-target sections while skipping virtual containers on search', () => {
    const folders: MailFolder[] = [
      makeFolder({ id: 'inbox', remoteName: 'INBOX', displayName: '收件箱', specialUse: 'inbox' }),
      makeFolder({ id: 'trash', remoteName: 'Deleted', displayName: '已删除', specialUse: 'trash' }),
      makeFolder({ id: 'pop', remoteName: 'Deleted/POP', displayName: 'Deleted/POP' }),
      makeFolder({
        id: 'work',
        remoteName: '&UXZO1mWHTvZZOQ-/&W11PXA-',
        decodedPath: '其他文件夹/工作',
        displayName: '其他文件夹/工作',
      }),
    ];
    const tree = buildAccountFolderTree(folders);

    const unfiltered = buildMoveTargetSections(tree, '');
    expect(unfiltered.filtered).toBe(false);
    expect(unfiltered.primary.map((n) => `${n.depth}:${n.label}`)).toEqual([
      '0:收件箱',
      '0:已删除',
      '1:POP',
    ]);
    expect(unfiltered.secondary.map((n) => `${n.depth}:${n.label}:${Boolean(n.folder)}`)).toEqual([
      '0:其他文件夹:false',
      '1:工作:true',
    ]);

    const matched = buildMoveTargetSections(tree, 'pop');
    expect(matched.filtered).toBe(true);
    expect(matched.primary.map((n) => `${n.depth}:${n.label}`)).toEqual(['0:POP']);
    expect(matched.secondary).toHaveLength(0);

    const matchedByParentPath = buildMoveTargetSections(tree, '其他文件夹');
    expect(matchedByParentPath.secondary.map((n) => n.folder?.id)).toEqual(['work']);
  });

  it('triggers auto-sync for unsynced folders and legacy non-empty uncached folders only once', () => {
    const neverSynced = makeFolder({ id: 'f1', remoteName: 'Archive', displayName: '归档', syncedAt: null, totalCount: 0 });
    expect(
      shouldAutoSyncFolder(neverSynced, { cachedAllCount: 0, alreadyAttempted: false, accountSyncing: false }),
    ).toBe(true);
    expect(
      shouldAutoSyncFolder(neverSynced, { cachedAllCount: 0, alreadyAttempted: true, accountSyncing: false }),
    ).toBe(false);
    expect(
      shouldAutoSyncFolder(neverSynced, { cachedAllCount: 0, alreadyAttempted: false, accountSyncing: true }),
    ).toBe(false);

    // Legacy DB where folder metadata wrote syncedAt even though 0 messages were ever fetched.
    const legacyJunk = makeFolder({ id: 'f2', remoteName: 'Junk', displayName: '垃圾邮件', syncedAt: 1_764_000_000, totalCount: 118 });
    expect(
      shouldAutoSyncFolder(legacyJunk, { cachedAllCount: 0, alreadyAttempted: false, accountSyncing: false }),
    ).toBe(true);
    expect(
      shouldAutoSyncFolder(legacyJunk, { cachedAllCount: 40, alreadyAttempted: false, accountSyncing: false }),
    ).toBe(false);

    // Genuinely empty already-synced folder does not re-sync on click.
    const emptySynced = makeFolder({ id: 'f3', remoteName: 'Drafts', displayName: '草稿箱', syncedAt: 1_764_000_000, totalCount: 0 });
    expect(
      shouldAutoSyncFolder(emptySynced, { cachedAllCount: 0, alreadyAttempted: false, accountSyncing: false }),
    ).toBe(false);
  });

  it('disambiguates duplicate account labels and computes subtitles/shortTags for multi-account UI', () => {
    const single = buildAccountDisplayMeta([
      { id: 'a1', label: 'Outlook', email: 'alice@outlook.com', provider: 'outlook' },
    ]);
    expect(single.get('a1')).toEqual({
      title: 'Outlook',
      subtitle: '',
      shortTag: 'Outlook',
      duplicateLabel: false,
    });

    const multi = buildAccountDisplayMeta([
      { id: 'a1', label: 'Outlook', email: 'alice@outlook.com', provider: 'outlook' },
      { id: 'a2', label: 'Outlook', email: 'work@outlook.com', provider: 'outlook' },
      { id: 'a3', label: 'QQ 邮箱', email: '12345@qq.com', provider: 'qq' },
    ]);
    expect(multi.get('a1')).toEqual({
      title: 'Outlook',
      subtitle: 'alice@outlook.com',
      shortTag: 'alice',
      duplicateLabel: true,
    });
    expect(multi.get('a2')).toEqual({
      title: 'Outlook',
      subtitle: 'work@outlook.com',
      shortTag: 'work',
      duplicateLabel: true,
    });
    expect(multi.get('a3')).toEqual({
      title: 'QQ 邮箱',
      subtitle: '12345@qq.com',
      shortTag: 'QQ 邮箱',
      duplicateLabel: false,
    });

    // If two duplicate-label accounts also share the same email local part, fall back to full email.
    const sameLocal = buildAccountDisplayMeta([
      { id: 'b1', label: 'Work', email: 'alex@outlook.com', provider: 'outlook' },
      { id: 'b2', label: 'Work', email: 'alex@company.com', provider: 'custom' },
    ]);
    expect(sameLocal.get('b1')?.shortTag).toBe('alex@outlook.com');
    expect(sameLocal.get('b2')?.shortTag).toBe('alex@company.com');
  });
});
