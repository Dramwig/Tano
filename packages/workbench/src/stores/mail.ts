// SPDX-License-Identifier: MIT
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { isFeatureEnabled } from '../features';
import { useWorkbenchRuntime } from '../runtime';
import { mailBridge } from '../mail/mail-bridge';
import type {
  MailAccount,
  MailAccountInput,
  MailCacheStats,
  MailComposeSeed,
  MailCredentials,
  MailDraft,
  MailFilter,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MailOAuthInput,
  MailPreset,
  MailSendRequest,
} from '../mail/types';

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
  const syncingAccountId = ref('');
  const error = ref('');
  const initialized = ref(false);

  const accountDialogOpen = ref(false);
  /** Provider preset to preselect the next time the account dialog opens. */
  const accountDialogPreset = ref('');
  const composerOpen = ref(false);
  const composeSeed = ref<MailComposeSeed | null>(null);

  const totalUnread = computed(() =>
    folders.value
      .filter((folder) => folder.specialUse === 'inbox')
      .reduce((sum, folder) => sum + folder.unreadCount, 0),
  );

  const selectedFolder = computed(() =>
    folders.value.find((folder) => folder.id === selectedFolderId.value),
  );

  const foldersByAccount = computed(() => {
    const map = new Map<string, MailFolder[]>();
    for (const account of accounts.value) map.set(account.id, []);
    for (const folder of folders.value) {
      const list = map.get(folder.accountId);
      if (list) list.push(folder);
    }
    return map;
  });

  async function init() {
    if (!available.value) return;
    if (initialized.value) return;
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

      if (!selectedFolderId.value && folderList.length) {
        const firstInbox = folderList.find((f) => f.specialUse === 'inbox') ?? folderList[0]!;
        await selectFolder(firstInbox.id);
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function refreshAccounts() {
    if (!available.value) return;
    accounts.value = await mailBridge.accountsList();
    folders.value = await mailBridge.foldersList();
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
    return saved;
  }

  async function authorizeOAuth(input: MailOAuthInput) {
    if (!available.value) throw new Error('仅桌面端支持原生邮箱连接');
    const saved = await mailBridge.oauthAuthorize(input);
    await refreshAccounts();
    return saved;
  }

  async function cancelOAuth() {
    if (!available.value) return;
    await mailBridge.oauthCancel();
  }

  async function removeAccount(accountId: string) {
    if (!available.value) return;
    await mailBridge.accountRemove(accountId);
    if (selectedFolder.value?.accountId === accountId) {
      selectedFolderId.value = '';
      selectedMessageId.value = '';
      currentDetail.value = null;
      messages.value = [];
    }
    await refreshAccounts();
    if (!selectedFolderId.value && folders.value.length) {
      const next = folders.value.find((f) => f.specialUse === 'inbox') ?? folders.value[0]!;
      await selectFolder(next.id);
    }
  }

  async function syncAccount(accountId: string) {
    if (!available.value || syncingAccountId.value) return;
    syncingAccountId.value = accountId;
    error.value = '';
    try {
      await mailBridge.syncAccount(accountId);
      folders.value = await mailBridge.foldersList();
      if (selectedFolderId.value) {
        await reloadMessages();
      } else {
        const inbox =
          folders.value.find((f) => f.accountId === accountId && f.specialUse === 'inbox') ??
          folders.value.find((f) => f.accountId === accountId);
        if (inbox) await selectFolder(inbox.id);
      }
      cacheStats.value = await mailBridge.cacheStats();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      syncingAccountId.value = '';
    }
  }

  async function syncSelectedFolder() {
    if (!available.value || !selectedFolderId.value || syncingAccountId.value) return;
    const folder = selectedFolder.value;
    if (!folder) return;
    syncingAccountId.value = folder.accountId;
    error.value = '';
    try {
      await mailBridge.syncFolder(folder.id);
      folders.value = await mailBridge.foldersList();
      await reloadMessages();
      cacheStats.value = await mailBridge.cacheStats();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      syncingAccountId.value = '';
    }
  }

  async function selectFolder(folderId: string) {
    if (!available.value) return;
    selectedFolderId.value = folderId;
    searchQuery.value = '';
    await reloadMessages();
    if (messages.value.length && !messages.value.some((m) => m.id === selectedMessageId.value)) {
      await selectMessage(messages.value[0]!.id);
    } else if (!messages.value.length) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }
  }

  async function reloadMessages() {
    if (!available.value) return;
    if (searchQuery.value.trim()) {
      messages.value = await mailBridge.messagesSearch(
        searchQuery.value.trim(),
        selectedFolder.value?.accountId,
      );
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

  async function moveToSpecialFolder(messageId: string, specialUse: 'trash' | 'archive') {
    if (!available.value) return;
    const summary = messages.value.find((m) => m.id === messageId) ?? currentDetail.value?.summary;
    if (!summary) return;
    const target = folders.value.find(
      (f) => f.accountId === summary.accountId && f.specialUse === specialUse,
    );
    if (!target) {
      throw new Error(specialUse === 'trash' ? '该邮箱未提供废纸篓文件夹' : '该邮箱未提供归档文件夹');
    }
    await mailBridge.moveMessage(messageId, target.id);
    messages.value = messages.value.filter((m) => m.id !== messageId);
    if (selectedMessageId.value === messageId) {
      selectedMessageId.value = '';
      currentDetail.value = null;
    }
    folders.value = await mailBridge.foldersList();
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

  async function sendMail(request: MailSendRequest) {
    if (!available.value) throw new Error('仅桌面端支持原生发信');
    return mailBridge.sendMail(request);
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
    selectedMessageId,
    currentDetail,
    filter,
    searchQuery,
    loading,
    loadingMessage,
    syncingAccountId,
    error,
    initialized,
    totalUnread,
    accountDialogOpen,
    accountDialogPreset,
    composerOpen,
    composeSeed,
    init,
    refreshAccounts,
    testAccount,
    saveAccount,
    authorizeOAuth,
    cancelOAuth,
    removeAccount,
    syncAccount,
    syncSelectedFolder,
    selectFolder,
    reloadMessages,
    setFilter,
    search,
    selectMessage,
    toggleSeen,
    toggleFlagged,
    moveToSpecialFolder,
    markInviteState,
    downloadAttachment,
    sendMail,
    clearCache,
    saveDraft,
    deleteDraft,
    openComposer,
    closeComposer,
  };
});
