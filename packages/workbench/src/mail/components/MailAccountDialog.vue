<script setup lang="ts">
import '../../styles/mail.css';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useMailStore } from '../../stores/mail';
import type { AppendSentPolicy, MailAccountInput, MailPreset, TlsMode } from '../types';
import MailProviderIcon from './MailProviderIcon.vue';

const mail = useMailStore();

function close() {
  if (testing.value || saving.value) return;
  mail.accountDialogOpen = false;
}

function onKeydown(event: KeyboardEvent) {
  if (!mail.accountDialogOpen || event.key !== 'Escape' || mail.composerOpen) return;
  event.stopPropagation();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));

const selectedPresetId = ref('qq');
const label = ref('QQ 邮箱');
const email = ref('');
const displayName = ref('');
const username = ref('');
const password = ref('');
const imapHost = ref('imap.qq.com');
const imapPort = ref(993);
const imapTls = ref<TlsMode>('tls');
const smtpHost = ref('smtp.qq.com');
const smtpPort = ref(465);
const smtpTls = ref<TlsMode>('tls');
const appendSent = ref<AppendSentPolicy>('never');
const sendImapId = ref(false);

const testing = ref(false);
const saving = ref(false);
const clearingCache = ref(false);
const error = ref('');
const statusMessage = ref('');

/** 'pick' = accounts + provider list, 'form' = credentials for one provider. */
const step = ref<'pick' | 'form'>('pick');
const emailInput = ref<HTMLInputElement>();
const isCustom = computed(() => selectedPresetId.value === 'custom');

async function pickProvider(presetId: string) {
  applyPreset(presetId);
  step.value = 'form';
  await nextTick();
  emailInput.value?.focus();
}

function backToPick() {
  if (testing.value || saving.value) return;
  step.value = 'pick';
  error.value = '';
  statusMessage.value = '';
}

const currentPreset = computed<MailPreset | undefined>(() =>
  mail.presets.find((item) => item.id === selectedPresetId.value),
);

function applyPreset(presetId: string) {
  selectedPresetId.value = presetId;
  const preset = mail.presets.find((item) => item.id === presetId);
  if (!preset) return;
  label.value = preset.name;
  imapHost.value = preset.imapHost;
  imapPort.value = preset.imapPort;
  imapTls.value = preset.imapTls;
  smtpHost.value = preset.smtpHost;
  smtpPort.value = preset.smtpPort;
  smtpTls.value = preset.smtpTls;
  appendSent.value = preset.appendSent;
  sendImapId.value = preset.sendImapId;
  error.value = '';
  statusMessage.value = '';
}

watch(
  () => mail.accountDialogOpen,
  async (open) => {
    if (!open) return;
    await mail.init();
    const requested = mail.accountDialogPreset;
    mail.accountDialogPreset = '';
    error.value = '';
    statusMessage.value = '';
    if (requested && mail.presets.some((item) => item.id === requested)) {
      await pickProvider(requested);
    } else {
      step.value = 'pick';
    }
  },
  { immediate: true },
);

function buildInput(): MailAccountInput {
  return {
    provider: selectedPresetId.value,
    label: label.value.trim(),
    email: email.value.trim(),
    displayName: displayName.value.trim() || email.value.trim(),
    imapHost: imapHost.value.trim(),
    imapPort: Number(imapPort.value),
    imapTls: imapTls.value,
    smtpHost: smtpHost.value.trim(),
    smtpPort: Number(smtpPort.value),
    smtpTls: smtpTls.value,
    appendSent: appendSent.value,
    sendImapId: sendImapId.value,
  };
}

async function testConnection() {
  testing.value = true;
  error.value = '';
  statusMessage.value = '';
  try {
    const res = await mail.testAccount(buildInput(), {
      username: username.value.trim() || email.value.trim(),
      password: password.value,
    });
    statusMessage.value = res.message;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    testing.value = false;
  }
}

async function submitAccount() {
  saving.value = true;
  error.value = '';
  statusMessage.value = '';
  try {
    const saved = await mail.saveAccount(buildInput(), {
      username: username.value.trim() || email.value.trim(),
      password: password.value,
    });
    password.value = '';
    statusMessage.value = t('账号已保存，正在首次同步文件夹与近期邮件…');
    try {
      await mail.syncAccount(saved.id);
      email.value = '';
      displayName.value = '';
      username.value = '';
      step.value = 'pick';
      statusMessage.value = t('账号已连接并完成首次同步。');
    } catch (syncErr) {
      error.value =
        syncErr instanceof Error
          ? `${t('账号已保存，但首次同步失败：')}${syncErr.message}`
          : String(syncErr);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function removeAccount(accountId: string) {
  error.value = '';
  try {
    await mail.removeAccount(accountId);
    statusMessage.value = t('已移除邮箱账号并清理本机凭据与缓存。');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function clearCache() {
  clearingCache.value = true;
  try {
    await mail.clearCache();
    statusMessage.value = t('已清空本地邮件正文与附件缓存。');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    clearingCache.value = false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <Transition name="mail-modal">
    <div
      v-if="mail.accountDialogOpen"
      class="mail-modal-backdrop"
      @mousedown.self="close"
    >
      <section
        class="mail-modal mail-account-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('邮箱账号管理')"
      >
        <!-- Step 1: connected accounts + choose a provider -->
        <template v-if="step === 'pick'">
          <header class="mail-modal-header compact">
            <h2>{{ mail.accounts.length ? t('邮箱账号') : t('添加新邮箱') }}</h2>
            <button
              type="button"
              class="icon-button"
              :aria-label="t('关闭')"
              :data-tooltip="t('关闭')"
              @click="close"
            >
              <X :size="16" />
            </button>
          </header>

          <div class="mail-modal-body">
            <Transition name="mail-notice" mode="out-in">
              <p v-if="error" key="err" class="mail-alert error" role="alert">
                <AlertTriangle :size="14" /> <span>{{ error }}</span>
              </p>
              <p v-else-if="statusMessage" key="ok" class="mail-alert success" role="status">
                <CheckCircle2 :size="14" /> <span>{{ statusMessage }}</span>
              </p>
            </Transition>

            <section v-if="mail.accounts.length" class="mail-modal-section">
              <ul class="mail-saved-accounts">
                <li v-for="acc in mail.accounts" :key="acc.id" class="mail-saved-account-row">
                  <MailProviderIcon :provider="acc.provider" />
                  <div class="mail-saved-account-text">
                    <strong>{{ acc.label }}</strong>
                    <span>{{ acc.email }}</span>
                  </div>
                  <button
                    type="button"
                    class="icon-button danger"
                    :aria-label="t('移除')"
                    :data-tooltip="t('移除')"
                    @click="removeAccount(acc.id)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </li>
              </ul>
              <p v-if="mail.cacheStats" class="mail-cache-line">
                <span>
                  {{
                    t('本机缓存：{0} 封邮件 · 正文 {1} · 附件 {2}', [
                      mail.cacheStats.messageCount,
                      formatBytes(mail.cacheStats.cachedBodyBytes),
                      formatBytes(mail.cacheStats.cachedAttachmentBytes),
                    ])
                  }}
                </span>
                <button
                  type="button"
                  class="mail-link-btn"
                  :disabled="clearingCache"
                  @click="clearCache"
                >
                  {{ clearingCache ? t('正在清理…') : t('清空正文与附件缓存') }}
                </button>
              </p>
            </section>

            <section class="mail-modal-section">
              <h3 v-if="mail.accounts.length">{{ t('添加新邮箱') }}</h3>
              <div class="mail-provider-grid">
                <button
                  v-for="preset in mail.presets"
                  :key="preset.id"
                  type="button"
                  class="mail-provider"
                  :title="preset.name"
                  @click="pickProvider(preset.id)"
                >
                  <MailProviderIcon :provider="preset.id" />
                  <span class="mail-provider-name">{{ preset.name }}</span>
                  <ChevronRight :size="15" class="mail-provider-chevron" />
                </button>
              </div>
            </section>
          </div>
        </template>

        <!-- Step 2: only what this provider needs -->
        <template v-else>
          <header class="mail-modal-header compact">
            <div class="mail-form-title">
              <button
                type="button"
                class="icon-button"
                :disabled="testing || saving"
                :aria-label="t('返回')"
                :data-tooltip="t('返回')"
                @click="backToPick"
              >
                <ChevronLeft :size="16" />
              </button>
              <MailProviderIcon :provider="selectedPresetId" />
              <h2>{{ currentPreset?.name ?? label }}</h2>
            </div>
            <button
              type="button"
              class="icon-button"
              :aria-label="t('关闭')"
              :data-tooltip="t('关闭')"
              @click="close"
            >
              <X :size="16" />
            </button>
          </header>

          <form class="mail-modal-body mail-account-form" @submit.prevent="submitAccount">
            <p v-if="currentPreset?.authHint" class="mail-auth-hint">{{ currentPreset.authHint }}</p>

            <label class="mail-field">
              <span>{{ t('邮箱地址') }}</span>
              <input
                ref="emailInput"
                v-model="email"
                type="email"
                autocomplete="email"
                placeholder="name@example.com"
              />
            </label>
            <label class="mail-field">
              <span>{{ t('授权码 / App 专用密码') }}</span>
              <input v-model="password" type="password" autocomplete="off" />
            </label>

            <!-- A custom server cannot work without hosts: keep them in view. -->
            <div v-if="isCustom" class="mail-form-grid">
              <label class="mail-field">
                <span>IMAP {{ t('服务器') }}</span>
                <input v-model="imapHost" type="text" placeholder="imap.example.com" />
              </label>
              <label class="mail-field">
                <span>SMTP {{ t('服务器') }}</span>
                <input v-model="smtpHost" type="text" placeholder="smtp.example.com" />
              </label>
            </div>

            <details class="mail-advanced">
              <summary>
                <ChevronRight :size="14" class="mail-advanced-chevron" />
                {{ t('更多设置') }}
              </summary>
              <div class="mail-form-grid">
                <label class="mail-field">
                  <span>{{ t('连接名称') }}</span>
                  <input v-model="label" type="text" />
                </label>
                <label class="mail-field">
                  <span>{{ t('发件人显示名（可选）') }}</span>
                  <input v-model="displayName" type="text" />
                </label>
                <label class="mail-field mail-form-full">
                  <span>{{ t('登录用户名（留空同邮箱）') }}</span>
                  <input v-model="username" type="text" />
                </label>
                <label v-if="!isCustom" class="mail-field">
                  <span>IMAP {{ t('服务器') }}</span>
                  <input v-model="imapHost" type="text" />
                </label>
                <label class="mail-field">
                  <span>IMAP {{ t('端口与加密') }}</span>
                  <div class="mail-inline-pair">
                    <input v-model.number="imapPort" type="number" min="1" max="65535" />
                    <select v-model="imapTls">
                      <option value="tls">TLS (993)</option>
                      <option value="starttls">STARTTLS (143)</option>
                    </select>
                  </div>
                </label>
                <label v-if="!isCustom" class="mail-field">
                  <span>SMTP {{ t('服务器') }}</span>
                  <input v-model="smtpHost" type="text" />
                </label>
                <label class="mail-field">
                  <span>SMTP {{ t('端口与加密') }}</span>
                  <div class="mail-inline-pair">
                    <input v-model.number="smtpPort" type="number" min="1" max="65535" />
                    <select v-model="smtpTls">
                      <option value="tls">TLS (465)</option>
                      <option value="starttls">STARTTLS (587)</option>
                    </select>
                  </div>
                </label>
              </div>
            </details>

            <Transition name="mail-notice" mode="out-in">
              <p v-if="error" key="err" class="mail-alert error" role="alert">
                <AlertTriangle :size="14" /> <span>{{ error }}</span>
              </p>
              <p v-else-if="statusMessage" key="ok" class="mail-alert success" role="status">
                <CheckCircle2 :size="14" /> <span>{{ statusMessage }}</span>
              </p>
            </Transition>
            <button type="submit" hidden />
          </form>

          <footer class="mail-modal-footer">
            <p class="mail-footer-note">
              <ShieldCheck :size="13" />
              <span>{{ t('授权码仅保存在本机系统凭据库') }}</span>
            </p>
            <button
              type="button"
              class="mail-btn-ghost"
              :disabled="testing || saving"
              @click="testConnection"
            >
              <span v-if="testing" class="mail-btn-spinner" aria-hidden="true" />
              {{ testing ? t('正在测试…') : t('测试连接') }}
            </button>
            <button
              type="button"
              class="mail-btn-primary"
              :disabled="testing || saving"
              @click="submitAccount"
            >
              <span v-if="saving" class="mail-btn-spinner" aria-hidden="true" />
              {{ saving ? t('正在保存…') : t('保存并同步') }}
            </button>
          </footer>
        </template>
      </section>
    </div>
  </Transition>
</template>
