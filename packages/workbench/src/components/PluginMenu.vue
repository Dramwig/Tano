<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import type { PluginMenuLocation } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
const props = defineProps<{ location: PluginMenuLocation; fileId?: string }>();
const emit = defineEmits<{ selected: [] }>();
const store = useWorkspaceStore();
const commands = computed(() => store.pluginCommands.filter(command => command.menus?.includes(props.location)));
function run(key: string) {
  const command = commands.value.find(command => command.key === key);
  if (!command || !store.workspace) return;
  emit('selected');
  void store.interactWithPlugin({ workspaceId: store.workspace.id, pluginId: command.pluginId, instanceId: command.instanceId,
    kind: 'command', name: command.id, payload: { workspaceId: store.workspace.id, fileId: props.fileId } }).catch(store.report);
}
</script>
<template>
  <div v-if="commands.length" class="plugin-menu" role="group" :aria-label="t('插件命令')">
    <button v-for="command in commands" :key="command.key" type="button" role="menuitem" @click="run(command.key)">
      <span>{{ command.label }}</span><small>{{ command.pluginName }}</small>
    </button>
  </div>
</template>
<style scoped>
.plugin-menu { border-top: 1px solid var(--line); padding-block: 5px; }
.menu-divider + .plugin-menu { border-top: 0; }
button { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; padding: 8px 10px; color: var(--text); background: transparent; border: 0; border-radius: 5px; font: inherit; text-align: left; }
button:hover, button:focus-visible { background: var(--surface); }
small { color: var(--muted); font-size: 11px; }
</style>
