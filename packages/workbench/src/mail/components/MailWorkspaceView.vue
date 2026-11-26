<script setup lang="ts">
import '../../styles/mail.css';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronRight,
  Download,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderInput,
  Forward,
  Image as ImageIcon,
  ListTodo,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useMailStore } from '../../stores/mail';
import { usePlanStore } from '../../stores/plans';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  buildEventDraftFromInvite,
  buildPlanDraftFromEmail,
  buildRsvpReplyIcs,
  parseInvitePreview,
} from '../mail-calendar';
import { buildAccountDisplayMeta } from '../mail-folders';
import {
  buildSandboxedEmailSrcdoc,
  emailToMarkdownDocument,
  safeMailDocumentPath,
} from '../mail-markdown';
import {
  formatMailAddressList,
  type MailAttachmentInfo,
  type MailCalendarInvite,
  type MailDraft,
  type MailFilter,
  type MailMessageSummary,
  type RsvpResponseStatus,
} from '../types';
import { avatarHue, senderInitial } from '../mail-avatar';
import { folderDisplayTitle } from '../mail-folder-ui';
import MailAccountDialog from './MailAccountDialog.vue';
import MailComposerDialog from './MailComposerDialog.vue';
import MailMoveFolderPopover from './MailMoveFolderPopover.vue';
import MailProviderIcon from './MailProviderIcon.vue';

const mail = useMailStore();
const plans = usePlanStore();
const workspace = useWorkspaceStore();

const searchInput = ref('');
const allowRemoteImages = ref(false);
const actionFeedback = ref('');
const actionError = ref('');
const busyAction = ref('');
const armedDeleteId = ref('');
let armedDeleteTimer: ReturnType<typeof setTimeout> | undefined;

const movePopover = ref<{
  messageId: string;
  accountId: string;
  currentFolderId: string;
  anchorRect: DOMRect;
  triggerEl: HTMLElement | null;
} | null>(null);

const movePopoverFolders = computed(() =>
  movePopover.value ? (mail.foldersByAccount.get(movePopover.value.accountId) ?? []) : [],
);

const accountMeta = computed(() => buildAccountDisplayMeta(mail.accounts));
const accountById = computed(() => new Map(mail.accounts.map((acc) => [acc.id, acc])));
const folderById = computed(() => new Map(mail.folders.map((folder) => [folder.id, folder])));

const visibleDrafts = computed(() => {
  const needle = searchInput.value.trim().toLowerCase();
  if (!needle) return mail.drafts;
  return mail.drafts.filter(
    (d) =>
      d.subject.toLowerCase().includes(needle) ||
      d.to.join(' ').toLowerCase().includes(needle) ||
      d.markdownBody.toLowerCase().includes(needle),
  );
});

const listContextTitle = computed(() => {
  if (mail.isUnifiedInbox) return t('所有收件箱');
  if (mail.isLocalDrafts) return t('本机草稿');
  if (!mail.selectedFolder) return '';
  return folderDisplayTitle(mail.selectedFolder);
});

const listContextAccount = computed(() => {
  if (!mail.selectedFolder) return undefined;
  return accountById.value.get(mail.selectedFolder.accountId);
});

const showListContextBar = computed(
  () => mail.isUnifiedInbox || mail.isLocalDrafts || (mail.accounts.length > 1 && !!mail.selectedFolder),
);

function clearArmedDelete() {
  clearTimeout(armedDeleteTimer);
  armedDeleteTimer = undefined;
  armedDeleteId.value = '';
}

function isPermanentDeleteFolder(folderId: string): boolean {
  const special = folderById.value.get(folderId)?.specialUse;
  return special === 'trash' || special === 'junk';
}

onMounted(() => {
  void mail.init();
});

watch(
  () => mail.selectedMessageId,
  (nextId) => {
    allowRemoteImages.value = false;
    clearArmedDelete();
    if (nextId) {
      actionFeedback.value = '';
      actionError.value = '';
    }
  },
);

watch(
  () => mail.selectedFolderId,
  () => {
    movePopover.value = null;
    clearArmedDelete();
  },
);

// Success notices are transient; errors stay until dismissed or replaced.
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
watch(actionFeedback, (msg) => {
  clearTimeout(feedbackTimer);
  if (msg) feedbackTimer = setTimeout(() => (actionFeedback.value = ''), 4000);
});

const filters: { id: MailFilter; label: string }[] = [
  { id: 'all', label: t('全部') },
  { id: 'unread', label: t('未读') },
  { id: 'flagged', label: t('星标') },
  { id: 'calendar', label: t('日程') },
  { id: 'attachments', label: t('附件') },
];

const detail = computed(() => mail.currentDetail);
const currentAccount = computed(() =>
  mail.accounts.find((a) => a.id === detail.value?.summary.accountId),
);

const sandboxSrcdoc = computed(() =>
  detail.value?.htmlSanitized
    ? buildSandboxedEmailSrcdoc(detail.value.htmlSanitized, allowRemoteImages.value)
    : '',
);

const invitePreviews = computed(() => {
  if (!detail.value) return [];
  const existing = plans.recordsFor('all');
  return detail.value.invites.map((invite) => ({
    invite,
    preview: parseInvitePreview(invite, existing),
  }));
});

const visibleAttachments = computed(() =>
  (detail.value?.attachments ?? []).filter((att) => !att.isInline),
);

function formatDate(ts: number): string {
  if (!ts) return '';
  const date = new Date(ts * 1000);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatFullDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function runAction(name: string, fn: () => Promise<string | void>) {
  busyAction.value = name;
  actionError.value = '';
  actionFeedback.value = '';
  try {
    const msg = await fn();
    if (msg) actionFeedback.value = msg;
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busyAction.value = '';
  }
}

function onSearchSubmit() {
  void mail.search(searchInput.value);
}

function openAccountDialog(presetId = '') {
  mail.accountDialogPreset = presetId;
  mail.accountDialogOpen = true;
}

function clearSearch() {
  searchInput.value = '';
  void mail.search('');
}

function senderLabel(addr: { name: string; address: string } | undefined): string {
  return addr?.name || addr?.address || t('未知发件人');
}

/* ---- Message list: keyboard navigation + hover quick actions ---------- */
const listRef = ref<HTMLElement>();

async function focusMessage(id: string) {
  await nextTick();
  listRef.value
    ?.querySelector<HTMLButtonElement>(`[data-message-id="${CSS.escape(id)}"]`)
    ?.focus({ preventScroll: false });
}

function onListKeydown(event: KeyboardEvent) {
  const keys = ['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End'];
  if (!keys.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  const list = mail.messages;
  if (!list.length) return;
  event.preventDefault();
  const current = list.findIndex((m) => m.id === mail.selectedMessageId);
  let next = current;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = list.length - 1;
  else if (event.key === 'ArrowDown' || event.key === 'j') next = Math.min(list.length - 1, current + 1);
  else next = Math.max(0, current < 0 ? 0 : current - 1);
  const target = list[next];
  if (!target || target.id === mail.selectedMessageId) return;
  void mail.selectMessage(target.id);
  void focusMessage(target.id);
}

function quickArchive(id: string) {
  void runAction('archive', async () => {
    const target = await mail.moveToSpecialFolder(id, 'archive');
    return target ? t('已移至「{0}」', [folderDisplayTitle(target)]) : undefined;
  });
}

function quickTrash(id: string) {
  void runAction('trash', async () => {
    const target = await mail.moveToSpecialFolder(id, 'trash');
    return target ? t('已移至「{0}」', [folderDisplayTitle(target)]) : undefined;
  });
}

function quickDeleteOrTrash(item: MailMessageSummary) {
  if (!isPermanentDeleteFolder(item.folderId)) {
    quickTrash(item.id);
    return;
  }
  if (armedDeleteId.value !== item.id) {
    clearArmedDelete();
    armedDeleteId.value = item.id;
    armedDeleteTimer = setTimeout(() => {
      armedDeleteId.value = '';
    }, 4000);
    return;
  }
  clearArmedDelete();
  void runAction('delete', async () => {
    await mail.deleteMessage(item.id);
    return t('已永久删除该邮件');
  });
}

function deleteTooltipFor(item: MailMessageSummary): string {
  if (!isPermanentDeleteFolder(item.folderId)) return t('移至已删除');
  return armedDeleteId.value === item.id ? t('再次点击确认彻底删除') : t('彻底删除');
}

function removeLocalDraft(draft: MailDraft) {
  void runAction('delete-draft', async () => {
    await mail.deleteDraft(draft.id);
  });
}

function draftAccountMeta(accountId: string) {
  const acc = accountById.value.get(accountId);
  if (!acc) return null;
  return {
    provider: acc.provider,
    tag: accountMeta.value.get(accountId)?.shortTag ?? acc.label ?? acc.email,
  };
}

function openMovePopover(item: MailMessageSummary, event: MouseEvent) {
  const triggerEl = event.currentTarget as HTMLElement | null;
  if (!triggerEl) return;
  if (
    movePopover.value?.messageId === item.id &&
    movePopover.value.triggerEl === triggerEl
  ) {
    movePopover.value = null;
    return;
  }
  movePopover.value = {
    messageId: item.id,
    accountId: item.accountId,
    currentFolderId: item.folderId,
    anchorRect: triggerEl.getBoundingClientRect(),
    triggerEl,
  };
}

function closeMovePopover(restoreFocus = false) {
  const trigger = movePopover.value?.triggerEl;
  movePopover.value = null;
  if (restoreFocus && trigger?.isConnected) {
    trigger.focus({ preventScroll: true });
  }
}

function handleMoveToFolder(targetFolderId: string) {
  const current = movePopover.value;
  if (!current) return;
  const messageId = current.messageId;
  movePopover.value = null;
  void runAction('move', async () => {
    const target = await mail.moveToFolder(messageId, targetFolderId);
    return target ? t('已移至「{0}」', [folderDisplayTitle(target)]) : undefined;
  });
}

function openReply(replyAll: boolean) {
  if (!detail.value || !currentAccount.value) return;
  const sender =
    detail.value.replyTo[0]?.address || detail.value.summary.from[0]?.address || '';
  const selfEmail = currentAccount.value.email.toLowerCase();
  const cc = replyAll
    ? [...detail.value.summary.to, ...detail.value.cc]
        .map((a) => a.address)
        .filter((addr) => addr.toLowerCase() !== selfEmail && addr.toLowerCase() !== sender.toLowerCase())
    : [];
  const subj = detail.value.summary.subject;
  const quoted = (detail.value.textBody || detail.value.summary.snippet)
    .split('\n')
    .slice(0, 40)
    .map((line) => `> ${line}`)
    .join('\n');
  const refs = detail.value.summary.messageId
    ? [...detail.value.references, detail.value.summary.messageId]
    : detail.value.references;
  mail.openComposer({
    accountId: currentAccount.value.id,
    to: sender ? [sender] : [],
    cc,
    subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
    markdownBody: `\n\n---\n${t('原邮件发件人：')}${formatMailAddressList(detail.value.summary.from)}\n\n${quoted}`,
    inReplyTo: detail.value.summary.messageId || null,
    references: refs,
  });
}

function openForward() {
  if (!detail.value || !currentAccount.value) return;
  const subj = detail.value.summary.subject;
  mail.openComposer({
    accountId: currentAccount.value.id,
    subject: /^(fwd|fw):/i.test(subj) ? subj : `Fwd: ${subj}`,
    markdownBody: [
      '',
      `---------- ${t('转发的邮件')} ----------`,
      `${t('发件人：')}${formatMailAddressList(detail.value.summary.from)}`,
      `${t('时间：')}${formatFullDate(detail.value.summary.dateTs)}`,
      `${t('主题：')}${subj}`,
      '',
      detail.value.textBody || detail.value.summary.snippet,
    ].join('\n'),
  });
}

async function importInvite(invite: MailCalendarInvite, scope: 'personal' | 'workspace') {
  if (!detail.value) return;
  await runAction(`import-${invite.id}`, async () => {
    const draft = buildEventDraftFromInvite(invite, detail.value!, plans.recordsFor('all'));
    const created = await plans.create(
      draft,
      scope,
      scope === 'workspace' ? workspace.workspace?.id : undefined,
    );
    await mail.markInviteState(invite.id, created.object.id, undefined);
    return scope === 'workspace' ? t('已加入当前工作区日历。') : t('已加入个人日历。');
  });
}

async function respondInvite(invite: MailCalendarInvite, status: RsvpResponseStatus) {
  if (!detail.value || !currentAccount.value) return;
  await runAction(`rsvp-${invite.id}`, async () => {
    const preview = parseInvitePreview(invite, plans.recordsFor('all'));
    const organizer = preview.organizerEmail || detail.value!.summary.from[0]?.address;
    if (!organizer) throw new Error(t('无法识别会议组织者邮箱，无法发送回执'));
    const replyIcs = buildRsvpReplyIcs(
      invite.rawIcs,
      currentAccount.value!.email,
      currentAccount.value!.displayName || currentAccount.value!.email,
      status,
    );
    const labelMap: Record<RsvpResponseStatus, string> = {
      ACCEPTED: t('已接受'),
      TENTATIVE: t('暂定'),
      DECLINED: t('已拒绝'),
    };
    await mail.sendMail({
      accountId: currentAccount.value!.id,
      to: [organizer],
      subject: `${labelMap[status]}: ${preview.summary}`,
      textBody: `${currentAccount.value!.displayName || currentAccount.value!.email} ${labelMap[status]}了日程邀请「${preview.summary}」。`,
      calendarIcs: replyIcs,
      calendarMethod: 'REPLY',
      inReplyTo: detail.value!.summary.messageId || undefined,
    });
    let importedId = invite.importedObjectId;
    if (status !== 'DECLINED' && !importedId) {
      const targetScope = plans.workspaceWritable ? 'workspace' : 'personal';
      const draft = buildEventDraftFromInvite(invite, detail.value!, plans.recordsFor('all'));
      const created = await plans.create(
        draft,
        targetScope,
        targetScope === 'workspace' ? workspace.workspace?.id : undefined,
      );
      importedId = created.object.id;
    }
    await mail.markInviteState(invite.id, importedId, status);
    return t('已通过本人邮箱向组织者发送「{0}」回执。', [labelMap[status]]);
  });
}

async function addEmailToPlans(mode: 'calendar' | 'todo') {
  if (!detail.value) return;
  await runAction(`plan-${mode}`, async () => {
    const scope = plans.workspaceWritable ? 'workspace' : 'personal';
    const draft = buildPlanDraftFromEmail(detail.value!, mode);
    await plans.create(draft, scope, scope === 'workspace' ? workspace.workspace?.id : undefined);
    return mode === 'todo' ? t('已转为待办事项。') : t('已加入日历日程。');
  });
}

async function saveEmailAsMarkdown() {
  if (!detail.value) return;
  if (!workspace.workspace || workspace.workspace.readOnly) {
    actionError.value = t('请先打开一个可写的工作区，再将邮件存为 Markdown 文档。');
    return;
  }
  await runAction('save-md', async () => {
    const path = safeMailDocumentPath(detail.value!);
    const content = emailToMarkdownDocument(detail.value!);
    await workspace.create(path, false, content, workspace.workspace!.id);
    return t('已存为工作区文档：{0}', [path]);
  });
}

async function downloadAttachment(att: MailAttachmentInfo) {
  await runAction(`att-${att.id}`, async () => {
    const data = await mail.downloadAttachment(att.id);
    const binary = atob(data.bytesBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: data.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = data.filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return t('已下载附件：{0}', [data.filename]);
  });
}
</script>

<template>
  <div class="mail-workspace">
    <div v-if="!mail.available" class="mail-hero">
      <span class="mail-hero-icon"><Mail :size="26" /></span>
      <h2>{{ t('原生邮箱直连仅支持桌面端') }}</h2>
      <p>{{ t('为了保护你的邮箱凭据与邮件隐私，Tano 仅在桌面客户端通过本机加密直连 IMAP/SMTP，不在云端代管邮箱。') }}</p>
    </div>

    <div v-else-if="!mail.accounts.length" class="mail-welcome">
      <header class="mail-welcome-head">
        <span class="mail-hero-icon"><Mail :size="24" /></span>
        <h2>{{ t('连接你的个人邮箱') }}</h2>
        <p>{{ t('在 Tano 中收发邮件、回复日程邀请，并把邮件一键存为 Markdown 文档。') }}</p>
      </header>

      <section class="mail-welcome-providers" :aria-label="t('选择邮箱服务商')">
        <h3>{{ t('选择邮箱服务商') }}</h3>
        <div v-if="mail.presets.length" class="mail-provider-grid">
          <button
            v-for="(preset, index) in mail.presets"
            :key="preset.id"
            type="button"
            class="mail-provider"
            :style="{ '--i': index }"
            @click="openAccountDialog(preset.id)"
          >
            <MailProviderIcon :provider="preset.id" />
            <span class="mail-provider-name">{{ preset.name }}</span>
            <ChevronRight :size="15" class="mail-provider-chevron" />
          </button>
        </div>
        <button
          v-else
          type="button"
          class="mail-btn-primary mail-btn-lg"
          @click="openAccountDialog()"
        >
          <Plus :size="16" /> {{ t('添加邮箱账号') }}
        </button>
      </section>

      <p class="mail-welcome-note">
        <ShieldCheck :size="13" />
        <span>{{ t('由桌面端直连邮箱服务器，授权码仅存系统凭据库，不经过 Tano 云端。') }}</span>
      </p>
    </div>

    <div v-else class="mail-split">
      <!-- Message list pane -->
      <aside class="mail-list-pane">
        <header class="mail-list-header">
          <form class="mail-search-box" role="search" @submit.prevent="onSearchSubmit">
            <Search :size="14" />
            <input
              v-model="searchInput"
              type="text"
              :aria-label="mail.isUnifiedInbox ? t('搜索所有邮箱…') : t('搜索主题、发件人或正文…')"
              :placeholder="mail.isUnifiedInbox ? t('搜索所有邮箱…') : t('搜索主题、发件人或正文…')"
              @input="!searchInput && mail.search('')"
              @keydown.esc="clearSearch"
            />
            <button
              v-if="searchInput"
              type="button"
              class="mail-search-clear"
              :aria-label="t('关闭')"
              @click="clearSearch"
            >
              <X :size="13" />
            </button>
          </form>
          <button
            type="button"
            class="icon-button"
            :aria-label="mail.isUnifiedInbox ? t('同步全部邮箱') : t('同步当前文件夹')"
            :data-tooltip="mail.isUnifiedInbox ? t('同步全部邮箱') : t('同步当前文件夹')"
            :disabled="mail.isSelectedFolderSyncing || !mail.selectedFolderId"
            @click="mail.syncSelectedFolder()"
          >
            <RefreshCw :size="15" :class="{ spinning: mail.isSelectedFolderSyncing }" />
          </button>
        </header>

        <div v-if="showListContextBar" class="mail-list-context">
          <MailProviderIcon
            v-if="listContextAccount"
            :provider="listContextAccount.provider"
            size="xs"
          />
          <span class="mail-list-context-title">
            <template v-if="listContextAccount">
              {{ accountMeta.get(listContextAccount.id)?.shortTag ?? listContextAccount.label }} ·
            </template>
            {{ listContextTitle }}
          </span>
        </div>

        <div v-if="!mail.isLocalDrafts" class="mail-filter-bar" role="toolbar">
          <button
            v-for="item in filters"
            :key="item.id"
            type="button"
            class="mail-filter-pill"
            :class="{ active: mail.filter === item.id }"
            :aria-pressed="mail.filter === item.id"
            @click="mail.setFilter(item.id)"
          >
            {{ item.label }}
          </button>
        </div>

        <p v-if="mail.error" class="mail-alert error mail-list-alert">
          <AlertTriangle :size="14" /> <span>{{ mail.error }}</span>
        </p>
        <p v-else-if="!detail && actionError" class="mail-alert error mail-list-alert" role="alert">
          <AlertTriangle :size="14" />
          <span>{{ actionError }}</span>
          <button type="button" class="mail-alert-close" :aria-label="t('关闭')" @click="actionError = ''">
            <X :size="13" />
          </button>
        </p>
        <p v-else-if="!detail && actionFeedback" class="mail-alert ok mail-list-alert" role="status">
          <Check :size="14" /> <span>{{ actionFeedback }}</span>
        </p>

        <!-- Local drafts list -->
        <ul v-if="mail.isLocalDrafts" class="mail-message-list">
          <li v-if="!visibleDrafts.length" class="mail-list-empty">
            <FilePenLine :size="20" />
            <span>{{ t('当前暂无本机草稿') }}</span>
          </li>
          <li
            v-for="draft in visibleDrafts"
            :key="draft.id"
            class="mail-message-row"
          >
            <button
              type="button"
              class="mail-message-item mail-draft-item"
              @click="mail.openDraftInComposer(draft)"
            >
              <span class="mail-draft-icon" aria-hidden="true">
                <FilePenLine :size="15" />
              </span>
              <span class="mail-item-main">
                <span class="mail-item-top">
                  <span class="mail-item-sender">
                    {{ draft.to.length ? draft.to.join(', ') : t('未填写收件人') }}
                  </span>
                  <time class="mail-item-date">{{ formatDate(draft.updatedAt) }}</time>
                </span>
                <span class="mail-item-subject">{{ draft.subject || t('（无主题）') }}</span>
                <span class="mail-item-bottom">
                  <span class="mail-item-snippet">{{ draft.markdownBody.trim() }}</span>
                  <span
                    v-if="mail.accounts.length > 1 && draftAccountMeta(draft.accountId)"
                    class="mail-item-account-tag"
                  >
                    <MailProviderIcon
                      :provider="draftAccountMeta(draft.accountId)!.provider"
                      size="xs"
                    />
                    <span>{{ draftAccountMeta(draft.accountId)!.tag }}</span>
                  </span>
                </span>
              </span>
            </button>
            <span class="mail-row-actions">
              <button
                type="button"
                class="mail-row-action danger"
                :aria-label="t('删除草稿')"
                :data-tooltip="t('删除草稿')"
                @click.stop="removeLocalDraft(draft)"
              >
                <Trash2 :size="14" />
              </button>
            </span>
          </li>
        </ul>

        <!-- Remote folder / Unified Inbox message list -->
        <ul v-else ref="listRef" class="mail-message-list" @keydown="onListKeydown">
          <li v-if="!mail.messages.length" class="mail-list-empty">
            <RefreshCw
              v-if="mail.isSelectedFolderSyncing && !mail.searchQuery"
              :size="20"
              class="spinning"
            />
            <Search v-else-if="mail.searchQuery" :size="20" />
            <Mail v-else :size="20" />
            <span>
              {{
                mail.isSelectedFolderSyncing && !mail.searchQuery
                  ? t('正在同步此文件夹…')
                  : mail.searchQuery
                    ? t('没有匹配的本地缓存邮件')
                    : t('当前文件夹暂无邮件，点击右上角刷新同步')
              }}
            </span>
          </li>
          <li
            v-for="item in mail.messages"
            :key="item.id"
            class="mail-message-row"
            :class="{
              active: mail.selectedMessageId === item.id,
              unread: !item.seen,
              'menu-open': movePopover?.messageId === item.id || armedDeleteId === item.id,
            }"
          >
            <button
              type="button"
              class="mail-message-item"
              :data-message-id="item.id"
              :aria-current="mail.selectedMessageId === item.id ? 'true' : undefined"
              @click="mail.selectMessage(item.id)"
            >
              <span v-if="!item.seen" class="mail-unread-dot" aria-hidden="true" />
              <span
                class="mail-avatar"
                :style="{ '--avatar-hue': avatarHue(item.from[0]) }"
                aria-hidden="true"
              >{{ senderInitial(item.from[0]) }}</span>
              <span class="mail-item-main">
                <span class="mail-item-top">
                  <span class="mail-item-sender">{{ senderLabel(item.from[0]) }}</span>
                  <time class="mail-item-date">{{ formatDate(item.dateTs) }}</time>
                </span>
                <span class="mail-item-subject">{{ item.subject || t('（无主题）') }}</span>
                <span class="mail-item-bottom">
                  <span class="mail-item-snippet">{{ item.snippet }}</span>
                  <span class="mail-item-icons">
                    <span
                      v-if="mail.isUnifiedInbox && mail.accounts.length > 1 && draftAccountMeta(item.accountId)"
                      class="mail-item-account-tag"
                      :title="accountById.get(item.accountId)?.email"
                    >
                      <MailProviderIcon
                        :provider="draftAccountMeta(item.accountId)!.provider"
                        size="xs"
                      />
                      <span>{{ draftAccountMeta(item.accountId)!.tag }}</span>
                    </span>
                    <Star v-if="item.flagged" :size="12" class="mail-icon-star" />
                    <CalendarDays v-if="item.hasIcs" :size="12" />
                    <Paperclip v-if="item.hasAttachments" :size="12" />
                  </span>
                </span>
              </span>
            </button>
            <!-- Hover / focus quick actions, siblings of the row button. -->
            <span class="mail-row-actions">
              <button
                type="button"
                class="mail-row-action"
                :aria-label="item.seen ? t('标为未读') : t('标为已读')"
                :data-tooltip="item.seen ? t('标为未读') : t('标为已读')"
                @click.stop="mail.toggleSeen(item.id, !item.seen)"
              >
                <MailOpen v-if="!item.seen" :size="14" />
                <Mail v-else :size="14" />
              </button>
              <button
                type="button"
                class="mail-row-action"
                :class="{ on: item.flagged }"
                :aria-label="item.flagged ? t('取消星标') : t('加星标')"
                :data-tooltip="item.flagged ? t('取消星标') : t('加星标')"
                @click.stop="mail.toggleFlagged(item.id, !item.flagged)"
              >
                <Star :size="14" />
              </button>
              <button
                type="button"
                class="mail-row-action"
                :aria-label="t('移动到文件夹')"
                :data-tooltip="t('移动到文件夹')"
                :aria-expanded="movePopover?.messageId === item.id"
                aria-haspopup="dialog"
                @click.stop="openMovePopover(item, $event)"
              >
                <FolderInput :size="14" />
              </button>
              <button
                type="button"
                class="mail-row-action"
                :aria-label="t('归档')"
                :data-tooltip="t('归档')"
                @click.stop="quickArchive(item.id)"
              >
                <Archive :size="14" />
              </button>
              <button
                type="button"
                class="mail-row-action danger"
                :class="{ armed: armedDeleteId === item.id }"
                :aria-label="deleteTooltipFor(item)"
                :data-tooltip="deleteTooltipFor(item)"
                @click.stop="quickDeleteOrTrash(item)"
              >
                <Trash2 :size="14" />
              </button>
            </span>
          </li>
        </ul>
      </aside>

      <!-- Reader pane -->
      <main class="mail-reader-pane">
        <div v-if="mail.loadingMessage" class="mail-reader-loading" aria-busy="true">
          <span class="mail-skeleton w40" />
          <span class="mail-skeleton w70 tall" />
          <span class="mail-skeleton w30" />
          <span class="mail-skeleton block" />
          <span class="mail-sr-only">{{ t('正在从邮箱加载正文…') }}</span>
        </div>
        <div v-else-if="mail.isLocalDrafts" class="mail-reader-empty">
          <span class="mail-hero-icon small"><FilePenLine :size="22" /></span>
          <p>{{ t('点击左侧本机草稿继续编辑，或点击「写邮件」新建邮件。') }}</p>
          <button
            type="button"
            class="mail-btn-secondary mail-btn-sm mail-reader-cta"
            @click="mail.openComposer()"
          >
            <PenSquare :size="14" /> {{ t('写邮件') }}
          </button>
        </div>
        <div v-else-if="!detail" class="mail-reader-empty">
          <span class="mail-hero-icon small"><MailOpen :size="22" /></span>
          <p>{{ t('选择左侧一封邮件开始阅读，或点击「写邮件」发起新对话。') }}</p>
        </div>
        <article v-else :key="detail.summary.id" class="mail-reader-article">
          <!-- Actions scoped to this message, on the message's own header row. -->
          <div class="mail-reader-toolbar" role="toolbar">
            <div class="mail-toolbar-group">
              <button type="button" class="icon-button" :aria-label="t('回复')" :data-tooltip="t('回复')" @click="openReply(false)">
                <Reply :size="16" />
              </button>
              <button type="button" class="icon-button" :aria-label="t('全部回复')" :data-tooltip="t('全部回复')" @click="openReply(true)">
                <ReplyAll :size="16" />
              </button>
              <button type="button" class="icon-button" :aria-label="t('转发')" :data-tooltip="t('转发')" @click="openForward">
                <Forward :size="16" />
              </button>
            </div>
            <span class="mail-toolbar-divider" aria-hidden="true" />
            <div class="mail-toolbar-group">
              <button
                type="button"
                class="icon-button"
                :aria-label="t('加入日历')"
                :data-tooltip="t('加入日历')"
                :disabled="!!busyAction"
                @click="addEmailToPlans('calendar')"
              >
                <CalendarPlus :size="16" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="t('转为待办')"
                :data-tooltip="t('转为待办')"
                :disabled="!!busyAction"
                @click="addEmailToPlans('todo')"
              >
                <ListTodo :size="16" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="t('存为文档')"
                :data-tooltip="t('存为文档')"
                :disabled="!!busyAction"
                @click="saveEmailAsMarkdown"
              >
                <FilePlus2 :size="16" />
              </button>
            </div>
            <div class="mail-toolbar-group end">
              <button
                type="button"
                class="icon-button"
                :class="{ 'is-on': detail.summary.flagged }"
                :aria-pressed="detail.summary.flagged"
                :aria-label="detail.summary.flagged ? t('取消星标') : t('加星标')"
                :data-tooltip="detail.summary.flagged ? t('取消星标') : t('加星标')"
                @click="mail.toggleFlagged(detail.summary.id, !detail.summary.flagged)"
              >
                <Star :size="16" :class="{ 'mail-icon-star': detail.summary.flagged }" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="t('标为未读')"
                :data-tooltip="t('标为未读')"
                @click="mail.toggleSeen(detail.summary.id, false)"
              >
                <MailOpen :size="16" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="t('移动到文件夹')"
                :data-tooltip="t('移动到文件夹')"
                :aria-expanded="movePopover?.messageId === detail.summary.id"
                aria-haspopup="dialog"
                :disabled="!!busyAction"
                @click="openMovePopover(detail.summary, $event)"
              >
                <FolderInput :size="16" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="t('归档')"
                :data-tooltip="t('归档')"
                :disabled="!!busyAction"
                @click="quickArchive(detail!.summary.id)"
              >
                <Archive :size="16" />
              </button>
              <button
                type="button"
                class="icon-button danger"
                :class="{ armed: armedDeleteId === detail.summary.id }"
                :aria-label="deleteTooltipFor(detail.summary)"
                :data-tooltip="deleteTooltipFor(detail.summary)"
                :disabled="!!busyAction"
                @click="quickDeleteOrTrash(detail!.summary)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </div>

          <div class="mail-reader-scroll">
            <header class="mail-reader-header">
              <h1 class="mail-reader-subject">{{ detail.summary.subject || t('（无主题）') }}</h1>
              <div class="mail-reader-sender">
                <span
                  class="mail-avatar lg"
                  :style="{ '--avatar-hue': avatarHue(detail.summary.from[0]) }"
                  aria-hidden="true"
                >{{ senderInitial(detail.summary.from[0]) }}</span>
                <div class="mail-reader-sender-text">
                  <div class="mail-reader-sender-line">
                    <strong>{{ senderLabel(detail.summary.from[0]) }}</strong>
                    <span v-if="detail.summary.from[0]?.name" class="mail-reader-address">
                      {{ detail.summary.from[0]?.address }}
                    </span>
                    <time class="mail-reader-time">{{ formatFullDate(detail.summary.dateTs) }}</time>
                  </div>
                  <div class="mail-reader-recipients">
                    <span>{{ t('收件人：') }}{{ formatMailAddressList(detail.summary.to) || t('未知') }}</span>
                    <span v-if="detail.cc.length">{{ t('抄送：') }}{{ formatMailAddressList(detail.cc) }}</span>
                  </div>
                </div>
              </div>

              <Transition name="mail-notice">
                <p v-if="actionError" key="err" class="mail-alert error" role="alert">
                  <AlertTriangle :size="14" />
                  <span>{{ actionError }}</span>
                  <button type="button" class="mail-alert-close" :aria-label="t('关闭')" @click="actionError = ''">
                    <X :size="13" />
                  </button>
                </p>
                <p v-else-if="actionFeedback" key="ok" class="mail-alert success" role="status">
                  <Check :size="14" /> <span>{{ actionFeedback }}</span>
                </p>
              </Transition>
            </header>

            <!-- Calendar invitation cards (.ics) -->
            <section v-if="invitePreviews.length" class="mail-invites-section">
              <div
                v-for="{ invite, preview } in invitePreviews"
                :key="invite.id"
                class="mail-invite-card"
              >
                <span class="mail-invite-date" aria-hidden="true">
                  <template v-if="preview.start">
                    <small>{{ new Date(preview.start).toLocaleDateString('zh-CN', { month: 'short' }) }}</small>
                    <b>{{ new Date(preview.start).getDate() }}</b>
                  </template>
                  <CalendarDays v-else :size="18" />
                </span>
                <div class="mail-invite-info">
                  <strong>{{ preview.summary }}</strong>
                  <span v-if="preview.start" class="mail-invite-time">
                    {{ new Date(preview.start).toLocaleString('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }}
                    <template v-if="preview.end">
                      – {{ new Date(preview.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
                    </template>
                  </span>
                  <span v-if="preview.conflicts.length" class="mail-conflict-tag">
                    <AlertTriangle :size="12" />
                    {{ t('与现有 {0} 个日程时间重叠', [preview.conflicts.length]) }}
                  </span>
                </div>
                <div class="mail-invite-actions">
                  <template v-if="invite.method === 'REQUEST'">
                    <div class="mail-rsvp" role="group">
                      <button
                        type="button"
                        :class="{ selected: invite.rsvpStatus === 'ACCEPTED' }"
                        :disabled="!!busyAction"
                        @click="respondInvite(invite, 'ACCEPTED')"
                      >
                        {{ invite.rsvpStatus === 'ACCEPTED' ? t('已接受') : t('接受') }}
                      </button>
                      <button
                        type="button"
                        :class="{ selected: invite.rsvpStatus === 'TENTATIVE' }"
                        :disabled="!!busyAction"
                        @click="respondInvite(invite, 'TENTATIVE')"
                      >
                        {{ t('暂定') }}
                      </button>
                      <button
                        type="button"
                        class="decline"
                        :class="{ selected: invite.rsvpStatus === 'DECLINED' }"
                        :disabled="!!busyAction"
                        @click="respondInvite(invite, 'DECLINED')"
                      >
                        {{ t('拒绝') }}
                      </button>
                    </div>
                  </template>
                  <button
                    type="button"
                    class="mail-btn-secondary mail-btn-sm"
                    :disabled="!!busyAction || !!invite.importedObjectId"
                    @click="importInvite(invite, 'personal')"
                  >
                    <Check v-if="invite.importedObjectId" :size="13" />
                    {{ invite.importedObjectId ? t('已加入日历') : t('加入个人日历') }}
                  </button>
                  <button
                    v-if="plans.workspaceWritable && !invite.importedObjectId"
                    type="button"
                    class="mail-btn-ghost mail-btn-sm"
                    :disabled="!!busyAction"
                    @click="importInvite(invite, 'workspace')"
                  >
                    {{ t('加入工作区日历') }}
                  </button>
                </div>
              </div>
            </section>

            <!-- Privacy shield for remote images -->
            <div
              v-if="detail.hasRemoteImages && !allowRemoteImages"
              class="mail-remote-banner"
            >
              <ImageIcon :size="14" />
              <span>{{ t('为防止打开追踪，已默认拦截此邮件中的外部远程图片。') }}</span>
              <button type="button" class="mail-link-btn" @click="allowRemoteImages = true">
                {{ t('加载外部图片') }}
              </button>
            </div>

            <!-- Sandboxed HTML or plain text body -->
            <div class="mail-body-wrap">
              <iframe
                v-if="sandboxSrcdoc"
                class="mail-body-iframe"
                :title="detail.summary.subject || t('邮件正文')"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerpolicy="no-referrer"
                :srcdoc="sandboxSrcdoc"
              />
              <pre v-else class="mail-body-plain">{{ detail.textBody || detail.summary.snippet }}</pre>
            </div>

            <!-- Attachments -->
            <section v-if="visibleAttachments.length" class="mail-attachments-bar">
              <h3><Paperclip :size="13" /> {{ t('附件（{0}）', [visibleAttachments.length]) }}</h3>
              <div class="mail-attachments-list">
                <button
                  v-for="att in visibleAttachments"
                  :key="att.id"
                  type="button"
                  class="mail-attachment-card"
                  :disabled="!!busyAction"
                  :title="att.filename"
                  @click="downloadAttachment(att)"
                >
                  <span class="mail-attachment-icon"><FileText :size="16" /></span>
                  <span class="mail-attachment-text">
                    <span class="mail-attachment-name">{{ att.filename }}</span>
                    <small>{{ formatSize(att.sizeBytes) }}</small>
                  </span>
                  <Download :size="14" class="mail-attachment-dl" />
                </button>
              </div>
            </section>
          </div>
        </article>
      </main>
    </div>

    <MailAccountDialog />
    <MailComposerDialog />
    <MailMoveFolderPopover
      :open="!!movePopover"
      :anchor-rect="movePopover?.anchorRect ?? null"
      :folders="movePopoverFolders"
      :current-folder-id="movePopover?.currentFolderId ?? ''"
      :busy="!!busyAction"
      @select="handleMoveToFolder"
      @close="closeMovePopover"
    />
  </div>
</template>
