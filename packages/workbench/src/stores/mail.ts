// SPDX-License-Identifier: MIT
import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { isFeatureEnabled } from '../features';
import { useWorkbenchRuntime } from '../runtime';
import { mailBridge } from '../mail/mail-bridge';
import { shouldAutoSyncFolder } from '../mail/mail-folders';
import {
  LOCAL_DRAFTS_ID,
  UNIFIED_INBOX_ID,
  type MailAccount,
  type MailAccountInput,
  type MailCacheStats,
  type MailComposeSeed,
  type MailCredentials,
  type MailDraft,
  type MailFilter,
  type MailFolder,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailOAuthInput,
  type MailPreset,
  type MailSendRequest,
} from '../mail/types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_STALE_SECS = 120;

export const useMailStore = defineStore('mail', () => {
  const runtime = useWorkbenchRuntime();
  const available = computed(
    () => isFeatureEnabled('desktopMailClient') && runtime.native && !runtime.mobile,
  );

  const presets = ref<MailPreset[]>([]);
  const accounts = ref<MailAccount[]>([]);
  const folders = ref<MailFolder[]>([]);
  const messages = ref<MailMessageSummary[]>([]);
  const drafts = ref<MailDraft[]>([]);
  const cacheStats = ref<MailCacheStats | null>(null);

  const selectedFolderId = ref('');
  const selectedMessageId = ref('');
  const currentDetail = ref<MailMessageDetail | null>(null);

  const filter = ref<MailFilter>('all');
  const searchQuery = ref('');
  const loading = ref(false);
  const loadingMessage = ref(false);
  const syncingAccountIds = reactive(new Set<string>());
  const syncingFolderIds = reactive(new Set<string>());
  /** Session guard so empty or unreachable folders do not re-trigger auto-sync on every click. */
  const autoSyncedFolders = new Set<string>();
  const error = ref('');
  const initialized = ref(false);

  const accountDialogOpen = ref(false);
  /** Provider preset to preselect the next time the account dialog opens. */
  const accountDialogPreset = ref('');
  const composerOpen = ref(false);
  const composeSeed = ref<MailComposeSeed | null>(null);

  let initPromise: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let startupSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let visibilityBound = false;
  let lastPollAt = 0;

  const isUnifiedInbox = computed(() => selectedFolderId.value === UNIFIED_INBOX_ID);
  const isLocalDrafts = computed(() => selectedFolderId.value === LOCAL_DRAFTS_ID);

  const syncingAccountId = computed(() => [...syncingAccountIds][0] ?? '');
  const isSyncingAnyAccount = computed(() => syncingAccountIds.size > 0);

  function isAccountSyncing(accountId: string): boolean {
    return syncingAccountIds.has(accountId);
  }

  function isFolderSyncing(folderId: string): boolean {
    return syncingFolderIds.has(folderId);
  }

  const totalUnread = computed(() =>
    folders.value
      .filter((folder) => folder.specialUse === 'inbox')
      .reduce((sum, folder) => sum + folder.unreadCount, 0),
  );

  const selectedFolder = computed(() => {
    if (isUnifiedInbox.value || isLocalDrafts.value) return undefined;
    return folders.value.find((folder) => folder.id === selectedFolderId.value);
  });

  const isSelectedFolderSyncing = computed(() => {
    if (isUnifiedInbox.value) return isSyncingAnyAccount.value;
    if (isLocalDrafts.value) return false;
    return (
      !!selectedFolderId.value &&
      (syncingFolderIds.has(selectedFolderId.value) ||
        (!!selectedFolder.value && syncingAccountIds.has(selectedFolder.value.accountId)))
    );
  });

  const foldersByAccount = computed(() => {
    const map = new Map<string, MailFolder[]>();
    for (const account of accounts.value) map.set(account.id, []);
    for (const folder of folders.value) {
      const list = map.get(folder.accountId);
      if (list) list.push(folder);
    }
    return map;
  });

  function accountInboxUnread(accountId: string): number {
    return folders.value
      .filter((f) => f.accountId === accountId && f.specialUse === 'inbox')
      .reduce((sum, f) => sum + f.unreadCount, 0);
  }

  function canRunBackgroundSync(): boolean {
    if (!available.value || !accounts.value.length) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return true;
  }

  function onVisibilityChange() {
    if (!canRunBackgroundSync()) return;
    if (Date.now() - lastPollAt >= POLL_INTERVAL_MS) {
      void syncAllAccounts({ silent: true });
    }
  }

  function startPolling() {
    if (!available.value) return;
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (!canRunBackgroundSync()) return;
        void syncAllAccounts({ silent: true });
      }, POLL_INTERVAL_MS);
    }
    if (!visibilityBound && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = true;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (startupSyncTimer) {
      clearTimeout(startupSyncTimer);
      startupSyncTimer = undefined;
    }
    if (visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = false;
    }
  }

  function scheduleStartupSilentSync() {
    if (!accounts.value.length || startupSyncTimer) return;
    const nowSecs = Math.floor(Date.now() / 1000);
    const hasStaleAccount = accounts.value.some((acc) => {
      const inbox = folders.value.find(
        (f) => f.accountId === acc.id && f.specialUse === 'inbox',
      );
      if (!inbox || inbox.syncedAt === null) return true;
      return nowSecs - inbox.syncedAt >= INITIAL_STALE_SECS;
    });
    if (!hasStaleAccount) {
      lastPollAt = Date.now();
      return;
    }
    startupSyncTimer = setTimeout(() => {
      startupSyncTimer = undefined;
      if (canRunBackgroundSync()) {
        void syncAllAccounts({ silent: true });
      }
    }, 1500);
  }

  async function init() {
    if (!available.value) return;
    if (initialized.value) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      loading.value = true;
      error.value = '';
      try {
        const [presetList, accountList, folderList, draftList, stats] = await Promise.all([
          mailBridge.presetsList(),
          mailBridge.accountsList(),
          mailBridge.foldersList(),
          mailBridge.draftsList(),
          mailBridge.cacheStats(),
        ]);
        presets.value = presetList;
        accounts.value = accountList;
        folders.value = folderList;
        drafts.value = draftList;
        cacheStats.value = stats;
        initialized.value = true;

        if (!selectedFolderId.value) {
          if (accountList.length > 1) {
            await selectUnifiedInbox();
          } else if (folderList.length) {
            const firstInbox = folderList.find((f) => f.specialUse === 'inbox') ?? folderList[0]!;
            await selectFolder(firstInbox.id);
          }
        }
        startPolling();
        scheduleStartupSilentSync();
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        loading.value = false;
        initPromise = null;
      }
    })();

    return initPromise;
  }

  async function refreshAccounts() {
    if (!available.value) return;
    accounts.value = await mailBridge.accountsList();
    folders.value = await mailBridge.foldersList();
    drafts.value = await mailBridge.draftsList();
    cacheStats.value = await mailBridge.cacheStats();
  }

  async function testAccount(input: MailAccountInput, credentials: MailCredentials) {
    if (!available.value) throw new Error('仅桌面端支持原生邮箱连接');
    return mailBridge.accountTest(input, credentials);
  }

  async function saveAccount(input: MailAccountInput, credentials?: MailCredentials) {
    if (!available.value) throw new Error('仅桌面端支持原生邮箱连接');
    const saved = await mailBridge.accountSave(input, credentials);
    await refreshAccounts();
    startPolling();
    return saved;
  }

  async function authorizeOAuth(input: MailOAuthInput) {
    if (!available.value) throw new Error('仅桌面端支持原生邮箱连接');
    const saved = await mailBridge.oauthAuthorize(input);
    await refreshAccounts();
    startPolling();
    return saved;
  }

  async function cancelOAuth() {
    if (!available.value) return;
    await mailBridge.oauthCancel();
  }

  async function removeAccount(accountId: string) {
    if (!available.value) return;
    for (const folder of folders.value) {
      if (folder.accountId === accountId) {
        autoSyncedFolders.delete(folder.id);
        syncingFolderIds.delete(folder.id);
      }
    }
    syncingAccountIds.delete(accountId);
    await mailBridge.accountRemove(accountId);
    if (selectedFolder.value?.accountId === accountId) {
      selectedFolderId.value = '';
      selectedMessageId.value = '';
      currentDetail.value = null;
      messages.value = [];
    }
    await refreshAccounts();
    if (!accounts.value.length) {
      selectedFolderId.value = '';
      selectedMessageId.value = '';
      currentDetail.value = null;
      messages.value = [];
      stopPolling();
      return;
    }
    if (isUnifiedInbox.value && accounts.value.length < 2) {
      const next = folders.value.find((f) => f.specialUse === 'inbox') ?? folders.value[0];
      if (next) await selectFolder(next.id);
    } else if (!selectedFolderId.value && folders.value.length) {
      if (accounts.value.length > 1) {
        await selectUnifiedInbox();
      } else {
        const next = folders.value.find((f) => f.specialUse === 'inbox') ?? folders.value[0]!;
        await selectFolder(next.id);
      }
    } else if (isUnifiedInbox.value) {
      await reloadMessages();
    }
  }

  async function syncAccount(accountId: string, options: { silent?: boolean } = {}) {
    if (!available.value || syncingAccountIds.has(accountId)) return;
    syncingAccountIds.add(accountId);
    if (!options.silent) error.value = '';
    try {
      await mailBridge.syncAccount(accountId);
      folders.value = await mailBridge.foldersList();
      // Allow previously skipped/offline folders in this account to retry auto-sync if still unsynced.
      for (const folder of folders.value) {
        if (folder.accountId === accountId && folder.syncedAt === null) {
          autoSyncedFolders.delete(folder.id);
        }
      }
      if (isUnifiedInbox.value) {
        await reloadMessages();
      } else if (!isLocalDrafts.value) {
        const selectedStillExists =
          !!selectedFolderId.value && folders.value.some((f) => f.id === selectedFolderId.value);
        if (selectedStillExists) {
          if (selectedFolder.value?.accountId === accountId) {
            await reloadMessages();
          }
        } else if (accounts.value.length > 1) {
          await selectUnifiedInbox();
        } else {
          const inbox =
            folders.value.find((f) => f.accountId === accountId && f.specialUse === 'inbox') ??
            folders.value.find((f) => f.accountId === accountId);
          if (inbox) {
            await selectFolder(inbox.id);
          } else {
            selectedFolderId.value = '';
            selectedMessageId.value = '';
            currentDetail.value = null;
            messages.value = [];
          }
        }
      }
      cacheStats.value = await mailBridge.cacheStats();
    } catch (err) {
      if (!options.silent) {
        error.value = err instanceof Error ? err.message : String(err);
        throw err;
      }
    } finally {
      syncingAccountIds.delete(accountId);
    }
  }

  async function syncAllAccounts(options: { silent?: boolean } = {}) {
    if (!available.value || !accounts.value.length) return;
    if (!options.silent) error.value = '';
    lastPollAt = Date.now();
    const results = await Promise.allSettled(
      accounts.value.map((acc) => syncAccount(acc.id, { silent: true })),
    );
    if (!options.silent) {
      const firstRejected = results.find(
        (res): res is PromiseRejectedResult => res.status === 'rejected',
      );
      if (firstRejected) {
        error.value =
          firstRejected.reason instanceof Error
            ? firstRejected.reason.message
            : String(firstRejected.reason);
      }
    }
    if (isUnifiedInbox.value) {
      await reloadMessages();
    }
  }

  async function syncFolder(folderId: string, options: { silent?: boolean } = {}) {
    if (!available.value || !folderId || syncingFolderIds.has(folderId)) return;
    const folder = folders.value.find((f) => f.id === folderId);
    if (!folder) return;
    if (syncingAccountIds.has(folder.accountId)) return;

    syncingFolderIds.add(folderId);
    if (selectedFolderId.value === folderId && !options.silent) error.value = '';
    try {
      await mailBridge.syncFolder(folderId);
      autoSyncedFolders.add(folderId);
      folders.value = await mailBridge.foldersList();
      cacheStats.value = await mailBridge.cacheStats();
      if (selectedFolderId.value === folderId) {
        await reloadMessages();
        if (
          messages.value.length &&
          !messages.value.some((m) => m.id === selectedMessageId.value)
        ) {
          await selectMessage(messages.value[0]!.id);
        }
      } else if (isUnifiedInbox.value && folder.specialUse === 'inbox') {
        await reloadMessages();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (selectedFolderId.value === folderId) {
        error.value = msg;
      }
      if (!options.silent) throw err;
    } finally {
      syncingFolderIds.delete(folderId);
    }
  }

  async function syncSelectedFolder() {
    if (!available.value || !selectedFolderId.value) return;
    if (isUnifiedInbox.value) {
      await syncAllAccounts();
      return;
    }
    if (isLocalDrafts.value) {
      drafts.value = await mailBridge.draftsList();
      return;
    }
    await syncFolder(selectedFolderId.value);
  }

  async function selectUnifiedInbox() {
    if (!available.value) return;
    selectedFolderId.value = UNIFIED_INBOX_ID;
    searchQuery.value = '';
    error.value = '';
    await reloadMessages();
    if (selectedFolderId.value !== UNIFIED_INBOX_ID) return;

    if (messages.value.length && !messages.value.some((m) => m.id === selectedMessageId.value)) {
      await selectMessage(messages.value[0]!.id);
    } else if (!messages.value.length) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }

    // Trigger silent sync for any account whose inbox has never been synced yet.
    const unsyncedAccounts = accounts.value.filter((acc) => {
      const inbox = folders.value.find(
        (f) => f.accountId === acc.id && f.specialUse === 'inbox',
      );
      return !inbox || (inbox.syncedAt === null && !autoSyncedFolders.has(inbox.id));
    });
    for (const acc of unsyncedAccounts) {
      const inbox = folders.value.find(
        (f) => f.accountId === acc.id && f.specialUse === 'inbox',
      );
      if (inbox) autoSyncedFolders.add(inbox.id);
      void syncAccount(acc.id, { silent: true });
    }
  }

  async function selectLocalDrafts() {
    if (!available.value) return;
    selectedFolderId.value = LOCAL_DRAFTS_ID;
    searchQuery.value = '';
    error.value = '';
    messages.value = [];
    selectedMessageId.value = '';
    currentDetail.value = null;
    drafts.value = await mailBridge.draftsList();
  }

  async function selectFolder(folderId: string) {
    if (!available.value) return;
    if (folderId === UNIFIED_INBOX_ID) {
      await selectUnifiedInbox();
      return;
    }
    if (folderId === LOCAL_DRAFTS_ID) {
      await selectLocalDrafts();
      return;
    }
    selectedFolderId.value = folderId;
    searchQuery.value = '';
    error.value = '';
    await reloadMessages();
    if (selectedFolderId.value !== folderId) return;

    if (messages.value.length && !messages.value.some((m) => m.id === selectedMessageId.value)) {
      await selectMessage(messages.value[0]!.id);
    } else if (!messages.value.length) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }

    const folder = folders.value.find((f) => f.id === folderId);
    if (!folder) return;
    let cachedAllCount = messages.value.length;
    if (
      cachedAllCount === 0 &&
      filter.value !== 'all' &&
      folder.syncedAt !== null &&
      folder.totalCount > 0
    ) {
      const probe = await mailBridge.messagesList(folderId, {
        limit: 1,
        offset: 0,
        filter: 'all',
      });
      if (selectedFolderId.value !== folderId) return;
      cachedAllCount = probe.length;
    }

    if (
      shouldAutoSyncFolder(folder, {
        cachedAllCount,
        alreadyAttempted: autoSyncedFolders.has(folderId),
        accountSyncing: syncingAccountIds.has(folder.accountId),
      })
    ) {
      autoSyncedFolders.add(folderId);
      void syncFolder(folderId, { silent: true });
    }
  }

  async function reloadMessages() {
    if (!available.value) return;
    if (isLocalDrafts.value) {
      messages.value = [];
      drafts.value = await mailBridge.draftsList();
      return;
    }
    if (searchQuery.value.trim()) {
      messages.value = await mailBridge.messagesSearch(
        searchQuery.value.trim(),
        isUnifiedInbox.value ? undefined : selectedFolder.value?.accountId,
      );
      return;
    }
    if (isUnifiedInbox.value) {
      messages.value = await mailBridge.messagesListInbox({
        limit: 80,
        offset: 0,
        filter: filter.value,
      });
      return;
    }
    if (!selectedFolderId.value) {
      messages.value = [];
      return;
    }
    messages.value = await mailBridge.messagesList(selectedFolderId.value, {
      limit: 80,
      offset: 0,
      filter: filter.value,
    });
  }

  async function setFilter(next: MailFilter) {
    filter.value = next;
    await reloadMessages();
  }

  async function search(query: string) {
    searchQuery.value = query;
    await reloadMessages();
  }

  async function selectMessage(messageId: string, forceRefresh = false) {
    if (!available.value) return;
    selectedMessageId.value = messageId;
    loadingMessage.value = true;
    error.value = '';
    try {
      const detail = await mailBridge.messageGet(messageId, forceRefresh);
      if (selectedMessageId.value !== messageId) return;
      currentDetail.value = detail;
      if (!detail.summary.seen) {
        const updated = await mailBridge.updateFlags(messageId, { seen: true });
        if (selectedMessageId.value === messageId) currentDetail.value = updated;
        syncSummaryInList(updated.summary);
        folders.value = await mailBridge.foldersList();
      } else {
        syncSummaryInList(detail.summary);
      }
      cacheStats.value = await mailBridge.cacheStats();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loadingMessage.value = false;
    }
  }

  function syncSummaryInList(summary: MailMessageSummary) {
    messages.value = messages.value.map((item) => (item.id === summary.id ? summary : item));
  }

  async function toggleSeen(messageId: string, nextSeen: boolean) {
    if (!available.value) return;
    const updated = await mailBridge.updateFlags(messageId, { seen: nextSeen });
    syncSummaryInList(updated.summary);
    if (currentDetail.value?.summary.id === messageId) currentDetail.value = updated;
    folders.value = await mailBridge.foldersList();
  }

  async function toggleFlagged(messageId: string, nextFlagged: boolean) {
    if (!available.value) return;
    const updated = await mailBridge.updateFlags(messageId, { flagged: nextFlagged });
    syncSummaryInList(updated.summary);
    if (currentDetail.value?.summary.id === messageId) currentDetail.value = updated;
  }

  async function moveToFolder(messageId: string, targetFolderId: string): Promise<MailFolder | null> {
    if (!available.value) return null;
    const summary = messages.value.find((m) => m.id === messageId) ?? currentDetail.value?.summary;
    if (!summary) return null;
    const target = folders.value.find((f) => f.id === targetFolderId);
    if (!target) {
      throw new Error('找不到目标文件夹');
    }
    if (target.accountId !== summary.accountId) {
      throw new Error('不支持跨邮箱账号移动邮件');
    }
    if (target.id === summary.folderId) return null;
    await mailBridge.moveMessage(messageId, target.id);
    messages.value = messages.value.filter((m) => m.id !== messageId);
    if (selectedMessageId.value === messageId) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }
    // Allow destination folder to auto-sync the newly moved message on next visit.
    autoSyncedFolders.delete(target.id);
    folders.value = await mailBridge.foldersList();
    return target;
  }

  async function moveToSpecialFolder(
    messageId: string,
    specialUse: 'trash' | 'archive',
  ): Promise<MailFolder | null> {
    if (!available.value) return null;
    const summary = messages.value.find((m) => m.id === messageId) ?? currentDetail.value?.summary;
    if (!summary) return null;
    let target = folders.value.find(
      (f) => f.accountId === summary.accountId && f.specialUse === specialUse,
    );
    // Gmail archives messages by moving them out of Inbox into `[Gmail]/All Mail` (`\All`).
    if (!target && specialUse === 'archive') {
      target = folders.value.find(
        (f) => f.accountId === summary.accountId && f.specialUse === 'all',
      );
    }
    if (!target) {
      throw new Error(specialUse === 'trash' ? '该邮箱未提供废纸篓文件夹' : '该邮箱未提供归档文件夹');
    }
    return moveToFolder(messageId, target.id);
  }

  async function deleteMessage(messageId: string) {
    if (!available.value) return;
    await mailBridge.deleteMessage(messageId);
    messages.value = messages.value.filter((m) => m.id !== messageId);
    if (selectedMessageId.value === messageId) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }
    folders.value = await mailBridge.foldersList();
    cacheStats.value = await mailBridge.cacheStats();
  }

  async function markInviteState(
    inviteId: string,
    importedObjectId?: string | null,
    rsvpStatus?: string | null,
  ) {
    if (!available.value) return;
    await mailBridge.updateInvite(inviteId, importedObjectId, rsvpStatus);
    if (currentDetail.value) {
      currentDetail.value = {
        ...currentDetail.value,
        invites: currentDetail.value.invites.map((inv) =>
          inv.id === inviteId
            ? {
                ...inv,
                importedObjectId: importedObjectId ?? inv.importedObjectId,
                rsvpStatus: rsvpStatus ?? inv.rsvpStatus,
              }
            : inv,
        ),
      };
    }
  }

  async function downloadAttachment(attachmentId: string) {
    if (!available.value) throw new Error('仅桌面端支持下载邮件附件');
    const result = await mailBridge.downloadAttachment(attachmentId);
    if (currentDetail.value) {
      currentDetail.value = {
        ...currentDetail.value,
        attachments: currentDetail.value.attachments.map((att) =>
          att.id === attachmentId ? { ...att, downloaded: true } : att,
        ),
      };
    }
    cacheStats.value = await mailBridge.cacheStats();
    return result;
  }

  async function sendMail(request: MailSendRequest, options?: { draftId?: string }) {
    if (!available.value) throw new Error('仅桌面端支持原生发信');
    const result = await mailBridge.sendMail(request);
    if (options?.draftId) {
      try {
        await deleteDraft(options.draftId);
      } catch {
        // Sending already succeeded; draft cleanup failure should not surface as send error.
      }
    }
    const sentFolder = folders.value.find(
      (f) => f.accountId === request.accountId && f.specialUse === 'sent',
    );
    if (sentFolder) {
      autoSyncedFolders.delete(sentFolder.id);
      folders.value = await mailBridge.foldersList();
      // Give provider SMTP-to-Sent ingestion a brief moment, then refresh Sent in the background.
      setTimeout(() => {
        if (available.value && folders.value.some((f) => f.id === sentFolder.id)) {
          void syncFolder(sentFolder.id, { silent: true });
        }
      }, 1200);
    }
    return result;
  }

  async function clearCache() {
    if (!available.value) return;
    cacheStats.value = await mailBridge.cacheClear();
    currentDetail.value = null;
    selectedMessageId.value = '';
  }

  async function saveDraft(draft: MailDraft) {
    if (!available.value) return;
    const saved = await mailBridge.draftSave(draft);
    drafts.value = [saved, ...drafts.value.filter((d) => d.id !== saved.id)];
    return saved;
  }

  async function deleteDraft(draftId: string) {
    if (!available.value) return;
    await mailBridge.draftDelete(draftId);
    drafts.value = drafts.value.filter((d) => d.id !== draftId);
  }

  function openComposer(seed: MailComposeSeed = {}) {
    if (!available.value) return;
    composeSeed.value = {
      accountId: seed.accountId ?? selectedFolder.value?.accountId ?? accounts.value[0]?.id,
      ...seed,
    };
    composerOpen.value = true;
  }

  function openDraftInComposer(draft: MailDraft) {
    openComposer({
      draftId: draft.id,
      accountId: draft.accountId,
      to: [...draft.to],
      cc: [...draft.cc],
      bcc: [...draft.bcc],
      subject: draft.subject,
      markdownBody: draft.markdownBody,
      inReplyTo: draft.inReplyTo,
      references: [...draft.references],
    });
  }

  function closeComposer() {
    composerOpen.value = false;
    composeSeed.value = null;
  }

  return {
    available,
    presets,
    accounts,
    folders,
    foldersByAccount,
    messages,
    drafts,
    cacheStats,
    selectedFolderId,
    selectedFolder,
    isUnifiedInbox,
    isLocalDrafts,
    selectedMessageId,
    currentDetail,
    filter,
    searchQuery,
    loading,
    loadingMessage,
    syncingAccountId,
    isSyncingAnyAccount,
    isAccountSyncing,
    isSelectedFolderSyncing,
    isFolderSyncing,
    accountInboxUnread,
    error,
    initialized,
    totalUnread,
    accountDialogOpen,
    accountDialogPreset,
    composerOpen,
    composeSeed,
    init,
    startPolling,
    stopPolling,
    refreshAccounts,
    testAccount,
    saveAccount,
    authorizeOAuth,
    cancelOAuth,
    removeAccount,
    syncAccount,
    syncAllAccounts,
    syncFolder,
    syncSelectedFolder,
    selectUnifiedInbox,
    selectLocalDrafts,
    selectFolder,
    reloadMessages,
    setFilter,
    search,
    selectMessage,
    toggleSeen,
    toggleFlagged,
    moveToFolder,
    moveToSpecialFolder,
    deleteMessage,
    markInviteState,
    downloadAttachment,
    sendMail,
    clearCache,
    saveDraft,
    deleteDraft,
    openComposer,
    openDraftInComposer,
    closeComposer,
  };
});
