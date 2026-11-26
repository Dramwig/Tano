<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, ref, watch } from 'vue';
import { AlertTriangle, KeyRound, ShieldAlert, ShieldCheck, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useSshStore } from '../store';

const ssh = useSshStore();
const challenge = computed(() => ssh.activeChallenge);
const answers = ref<string[]>([]);
const saveSecret = ref(false);
const submitting = ref(false);

const authTitle = computed(() => {
  if (challenge.value?.type !== 'auth') return '';
  if (challenge.value.event.kind === 'passphrase') return t('输入 SSH 私钥口令');
  if (challenge.value.event.kind === 'keyboard-interactive') return t('SSH 交互式身份验证');
  return t('输入 SSH 登录密码');
});

watch(
  challenge,
  (next) => {
    submitting.value = false;
    if (next?.type === 'auth') {
      answers.value = next.event.prompts.map(() => '');
      saveSecret.value = false;
    } else {
      answers.value = [];
      saveSecret.value = false;
    }
  },
  { immediate: true },
);

async function cancel() {
  const current = challenge.value;
  if (!current || submitting.value) return;
  submitting.value = true;
  try {
    await ssh.respondChallenge({
      challengeId: current.event.challengeId,
      cancelled: true,
      trustHostKey: false,
      secrets: [],
      saveSecret: false,
    });
  } finally {
    submitting.value = false;
  }
}

async function acceptHostKey() {
  const current = challenge.value;
  if (!current || current.type !== 'host-key' || current.event.mismatch || submitting.value) return;
  submitting.value = true;
  try {
    await ssh.respondChallenge({
      challengeId: current.event.challengeId,
      cancelled: false,
      trustHostKey: true,
      secrets: [],
      saveSecret: true,
    });
  } finally {
    submitting.value = false;
  }
}

async function submitAuth() {
  const current = challenge.value;
  if (!current || current.type !== 'auth' || submitting.value) return;
  submitting.value = true;
  try {
    await ssh.respondChallenge({
      challengeId: current.event.challengeId,
      cancelled: false,
      trustHostKey: false,
      secrets: [...answers.value],
      saveSecret: current.event.allowSave && saveSecret.value,
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="challenge" class="modal-backdrop ssh-auth-backdrop" data-surface-role="backdrop">
    <section
      class="modal ssh-auth-modal"
      data-surface-role="dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="
        challenge.type === 'host-key'
          ? challenge.event.mismatch
            ? t('SSH 主机密钥发生变化')
            : t('确认 SSH 主机指纹')
          : authTitle
      "
    >
      <header class="ssh-auth-header">
        <div class="ssh-auth-title">
          <ShieldAlert v-if="challenge.type === 'host-key' && challenge.event.mismatch" :size="20" class="danger-icon" />
          <ShieldCheck v-else-if="challenge.type === 'host-key'" :size="20" />
          <KeyRound v-else :size="20" />
          <h2>
            {{
              challenge.type === 'host-key'
                ? challenge.event.mismatch
                  ? t('警告：SSH 主机密钥已变更')
                  : t('首次连接，请确认主机指纹')
                : authTitle
            }}
          </h2>
        </div>
        <button type="button" class="icon-button" :aria-label="t('取消')" @click="cancel">
          <X :size="18" />
        </button>
      </header>

      <template v-if="challenge.type === 'host-key'">
        <div v-if="challenge.event.mismatch" class="ssh-mitm-warning" role="alert">
          <AlertTriangle :size="18" />
          <div>
            <strong>{{ t('已自动阻止连接以防止中间人攻击（MITM）') }}</strong>
            <p>
              {{ t('服务器 {0}:{1} 返回的主机密钥与已保存的指纹不一致。如果服务器确实重装或更换了密钥，请先在「设置 → SSH 远程」中移除旧指纹后再重新连接。', [challenge.event.hostname, String(challenge.event.port)]) }}
            </p>
          </div>
        </div>
        <p v-else class="ssh-auth-desc">
          {{ t('正在首次连接 {0}:{1}。请核对以下服务器密钥指纹后决定是否信任并保存到本机 known_hosts。', [challenge.event.hostname, String(challenge.event.port)]) }}
        </p>

        <dl class="ssh-fingerprint-box">
          <div>
            <dt>{{ t('主机地址') }}</dt>
            <dd><code>{{ challenge.event.hostname }}:{{ challenge.event.port }}</code></dd>
          </div>
          <div>
            <dt>{{ t('密钥算法') }}</dt>
            <dd><code>{{ challenge.event.algorithm }}</code></dd>
          </div>
          <div v-if="challenge.event.previousFingerprint">
            <dt>{{ t('已保存指纹') }}</dt>
            <dd><code>{{ challenge.event.previousFingerprint }}</code></dd>
          </div>
          <div>
            <dt>{{ challenge.event.mismatch ? t('当前返回指纹') : t('SHA-256 指纹') }}</dt>
            <dd><code>{{ challenge.event.fingerprint }}</code></dd>
          </div>
        </dl>

        <footer class="ssh-auth-actions">
          <button type="button" class="secondary-button" :disabled="submitting" @click="cancel">
            {{ challenge.event.mismatch ? t('知道了（断开连接）') : t('取消连接') }}
          </button>
          <button
            v-if="!challenge.event.mismatch"
            type="button"
            class="primary-button"
            :disabled="submitting"
            @click="acceptHostKey"
          >
            {{ t('信任并继续连接') }}
          </button>
        </footer>
      </template>

      <form v-else class="ssh-auth-form" @submit.prevent="submitAuth">
        <p class="ssh-auth-desc">
          {{ t('服务器：{0}', [challenge.event.hostLabel]) }}
        </p>
        <p v-if="challenge.event.instruction" class="ssh-auth-instructions">
          {{ challenge.event.instruction }}
        </p>
        <label v-for="(item, idx) in challenge.event.prompts" :key="idx" class="ssh-auth-field">
          <span>{{ item.prompt }}</span>
          <input
            v-model="answers[idx]"
            :type="item.echo ? 'text' : 'password'"
            autocomplete="off"
            required
          />
        </label>
        <label v-if="challenge.event.allowSave" class="ssh-auth-save">
          <input v-model="saveSecret" type="checkbox" />
          <span>{{ t('安全保存到系统凭据库（Keyring）') }}</span>
        </label>
        <footer class="ssh-auth-actions">
          <button type="button" class="secondary-button" :disabled="submitting" @click="cancel">
            {{ t('取消') }}
          </button>
          <button type="submit" class="primary-button" :disabled="submitting">
            {{ t('确认验证') }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.ssh-auth-backdrop {
  z-index: 260;
}
.ssh-auth-modal {
  width: min(480px, 92vw);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ssh-auth-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ssh-auth-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ssh-auth-title h2 {
  margin: 0;
  font-size: 16px;
}
.danger-icon {
  color: var(--danger, #d93025);
}
.ssh-mitm-warning {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, #d93025 45%, transparent);
  background: color-mix(in srgb, #d93025 10%, transparent);
  color: var(--text);
  font-size: 13px;
}
.ssh-mitm-warning p {
  margin: 4px 0 0;
  color: var(--muted);
}
.ssh-auth-desc,
.ssh-auth-instructions {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  white-space: pre-wrap;
}
.ssh-fingerprint-box {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  display: grid;
  gap: 8px;
  font-size: 12.5px;
}
.ssh-fingerprint-box div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ssh-fingerprint-box dt {
  color: var(--muted);
  font-size: 11.5px;
}
.ssh-fingerprint-box dd {
  margin: 0;
  word-break: break-all;
}
.ssh-auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ssh-auth-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.ssh-auth-field input {
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.ssh-auth-save {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
}
.ssh-auth-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
