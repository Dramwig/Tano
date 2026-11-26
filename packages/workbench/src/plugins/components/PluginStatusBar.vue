<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n/i18n';
import type { WorkbenchPinnedCommand } from '../../runtime';
import type { PluginInteraction, PluginWorkbenchStatusBarItem } from '../workbench';

const props = defineProps<{
  items: readonly PluginWorkbenchStatusBarItem[];
  workspaceId: string;
  activeDocumentId?: string;
  execute: (interaction: PluginInteraction) => Promise<void>;
  safeMode?: boolean;
  pinnedCommands?: readonly WorkbenchPinnedCommand[];
}>();
const emit = defineEmits<{ exitSafeMode: []; runPinnedCommand: [command: string] }>();

const leftItems = computed(() => props.items.filter((item) => item.align === 'left'));
const rightItems = computed(() => props.items.filter((item) => item.align !== 'left'));
const visible = computed(() => props.items.length > 0 || !!props.safeMode || (props.pinnedCommands?.length ?? 0) > 0);

function trigger(item: PluginWorkbenchStatusBarItem) {
  if (!item.command || !props.workspaceId) return;
  void props
    .execute({
      workspaceId: props.workspaceId,
      pluginId: item.pluginId,
      instanceId: item.instanceId,
      kind: 'command',
      name: item.command,
      payload: {
        workspaceId: props.workspaceId,
        ...(props.activeDocumentId ? { fileId: props.activeDocumentId } : {}),
      },
    })
    .catch(() => {});
}
</script>

<template>
  <footer v-if="visible" class="plugin-status-bar" :aria-label="t('插件状态栏')">
    <div class="plugin-status-group plugin-status-left">
      <button
        v-if="safeMode"
        type="button"
        class="plugin-status-item clickable tone-warning"
        :title="t('安全模式已开启：点击退出并恢复个人微调与第三方插件')"
        @click="emit('exitSafeMode')"
      >
        {{ t('安全模式 · 点击退出') }}
      </button>
      <button
        v-for="pinned in pinnedCommands ?? []"
        :key="`pinned-${pinned.id}`"
        type="button"
        class="plugin-status-item clickable tone-accent"
        :title="pinned.description || pinned.command"
        @click="emit('runPinnedCommand', pinned.command)"
      >
        {{ pinned.label }}
      </button>
      <template v-for="item in leftItems" :key="item.key">
        <button
          v-if="item.command"
          type="button"
          class="plugin-status-item clickable"
          :class="`tone-${item.tone ?? 'default'}`"
          :data-tooltip="item.tooltip || item.pluginName"
          :title="item.tooltip || item.pluginName"
          @click="trigger(item)"
        >
          {{ item.text }}
        </button>
        <span
          v-else
          class="plugin-status-item"
          :class="`tone-${item.tone ?? 'default'}`"
          :data-tooltip="item.tooltip || item.pluginName"
          :title="item.tooltip || item.pluginName"
        >
          {{ item.text }}
        </span>
      </template>
    </div>
    <div class="plugin-status-group plugin-status-right">
      <template v-for="item in rightItems" :key="item.key">
        <button
          v-if="item.command"
          type="button"
          class="plugin-status-item clickable"
          :class="`tone-${item.tone ?? 'default'}`"
          :data-tooltip="item.tooltip || item.pluginName"
          :title="item.tooltip || item.pluginName"
          @click="trigger(item)"
        >
          {{ item.text }}
        </button>
        <span
          v-else
          class="plugin-status-item"
          :class="`tone-${item.tone ?? 'default'}`"
          :data-tooltip="item.tooltip || item.pluginName"
          :title="item.tooltip || item.pluginName"
        >
          {{ item.text }}
        </span>
      </template>
    </div>
  </footer>
</template>

<style scoped>
.plugin-status-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 24px;
  padding: 0 12px;
  border-top: 1px solid var(--line);
  background: var(--workbench-front, var(--paper));
  color: var(--muted);
  font-size: 11px;
  user-select: none;
}
.plugin-status-group {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.plugin-status-item {
  display: inline-flex;
  align-items: center;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--muted);
  line-height: 1.4;
}
.plugin-status-item.clickable {
  cursor: pointer;
}
.plugin-status-item.clickable:hover {
  background: var(--hover);
  color: var(--text);
}
.plugin-status-item.tone-accent {
  color: var(--green);
}
.plugin-status-item.tone-warning {
  color: #b86b15;
}
.plugin-status-item.tone-danger {
  color: var(--danger, #c4483d);
}
</style>
