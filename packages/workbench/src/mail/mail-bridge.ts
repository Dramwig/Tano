// SPDX-License-Identifier: MIT
import { nativeInvoke as invoke } from '../platform/native-bridge';
import type {
  MailAccount,
  MailAccountInput,
  MailCacheStats,
  MailCredentials,
  MailDownloadedAttachment,
  MailDraft,
  MailFilter,
  MailFlagsPatch,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MailPreset,
  MailSendRequest,
  MailSendResult,
  MailSyncSummary,
  MailTestResult,
} from './types';

export const mailBridge = {
  presetsList: () => invoke<MailPreset[]>('mail_presets_list'),
  accountsList: () => invoke<MailAccount[]>('mail_accounts_list'),
  accountTest: (input: MailAccountInput, credentials: MailCredentials) =>
    invoke<MailTestResult>('mail_account_test', { input, credentials }),
  accountSave: (input: MailAccountInput, credentials?: MailCredentials) =>
    invoke<MailAccount>('mail_account_save', { input, credentials: credentials ?? null }),
  accountRemove: (accountId: string) => invoke<void>('mail_account_remove', { accountId }),
  foldersList: (accountId?: string) =>
    invoke<MailFolder[]>('mail_folders_list', { accountId: accountId ?? null }),
  syncAccount: (accountId: string) => invoke<MailSyncSummary>('mail_sync_account', { accountId }),
  syncFolder: (folderId: string) => invoke<MailSyncSummary>('mail_sync_folder', { folderId }),
  messagesList: (folderId: string, options?: { limit?: number; offset?: number; filter?: MailFilter }) =>
    invoke<MailMessageSummary[]>('mail_messages_list', {
      folderId,
      limit: options?.limit ?? 60,
      offset: options?.offset ?? 0,
      filter: options?.filter && options.filter !== 'all' ? options.filter : null,
    }),
  messagesSearch: (query: string, accountId?: string, limit = 60) =>
    invoke<MailMessageSummary[]>('mail_messages_search', {
      accountId: accountId ?? null,
      query,
      limit,
    }),
  messageGet: (messageId: string, forceRefresh = false) =>
    invoke<MailMessageDetail>('mail_message_get', { messageId, forceRefresh }),
  updateFlags: (messageId: string, patch: MailFlagsPatch) =>
    invoke<MailMessageDetail>('mail_message_flags_update', { messageId, patch }),
  moveMessage: (messageId: string, targetFolderId: string) =>
    invoke<void>('mail_message_move', { messageId, targetFolderId }),
  updateInvite: (inviteId: string, importedObjectId?: string | null, rsvpStatus?: string | null) =>
    invoke<void>('mail_invite_update', {
      inviteId,
      importedObjectId: importedObjectId ?? null,
      rsvpStatus: rsvpStatus ?? null,
    }),
  downloadAttachment: (attachmentId: string) =>
    invoke<MailDownloadedAttachment>('mail_attachment_download', { attachmentId }),
  sendMail: (request: MailSendRequest) => invoke<MailSendResult>('mail_send', { request }),
  cacheStats: () => invoke<MailCacheStats>('mail_cache_stats'),
  cacheClear: () => invoke<MailCacheStats>('mail_cache_clear'),
  draftsList: (accountId?: string) =>
    invoke<MailDraft[]>('mail_drafts_list', { accountId: accountId ?? null }),
  draftSave: (draft: MailDraft) => invoke<MailDraft>('mail_draft_save', { draft }),
  draftDelete: (draftId: string) => invoke<void>('mail_draft_delete', { draftId }),
};
