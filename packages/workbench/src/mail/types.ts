// SPDX-License-Identifier: MIT

export const MAIL_TAB_ID = 'view:mail';

export type TlsMode = 'tls' | 'starttls';
export type AppendSentPolicy = 'auto' | 'never' | 'always';
export type MailAuthKind = 'password' | 'oauth2-microsoft';
export type MailFilter = 'all' | 'unread' | 'flagged' | 'calendar' | 'attachments';
export type RsvpResponseStatus = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

export interface MailPreset {
  id: string;
  name: string;
  authKind?: MailAuthKind;
  oauthConfigured?: boolean;
  imapHost: string;
  imapPort: number;
  imapTls: TlsMode;
  smtpHost: string;
  smtpPort: number;
  smtpTls: TlsMode;
  appendSent: AppendSentPolicy;
  sendImapId: boolean;
  authHint: string;
}

export interface MailAccount {
  id: string;
  provider: string;
  label: string;
  email: string;
  displayName: string;
  authKind?: MailAuthKind;
  oauthClientId?: string | null;
  oauthTenant?: string | null;
  imapHost: string;
  imapPort: number;
  imapTls: TlsMode;
  smtpHost: string;
  smtpPort: number;
  smtpTls: TlsMode;
  appendSent: AppendSentPolicy;
  sendImapId: boolean;
  createdAt: number;
}

export interface MailAccountInput {
  id?: string;
  provider: string;
  label: string;
  email: string;
  displayName: string;
  authKind?: MailAuthKind;
  oauthClientId?: string | null;
  oauthTenant?: string | null;
  imapHost: string;
  imapPort: number;
  imapTls: TlsMode;
  smtpHost: string;
  smtpPort: number;
  smtpTls: TlsMode;
  appendSent: AppendSentPolicy;
  sendImapId: boolean;
}

export interface MailCredentials {
  username: string;
  password: string;
}

export interface MailOAuthInput {
  id?: string;
  provider: string;
  label?: string;
  email?: string;
  displayName?: string;
  oauthClientId?: string | null;
  oauthTenant?: string | null;
  imapHost?: string;
  imapPort?: number;
  imapTls?: TlsMode;
  smtpHost?: string;
  smtpPort?: number;
  smtpTls?: TlsMode;
}

export interface MailTestResult {
  imapOk: boolean;
  smtpOk: boolean;
  folderCount: number;
  message: string;
}

export interface MailFolder {
  id: string;
  accountId: string;
  remoteName: string;
  displayName: string;
  specialUse: string | null;
  uidValidity: number | null;
  uidNext: number | null;
  unreadCount: number;
  totalCount: number;
  syncedAt: number | null;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailMessageSummary {
  id: string;
  accountId: string;
  folderId: string;
  uid: number;
  messageId: string;
  threadKey: string;
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  dateTs: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  hasIcs: boolean;
  bodyFetched: boolean;
}

export interface MailAttachmentInfo {
  id: string;
  messageId: string;
  partId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  cid: string | null;
  isInline: boolean;
  downloaded: boolean;
}

export interface MailCalendarInvite {
  id: string;
  messageId: string;
  icsUid: string;
  method: string;
  summary: string;
  rawIcs: string;
  importedObjectId: string | null;
  rsvpStatus: string | null;
}

export interface MailMessageDetail {
  summary: MailMessageSummary;
  cc: MailAddress[];
  replyTo: MailAddress[];
  inReplyTo: string | null;
  references: string[];
  textBody: string;
  htmlSanitized: string;
  hasRemoteImages: boolean;
  attachments: MailAttachmentInfo[];
  invites: MailCalendarInvite[];
}

export interface MailSyncSummary {
  accountId: string;
  foldersSynced: number;
  messagesAdded: number;
  syncedAt: number;
}

export interface MailFlagsPatch {
  seen?: boolean;
  flagged?: boolean;
}

export interface MailSendAttachment {
  filename: string;
  contentType: string;
  bytesBase64: string;
}

export interface MailSendRequest {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: MailSendAttachment[];
  calendarIcs?: string;
  calendarMethod?: string;
}

export interface MailSendResult {
  messageId: string;
  appendedToSent: boolean;
}

export interface MailDownloadedAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  bytesBase64: string;
}

export interface MailCacheStats {
  messageCount: number;
  cachedBodyBytes: number;
  cachedAttachmentBytes: number;
  limitBytes: number;
}

export interface MailDraft {
  id: string;
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  markdownBody: string;
  inReplyTo: string | null;
  references: string[];
  updatedAt: number;
}

export interface MailComposeSeed {
  accountId?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  markdownBody?: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: MailSendAttachment[];
}

export function formatMailAddress(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}

export function formatMailAddressList(list: readonly MailAddress[]): string {
  return list.map(formatMailAddress).join(', ');
}
