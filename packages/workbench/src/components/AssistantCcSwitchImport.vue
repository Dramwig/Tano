<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Download, LoaderCircle } from 'lucide-vue-next';
import { open } from '@tauri-apps/plugin-dialog';
import type { AssistantImportCandidate } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
import { t } from '../i18n';

const assistant = useAssistantStore();
const emit = defineEmits<{ changed: [] }>();
const dialog = ref<HTMLDialogElement>();
const trigger = ref<HTMLButtonElement>();
const visible = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const path = ref<string>();
const candidates = ref<AssistantImportCandidate[]>([]);
const selected = ref<string[]>([]);
const eligible = computed(() => candidates.value.filter(item => !item.reason));
const locked = computed(() => loading.value || saving.value);
const capacity = computed(() => Math.max(0, 20 - assistant.connections.length));

async function scan() {
  loading.value = true; error.value = ''; candidates.value = []; selected.value = [];
  try { candidates.value = await assistant.scanCcSwitch(path.value); }
  catch (reason) { error.value = String(reason); }
  finally { loading.value = false; }
}
async function show() {
  visible.value = true;
  await nextTick(); dialog.value?.showModal();
  await scan();
}
function close() {
  if (locked.value) return;
  dialog.value?.close(); visible.value = false;
  trigger.value?.focus();
}
async function chooseFile() {
  try {
    const chosen = await open({ multiple: false, directory: false, filters: [{ name: 'CC Switch', extensions: ['db'] }] });
    if (typeof chosen === 'string') { path.value = chosen; await scan(); }
  } catch (reason) { error.value = String(reason); }
}
async function save() {
  if (locked.value || !selected.value.length || selected.value.length > capacity.value) return;
  saving.value = true; error.value = '';
  try {
    await assistant.importCcSwitch([...selected.value], path.value);
    emit('changed'); saving.value = false; close();
  } catch (reason) { error.value = String(reason); }
  finally { saving.value = false; }
}
</script>

<template>
  <button v-if="assistant.canImportCcSwitch" ref="trigger" type="button" class="cc-import-trigger" aria-haspopup="dialog" :disabled="assistant.busy || assistant.loading" @click="show"><Download :size="15" />{{ t('从 CC Switch 导入') }}</button>
  <Teleport to="body">
    <dialog v-if="visible" ref="dialog" class="cc-import-dialog" aria-labelledby="cc-import-title" @cancel.prevent="close" @keydown.stop>
      <form @submit.prevent="save">
        <header><h2 id="cc-import-title">{{ t('从 CC Switch 导入') }}</h2></header>
        <div class="cc-import-body" :aria-busy="locked">
          <p>{{ t('扫描本机 CC Switch 的全部提供商，勾选需要导入的连接。密钥安全保存到系统凭据库。') }}</p>
          <div class="cc-import-tools">
            <button type="button" class="secondary-button" :disabled="locked" @click="chooseFile">{{ t('选择数据库文件') }}</button>
            <button type="button" class="secondary-button" :disabled="locked" @click="scan">{{ t('重新扫描') }}</button>
          </div>
          <p v-if="loading" role="status"><LoaderCircle :size="15" class="spinning" />{{ t('正在识别提供商…') }}</p>
          <template v-else>
            <p v-if="!candidates.length && !error" role="status">{{ t('CC Switch 中没有提供商。') }}</p>
            <template v-if="candidates.length">
              <div class="cc-import-selection">
                <label><input type="checkbox" :disabled="locked || !eligible.length" :checked="eligible.length > 0 && selected.length === eligible.length" :indeterminate="selected.length > 0 && selected.length < eligible.length" @change="selected = ($event.target as HTMLInputElement).checked ? eligible.map(item => item.id) : []" />{{ t('全选可导入项') }}</label>
                <span>{{ t('已选 {0} 项，还可添加 {1} 个连接', [selected.length, capacity]) }}</span>
              </div>
              <ul>
                <li v-for="item in candidates" :key="item.id">
                  <label :class="{ unavailable: item.reason }">
                    <input v-model="selected" type="checkbox" :value="item.id" :disabled="locked || !!item.reason" />
                    <span><strong>{{ item.name }}</strong><small>{{ item.source }}<template v-if="item.endpoint"> · {{ item.endpoint }}</template></small><small v-if="item.reason">{{ t(item.reason) }}</small></span>
                  </label>
                </li>
              </ul>
            </template>
          </template>
          <p v-if="selected.length > capacity" class="form-error" role="alert">{{ t('选择数量超过连接上限，请减少选择。') }}</p>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <footer>
          <button type="button" class="secondary-button" :disabled="locked" @click="close">{{ t('取消') }}</button>
          <button type="submit" class="secondary-button" :disabled="locked || !selected.length || selected.length > capacity || assistant.busy || assistant.loading"><LoaderCircle v-if="saving" :size="15" class="spinning" />{{ saving ? t('正在导入…') : t('导入所选连接') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.cc-import-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; white-space: nowrap; }
.cc-import-trigger:hover:not(:disabled) { background: var(--hover); }
.cc-import-dialog {
  --cc-import-height: min(760px, calc(100dvh - 40px));
  box-sizing: border-box;
  width: min(640px, calc(100vw - 32px));
  max-height: var(--cc-import-height);
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--text);
  background: var(--paper);
  box-shadow: 0 24px 80px #00000026, 0 4px 16px #0000000a;
}
.cc-import-dialog::backdrop { background: rgb(0 0 0 / 28%); }
form {
  display: flex;
  flex-direction: column;
  /* Reserve the dialog's two border pixels inside its height limit. */
  max-height: calc(var(--cc-import-height) - 2px);
  min-height: 0;
  overflow: hidden;
}
header, footer { padding: 18px 24px; flex-shrink: 0; }
h2 { margin: 0; font-size: 18px; }
.cc-import-body { min-height: 0; overflow-y: auto; padding: 0 24px 20px; }
p { font-size: 13px; color: var(--muted); line-height: 1.6; }
.cc-import-tools, footer { display: flex; gap: 8px; }
footer { justify-content: flex-end; border-top: 1px solid var(--line); }
.cc-import-selection { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 18px 0 10px; font-size: 12px; }
label { display: flex; align-items: flex-start; gap: 10px; }
input { flex-shrink: 0; margin-top: 3px; }
ul { list-style: none; padding: 0; margin: 0; }
li { border-top: 1px solid var(--line); padding: 12px 0; }
strong { font-size: 14px; font-weight: 500; }
small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
.unavailable strong { color: var(--muted); }
.form-error { color: var(--danger, #b42318); }
</style>
