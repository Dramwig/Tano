<script setup lang="ts">
import '../../styles/mail.css';
import { computed, onMounted, reactive, watch } from 'vue';
import {
  ChevronRight,
  FilePenLine,
  Folder,
  Inbox,
  PenSquare,
  Plus,
  RefreshCw,
  Settings2,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useMailStore } from '../../stores/mail';
import {
  ancestorKeysForFolder,
  buildAccountDisplayMeta,
  buildAccountFolderTree,
  flattenVisibleNodes,
  type AccountFolderTree,
  type MailFolderTreeNode,
} from '../mail-folders';
import { folderIcon, localizedFolderLabel } from '../mail-folder-ui';
import MailProviderIcon from './MailProviderIcon.vue';

const emit = defineEmits<{ openMail: [] }>();
const mail = useMailStore();

/** Per-account user expand/collapse overrides keyed by `${accountId}::${nodeKey}`. */
const expandedOverrides = reactive(new Map<string, boolean>());
/** Account IDs manually collapsed by the user. */
const collapsedAccounts = reactive(new Set<string>());

onMounted(() => {
  void mail.init();
});

const accountMeta = computed(() => buildAccountDisplayMeta(mail.accounts));

const treesByAccount = computed(() => {
  const map = new Map<string, AccountFolderTree>();
  for (const account of mail.accounts) {
    map.set(account.id, buildAccountFolderTree(mail.foldersByAccount.get(account.id) ?? []));
  }
  return map;
});

const showQuickSection = computed(() => mail.accounts.length > 1 || mail.drafts.length > 0);

function expandKey(accountId: string, nodeKey: string): string {
  return `${accountId}::${nodeKey}`;
}

function isNodeExpanded(accountId: string, node: MailFolderTreeNode): boolean {
  const key = expandKey(accountId, node.key);
  return expandedOverrides.has(key) ? expandedOverrides.get(key)! : node.defaultExpanded;
}

function toggleNode(accountId: string, node: MailFolderTreeNode) {
  const key = expandKey(accountId, node.key);
  expandedOverrides.set(key, !isNodeExpanded(accountId, node));
}

function isAccountCollapsed(accountId: string): boolean {
  return collapsedAccounts.has(accountId);
}

function toggleAccount(accountId: string) {
  if (collapsedAccounts.has(accountId)) {
    collapsedAccounts.delete(accountId);
  } else {
    collapsedAccounts.add(accountId);
  }
}

function visiblePrimary(accountId: string): MailFolderTreeNode[] {
  const tree = treesByAccount.value.get(accountId);
  if (!tree) return [];
  return flattenVisibleNodes(tree.primary, (node) => isNodeExpanded(accountId, node));
}

function visibleSecondary(accountId: string): MailFolderTreeNode[] {
  const tree = treesByAccount.value.get(accountId);
  if (!tree) return [];
  return flattenVisibleNodes(tree.secondary, (node) => isNodeExpanded(accountId, node));
}

// Auto-expand owning account & ancestors whenever a folder becomes active.
watch(
  [() => mail.selectedFolderId, treesByAccount],
  ([selectedId, trees]) => {
    if (!selectedId) return;
    const activeFolder = mail.folders.find((f) => f.id === selectedId);
    if (activeFolder) {
      collapsedAccounts.delete(activeFolder.accountId);
    }
    for (const [accountId, tree] of trees) {
      const ancestors = ancestorKeysForFolder(tree, selectedId);
      if (ancestors.length) {
        for (const ancestorKey of ancestors) {
          expandedOverrides.set(expandKey(accountId, ancestorKey), true);
        }
        break;
      }
    }
  },
  { immediate: true },
);

function nodeLabel(node: MailFolderTreeNode): string {
  return localizedFolderLabel(node.specialUse, node.label);
}

async function pickFolder(folderId: string) {
  emit('openMail');
  await mail.selectFolder(folderId);
}

async function pickUnifiedInbox() {
  emit('openMail');
  await mail.selectUnifiedInbox();
}

async function pickLocalDrafts() {
  emit('openMail');
  await mail.selectLocalDrafts();
}

function compose() {
  emit('openMail');
  mail.openComposer();
}

function openAccounts() {
  emit('openMail');
  mail.accountDialogOpen = true;
}
</script>

<template>
  <div class="sidebar-mail">
    <!-- View-level actions live on the view's own header row (VSCode-style). -->
    <div class="sidebar-mail-head">
      <button
        v-if="mail.accounts.length"
        type="button"
        class="sidebar-mail-row sidebar-mail-compose"
        @click="compose"
      >
        <PenSquare :size="15" />
        <span>{{ t('写邮件') }}</span>
      </button>
      <span v-else class="sidebar-mail-title">{{ t('邮箱') }}</span>
      <button
        v-if="mail.accounts.length"
        type="button"
        class="icon-button sidebar-mail-head-icon"
        :aria-label="mail.accounts.length > 1 ? t('同步全部邮箱') : t('同步此邮箱')"
        :data-tooltip="mail.accounts.length > 1 ? t('同步全部邮箱') : t('同步此邮箱')"
        :disabled="mail.isSyncingAnyAccount"
        @click="mail.syncAllAccounts()"
      >
        <RefreshCw :size="14" :class="{ spinning: mail.isSyncingAnyAccount }" />
      </button>
      <button
        type="button"
        class="icon-button sidebar-mail-head-icon"
        :aria-label="t('管理邮箱账号')"
        :data-tooltip="t('管理邮箱账号')"
        @click="openAccounts"
      >
        <Settings2 :size="15" />
      </button>
    </div>

    <div v-if="!mail.accounts.length" class="sidebar-mail-empty">
      <button type="button" class="sidebar-mail-row sidebar-mail-connect" @click="openAccounts">
        <Plus :size="15" />
        <span>{{ t('连接第一个邮箱') }}</span>
      </button>
    </div>

    <div v-else class="sidebar-mail-tree">
      <!-- Aggregated views: Unified Inbox (2+ accounts) and Local Drafts (when non-empty). -->
      <ul v-if="showQuickSection" class="sidebar-mail-folder-list sidebar-mail-quick-list">
        <li v-if="mail.accounts.length > 1">
          <button
            type="button"
            class="sidebar-mail-row sidebar-mail-folder"
            :class="{ active: mail.isUnifiedInbox, unread: mail.totalUnread > 0 }"
            :aria-current="mail.isUnifiedInbox ? 'page' : undefined"
            @click="pickUnifiedInbox"
          >
            <Inbox :size="15" />
            <span class="sidebar-mail-folder-name">{{ t('所有收件箱') }}</span>
            <span v-if="mail.totalUnread > 0" class="sidebar-mail-count">
              {{ mail.totalUnread > 999 ? '999+' : mail.totalUnread }}
            </span>
          </button>
        </li>
        <li v-if="mail.drafts.length">
          <button
            type="button"
            class="sidebar-mail-row sidebar-mail-folder"
            :class="{ active: mail.isLocalDrafts }"
            :aria-current="mail.isLocalDrafts ? 'page' : undefined"
            @click="pickLocalDrafts"
          >
            <FilePenLine :size="15" />
            <span class="sidebar-mail-folder-name">{{ t('本机草稿') }}</span>
            <span class="sidebar-mail-count muted">{{ mail.drafts.length }}</span>
          </button>
        </li>
      </ul>

      <section v-for="account in mail.accounts" :key="account.id" class="sidebar-mail-account">
        <header class="sidebar-mail-account-head" :title="account.email">
          <button
            type="button"
            class="sidebar-mail-account-toggle"
            :aria-expanded="!isAccountCollapsed(account.id)"
            @click="toggleAccount(account.id)"
          >
            <MailProviderIcon :provider="account.provider" size="sm" />
            <span class="sidebar-mail-account-text">
              <span class="sidebar-mail-account-name">
                {{ accountMeta.get(account.id)?.title ?? (account.label || account.email) }}
              </span>
              <span
                v-if="accountMeta.get(account.id)?.subtitle"
                class="sidebar-mail-account-email"
                :class="{ highlight: accountMeta.get(account.id)?.duplicateLabel }"
              >
                {{ accountMeta.get(account.id)?.subtitle }}
              </span>
            </span>
            <span
              v-if="isAccountCollapsed(account.id) && mail.accountInboxUnread(account.id) > 0"
              class="sidebar-mail-count"
            >
              {{
                mail.accountInboxUnread(account.id) > 999
                  ? '999+'
                  : mail.accountInboxUnread(account.id)
              }}
            </span>
          </button>
          <button
            type="button"
            class="icon-button sidebar-mail-sync"
            :class="{ busy: mail.isAccountSyncing(account.id) }"
            :aria-label="t('同步此邮箱')"
            :data-tooltip="t('同步此邮箱')"
            :disabled="mail.isAccountSyncing(account.id)"
            @click="mail.syncAccount(account.id)"
          >
            <RefreshCw :size="13" :class="{ spinning: mail.isAccountSyncing(account.id) }" />
          </button>
        </header>

        <div v-show="!isAccountCollapsed(account.id)" class="sidebar-mail-account-body">
          <template
            v-for="(sectionRows, sectionIdx) in [visiblePrimary(account.id), visibleSecondary(account.id)]"
            :key="sectionIdx"
          >
            <div
              v-if="sectionIdx === 1 && visiblePrimary(account.id).length && sectionRows.length"
              class="sidebar-mail-divider"
              role="separator"
            />
            <ul v-if="sectionRows.length" class="sidebar-mail-folder-list">
              <li
                v-for="node in sectionRows"
                :key="node.key"
                :style="{ '--depth': node.depth }"
              >
                <!-- Virtual container (e.g. \Noselect parent like QQ 其他文件夹): whole row toggles. -->
                <button
                  v-if="!node.folder"
                  type="button"
                  class="sidebar-mail-folder-row sidebar-mail-group"
                  :aria-expanded="isNodeExpanded(account.id, node)"
                  :title="node.fullPath"
                  @click="toggleNode(account.id, node)"
                >
                  <span class="sidebar-mail-folder-main">
                    <Folder :size="15" />
                    <span class="sidebar-mail-folder-name">{{ nodeLabel(node) }}</span>
                  </span>
                  <span
                    class="sidebar-mail-chevron-icon"
                    :class="{ expanded: isNodeExpanded(account.id, node) }"
                    aria-hidden="true"
                  >
                    <ChevronRight :size="12" />
                  </span>
                </button>

                <!-- Selectable IMAP folder (optional trailing chevron when nested children exist). -->
                <div
                  v-else
                  class="sidebar-mail-folder-row"
                  :class="{
                    active: mail.selectedFolderId === node.folder.id,
                    unread: node.folder.unreadCount > 0,
                  }"
                >
                  <button
                    type="button"
                    class="sidebar-mail-folder-main"
                    :aria-current="mail.selectedFolderId === node.folder.id ? 'page' : undefined"
                    :title="node.depth > 0 ? node.fullPath : undefined"
                    @click="pickFolder(node.folder.id)"
                  >
                    <component :is="folderIcon(node.specialUse)" :size="15" />
                    <span class="sidebar-mail-folder-name">{{ nodeLabel(node) }}</span>
                    <RefreshCw
                      v-if="mail.isFolderSyncing(node.folder.id)"
                      :size="12"
                      class="spinning sidebar-mail-folder-spinner"
                      aria-hidden="true"
                    />
                    <span v-else-if="node.folder.unreadCount > 0" class="sidebar-mail-count">
                      {{ node.folder.unreadCount > 999 ? '999+' : node.folder.unreadCount }}
                    </span>
                  </button>
                  <button
                    v-if="node.children.length"
                    type="button"
                    class="sidebar-mail-chevron"
                    :class="{ expanded: isNodeExpanded(account.id, node) }"
                    :aria-expanded="isNodeExpanded(account.id, node)"
                    :aria-label="
                      isNodeExpanded(account.id, node) ? t('折叠子文件夹') : t('展开子文件夹')
                    "
                    @click.stop="toggleNode(account.id, node)"
                  >
                    <ChevronRight :size="12" />
                  </button>
                </div>
              </li>
            </ul>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
