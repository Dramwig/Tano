<script setup lang="ts">
import '../../styles/mail.css';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlertTriangle, Paperclip, Send, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useMailStore } from '../../stores/mail';
import { markdownToEmailHtml } from '../mail-markdown';
import type { MailSendAttachment } from '../types';

const mail = useMailStore();

const accountId = ref('');
const toText = ref('');
const ccText = ref('');
const bccText = ref('');
const showCcBcc = ref(false);
const subject = ref('');
const markdownBody = ref('');
const attachments = ref<MailSendAttachment[]>([]);
const sending = ref(false);
const savingDraft = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement>();

watch(
  () => [mail.composerOpen, mail.composeSeed] as const,
  ([open, seed]) => {
    if (!open) return;
    accountId.value = seed?.accountId || mail.accounts[0]?.id || '';
    toText.value = (seed?.to ?? []).join(', ');
    ccText.value = (seed?.cc ?? []).join(', ');
    bccText.value = '';
    showCcBcc.value = Boolean(seed?.cc?.length);
    subject.value = seed?.subject ?? '';
    markdownBody.value = seed?.markdownBody ?? '';
    attachments.value = [...(seed?.attachments ?? [])];
    error.value = '';
  },
  { immediate: true },
);

function parseAddressInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function onPickFiles(event: Event) {
  await addFiles(Array.from((event.target as HTMLInputElement).files ?? []));
  (event.target as HTMLInputElement).value = '';
}

const dragOver = ref(false);
async function onDrop(event: DragEvent) {
  dragOver.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) await addFiles(files);
}

async function addFiles(files: File[]) {
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      error.value = t('单个附件不能超过 25 MiB：{0}', [file.name]);
      continue;
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    attachments.value.push({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      bytesBase64: btoa(binary),
    });
  }
}

function close() {
  if (sending.value) return;
  mail.closeComposer();
}

function onKeydown(event: KeyboardEvent) {
  if (!mail.composerOpen) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !sending.value) {
    event.preventDefault();
    void send();
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));

// Land the caret where the user would type first: recipients, else the body.
const toInput = ref<HTMLInputElement>();
const bodyInput = ref<HTMLTextAreaElement>();
watch(
  () => mail.composerOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    if (!toText.value) toInput.value?.focus();
    else {
      bodyInput.value?.focus();
      bodyInput.value?.setSelectionRange(0, 0);
    }
  },
  { immediate: true },
);

function formatAttachmentSize(base64: string): string {
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1);
}

async function saveLocalDraft() {
  if (!accountId.value) return;
  savingDraft.value = true;
  error.value = '';
  try {
    await mail.saveDraft({
      id: '',
      accountId: accountId.value,
      to: parseAddressInput(toText.value),
      cc: parseAddressInput(ccText.value),
      bcc: parseAddressInput(bccText.value),
      subject: subject.value,
      markdownBody: markdownBody.value,
      inReplyTo: mail.composeSeed?.inReplyTo ?? null,
      references: mail.composeSeed?.references ?? [],
      updatedAt: 0,
    });
    mail.closeComposer();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    savingDraft.value = false;
  }
}

async function send() {
  if (!accountId.value) {
    error.value = t('请先选择发件邮箱');
    return;
  }
  const to = parseAddressInput(toText.value);
  const cc = parseAddressInput(ccText.value);
  const bcc = parseAddressInput(bccText.value);
  if (!to.length && !cc.length && !bcc.length) {
    error.value = t('请至少填写一位收件人');
    return;
  }
  sending.value = true;
  error.value = '';
  try {
    await mail.sendMail({
      accountId: accountId.value,
      to,
      cc,
      bcc,
      subject: subject.value.trim() || t('（无主题）'),
      textBody: markdownBody.value,
      htmlBody: markdownToEmailHtml(markdownBody.value),
      inReplyTo: mail.composeSeed?.inReplyTo ?? undefined,
      references: mail.composeSeed?.references,
      attachments: attachments.value,
    });
    mail.closeComposer();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Transition name="mail-modal">
    <div
      v-if="mail.composerOpen"
      class="mail-modal-backdrop"
      @mousedown.self="close"
    >
      <section
        class="mail-modal mail-composer-modal"
        :class="{ 'drag-over': dragOver }"
        role="dialog"
        aria-modal="true"
        :aria-label="t('撰写邮件')"
        @dragover.prevent="dragOver = true"
        @dragleave.self="dragOver = false"
        @drop.prevent="onDrop"
      >
        <header class="mail-modal-header compact">
          <h2>{{ subject.trim() || t('撰写邮件') }}</h2>
          <button
            type="button"
            class="icon-button"
            :disabled="sending"
            :aria-label="t('关闭')"
            :data-tooltip="t('关闭')"
            @click="close"
          >
            <X :size="16" />
          </button>
        </header>

        <div class="mail-composer-fields">
          <label v-if="mail.accounts.length > 1" class="mail-composer-row">
            <span>{{ t('发件人') }}</span>
            <select v-model="accountId">
              <option v-for="acc in mail.accounts" :key="acc.id" :value="acc.id">
                {{ acc.label }} &lt;{{ acc.email }}&gt;
              </option>
            </select>
          </label>

          <label class="mail-composer-row">
            <span>{{ t('收件人') }}</span>
            <input
              ref="toInput"
              v-model="toText"
              type="text"
              :placeholder="t('多个地址用逗号分隔，例如 alice@example.com')"
            />
            <button
              v-if="!showCcBcc"
              type="button"
              class="mail-link-btn"
              @click="showCcBcc = true"
            >
              {{ t('抄送/密送') }}
            </button>
          </label>

          <template v-if="showCcBcc">
            <label class="mail-composer-row">
              <span>{{ t('抄送') }}</span>
              <input v-model="ccText" type="text" placeholder="cc@example.com" />
            </label>
            <label class="mail-composer-row">
              <span>{{ t('密送') }}</span>
              <input v-model="bccText" type="text" placeholder="bcc@example.com" />
            </label>
          </template>

          <label class="mail-composer-row">
            <span>{{ t('主题') }}</span>
            <input v-model="subject" type="text" class="mail-composer-subject" :placeholder="t('输入邮件主题')" />
          </label>
        </div>

        <textarea
          ref="bodyInput"
          v-model="markdownBody"
          class="mail-composer-editor"
          :placeholder="t('支持 Markdown 语法，发送时将自动生成纯文本与干净的 HTML 双版本正文…')"
        />

        <TransitionGroup
          v-if="attachments.length"
          tag="div"
          name="mail-chip"
          class="mail-composer-attachments"
        >
          <span v-for="(att, idx) in attachments" :key="`${att.filename}-${idx}`" class="mail-att-chip">
            <Paperclip :size="13" />
            <span class="mail-att-name">{{ att.filename }}</span>
            <small>{{ formatAttachmentSize(att.bytesBase64) }}</small>
            <button type="button" :aria-label="t('移除')" @click="removeAttachment(idx)">
              <X :size="12" />
            </button>
          </span>
        </TransitionGroup>

        <Transition name="mail-notice">
          <p v-if="error" class="mail-alert error mail-composer-error" role="alert">
            <AlertTriangle :size="14" /> <span>{{ error }}</span>
          </p>
        </Transition>

        <footer class="mail-composer-footer">
          <input ref="fileInput" type="file" multiple hidden @change="onPickFiles" />
          <button
            type="button"
            class="icon-button"
            :disabled="sending"
            :aria-label="t('添加附件')"
            :data-tooltip="t('添加附件')"
            @click="fileInput?.click()"
          >
            <Paperclip :size="16" />
          </button>
          <span class="mail-composer-hint">Ctrl + Enter</span>
          <button
            type="button"
            class="mail-btn-ghost"
            :disabled="sending || savingDraft"
            @click="saveLocalDraft"
          >
            {{ t('存为本机草稿') }}
          </button>
          <button
            type="button"
            class="mail-btn-primary"
            :disabled="sending"
            @click="send"
          >
            <span v-if="sending" class="mail-btn-spinner" aria-hidden="true" />
            <Send v-else :size="14" />
            {{ sending ? t('正在发送…') : t('发送邮件') }}
          </button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
