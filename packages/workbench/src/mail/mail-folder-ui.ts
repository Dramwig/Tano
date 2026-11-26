// SPDX-License-Identifier: MIT
import {
  Archive,
  Bookmark,
  FileText,
  Folder,
  Inbox,
  Mail,
  Send,
  ShieldAlert,
  Star,
  StickyNote,
  Trash2,
} from 'lucide-vue-next';
import { t } from '../i18n/i18n';
import type { MailFolder } from './types';

export function folderIcon(specialUse: string | null) {
  switch (specialUse) {
    case 'inbox':
      return Inbox;
    case 'flagged':
      return Star;
    case 'important':
      return Bookmark;
    case 'sent':
      return Send;
    case 'drafts':
      return FileText;
    case 'archive':
      return Archive;
    case 'all':
      return Mail;
    case 'junk':
      return ShieldAlert;
    case 'trash':
      return Trash2;
    case 'notes':
      return StickyNote;
    default:
      return Folder;
  }
}

export function localizedSpecialFolderName(specialUse: string | null): string | null {
  switch (specialUse) {
    case 'inbox':
      return t('收件箱');
    case 'flagged':
      return t('星标邮件');
    case 'important':
      return t('重要邮件');
    case 'sent':
      return t('已发送');
    case 'drafts':
      return t('草稿箱');
    case 'archive':
      return t('归档');
    case 'all':
      return t('全部邮件');
    case 'junk':
      return t('垃圾邮件');
    case 'trash':
      return t('已删除');
    case 'notes':
      return t('便签');
    default:
      return null;
  }
}

export function localizedFolderLabel(specialUse: string | null, fallback: string): string {
  return localizedSpecialFolderName(specialUse) ?? fallback;
}

export function folderDisplayTitle(folder: Pick<MailFolder, 'specialUse' | 'displayName'>): string {
  return localizedSpecialFolderName(folder.specialUse) ?? folder.displayName;
}
