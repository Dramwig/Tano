<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { Trash2 } from 'lucide-vue-next';
import type { SettingsPageContext } from '../runtime';

const props = defineProps<{
  workspace: SettingsPageContext['workspace'];
  mode?: SettingsPageContext['mode'];
  busy?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ delete: [workspaceId: string] }>();
const confirming = ref(false);
const name = ref('');
const input = ref<HTMLInputElement>();
const trigger = ref<HTMLButtonElement>();
const confirmation = ref<HTMLButtonElement>();
const local = computed(() => props.mode === 'local');
const disabled = computed(() => !props.workspace || (!local.value && !props.workspace.canDelete) || props.busy);
watch([
  () => props.workspace?.id,
  () => props.workspace?.name,
  () => props.workspace?.canDelete,
  () => props.mode,
], () => {
  confirming.value = false;
  name.value = '';
});
async function confirm() {
  if (disabled.value) return;
  confirming.value = true;
  name.value = '';
  await nextTick();
  if (local.value) confirmation.value?.focus();
  else input.value?.focus();
}
async function cancel() {
  if (props.busy) return;
  confirming.value = false;
  name.value = '';
  await nextTick();
  trigger.value?.focus();
}
function remove() {
  if (disabled.value || !confirming.value || !props.workspace || (!local.value && name.value !== props.workspace.name)) return;
  emit('delete', props.workspace.id);
}
</script>

<template>
  <section v-if="workspace" class="settings-section workspace-deletion-settings" :aria-label="t('删除工作区')">
    <h3>{{ t('删除工作区') }}</h3>
    <div class="settings-card">
        <div class="settings-row settings-row-with-controls" data-settings-key="workspace-delete">
        <div>
          <strong>{{ t('删除当前工作区') }}</strong>
          <p v-if="local">{{ t('仅删除本平台的本地仓库注册，从工作区列表中移除。磁盘上的文件夹、Markdown、附件和 .tano 数据均会保留，之后可重新打开文件夹。') }}</p>
          <p v-else>{{ t('删除此工作区及其中的文档、附件、历史记录和设置，所有成员将失去访问权限。此操作无法撤销，建议先导出内容。') }}</p>
          <p v-if="!local && !workspace.canDelete">{{ t('仅工作区所有者可以删除工作区。') }}</p>
        </div>
        <button ref="trigger" type="button" class="settings-button workspace-delete-button" :disabled="disabled || confirming" @click="confirm"><Trash2 :size="14" />{{ busy ? t('删除中…') : t('删除当前工作区') }}</button>
      </div>
      <form v-if="confirming" class="workspace-delete-confirmation" :aria-label="t('确认删除工作区')" @submit.prevent="remove" @keydown.esc.stop.prevent="cancel">
        <p v-if="local">{{ t('确认删除「') }}{{ workspace.name }}{{ t('」在本平台的注册？本地文件会保留，可通过重新打开文件夹恢复注册。') }}</p>
        <template v-else>
          <label for="workspace-delete-name">{{ t('请输入工作区名称「') }}{{ workspace.name }}{{ t('」以确认删除。') }}</label>
          <input id="workspace-delete-name" ref="input" v-model="name" class="settings-input" autocomplete="off" :aria-label="t('确认删除的工作区名称')" :disabled="busy" />
        </template>
        <div class="settings-controls">
          <button type="button" class="settings-button" :disabled="busy" @click="cancel">{{ t('取消') }}</button>
          <button ref="confirmation" type="submit" class="settings-button workspace-delete-button" :disabled="disabled || (!local && name !== workspace.name)">{{ busy ? t('删除中…') : local ? t('删除注册') : t('永久删除工作区') }}</button>
        </div>
      </form>
    </div>
    <p v-if="error" class="settings-notice" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.workspace-delete-button { color: var(--danger, #c43d3d); flex-shrink: 0; }
.workspace-delete-confirmation {
  display: grid;
  gap: 16px;
  margin: 8px 0 4px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--danger, #c43d3d) 24%, var(--line));
  border-radius: 10px;
  background: var(--paper);
  font-size: 13px;
  line-height: 1.7;
}
.workspace-delete-confirmation p { margin: 0; }
.workspace-delete-confirmation .settings-controls { justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.workspace-delete-confirmation label,
.workspace-delete-confirmation p { overflow-wrap: anywhere; }
.workspace-delete-confirmation .settings-input { width: 100%; }
@media (max-width: 700px) {
  .workspace-delete-confirmation { padding: 16px; }
}
</style>
