<script setup lang="ts">
import { CirclePlus } from 'lucide-vue-next';
import WorkspaceIcon from './WorkspaceIcon.vue';
import WorkspaceIconPicker from './WorkspaceIconPicker.vue';
import { t } from '../i18n';

defineProps<{ icon: string; readonly?: boolean }>();
const emit = defineEmits<{ select: [icon: string] }>();
</script>

<template>
  <WorkspaceIcon v-if="readonly && icon" :icon="icon" :size="18" />
  <WorkspaceIconPicker v-else-if="!readonly" :icon="icon" mode="local" :label="t('自定义块图标')"
    :allow-upload="false" align="start" trigger-class="callout-icon-trigger" @select="emit('select', $event)">
    <template #preview>
      <WorkspaceIcon v-if="icon" :icon="icon" :size="18" />
      <CirclePlus v-else class="callout-icon-placeholder" :size="20" aria-hidden="true" />
    </template>
  </WorkspaceIconPicker>
</template>

<style>
.settings-button.workspace-icon-preview.callout-icon-trigger {
  width: 26px; height: 28px; min-height: 0; padding: 0; border: 0; border-radius: 5px; background: transparent;
}
.callout-icon-trigger:hover { background: var(--hover); }
.callout-icon-placeholder { color: var(--muted); opacity: .35; }
.callout-icon-trigger:hover .callout-icon-placeholder, .callout-icon-trigger:focus-visible .callout-icon-placeholder { opacity: 1; }
</style>
