<script setup lang="ts">
import { onMounted } from 'vue';
import {
  Archive,
  FileText,
  Folder,
  Inbox,
  PenSquare,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Star,
  Trash2,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useMailStore } from '../../stores/mail';

const emit = defineEmits<{ openMail: [] }>();
const mail = useMailStore();

onMounted(() => {
  void mail.init();
});

function folderIcon(specialUse: string | null) {
  switch (specialUse) {
    case 'inbox':
      return Inbox;
    case 'sent':
      return Send;
    case 'drafts':
      return FileText;
    case 'trash':
      return Trash2;
    case 'archive':
      return Archive;
    case 'flagged':
      return Star;
    default:
      return Folder;
  }
}

async function pickFolder(folderId: string) {
  emit('openMail');
  await mail.selectFolder(folderId);
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
      <section v-for="account in mail.accounts" :key="account.id" class="sidebar-mail-account">
        <header class="sidebar-mail-account-head" :title="account.email">
          <span class="sidebar-mail-account-name">{{ account.label || account.email }}</span>
          <button
            type="button"
            class="icon-button sidebar-mail-sync"
            :class="{ busy: mail.syncingAccountId === account.id }"
            :aria-label="t('同步此邮箱')"
            :data-tooltip="t('同步此邮箱')"
            :disabled="mail.syncingAccountId === account.id"
            @click="mail.syncAccount(account.id)"
          >
            <RefreshCw :size="13" :class="{ spinning: mail.syncingAccountId === account.id }" />
          </button>
        </header>

        <ul class="sidebar-mail-folder-list">
          <li
            v-for="folder in mail.foldersByAccount.get(account.id) ?? []"
            :key="folder.id"
          >
            <button
              type="button"
              class="sidebar-mail-row sidebar-mail-folder"
              :class="{ active: mail.selectedFolderId === folder.id, unread: folder.unreadCount > 0 }"
              :aria-current="mail.selectedFolderId === folder.id ? 'page' : undefined"
              @click="pickFolder(folder.id)"
            >
              <component :is="folderIcon(folder.specialUse)" :size="15" />
              <span class="sidebar-mail-folder-name">{{ folder.displayName }}</span>
              <span v-if="folder.unreadCount > 0" class="sidebar-mail-count">
                {{ folder.unreadCount > 999 ? '999+' : folder.unreadCount }}
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
