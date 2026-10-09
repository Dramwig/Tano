<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import { shortcutLabel } from '../shortcuts';
const props = defineProps<{ commands: { id: string; label: string; run: () => unknown }[] }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const query = ref('');
const selected = ref(0);
const before = document.activeElement as HTMLElement | null;
const commands = computed(() => [
  ...props.commands.map(command => ({ ...command, source: '同页', shortcut: '' })),
  ...store.pluginCommands.map(command => ({ id: command.key, label: command.label, source: command.pluginName, shortcut: command.shortcut,
    run: () => store.interactWithPlugin({ workspaceId: store.workspace!.id, pluginId: command.pluginId, instanceId: command.instanceId, kind: 'command', name: command.id,
      payload: { workspaceId: store.workspace!.id, fileId: store.active?.id } }) })),
  ...store.pluginViews.map(view => ({ id: view.key + ':open', label: `打开${view.label}`, source: view.pluginName, shortcut: '', run: () => store.openPluginView(view.pluginId, view.id) })),
].filter(command => `${command.label} ${command.source} ${command.id}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
watch(query, () => { selected.value = 0; });
watch(commands, items => { selected.value = Math.min(selected.value, Math.max(0, items.length - 1)); });
function execute(index: number) {
  const command = commands.value[index];
  if (!command) return;
  emit('close');
  void Promise.resolve().then(() => command.run()).catch(store.report);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
  if (event.key === 'Escape') emit('close');
  else if (event.key === 'Enter') execute(selected.value);
  else if (commands.value.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    selected.value = (selected.value + commands.value.length + (event.key === 'ArrowDown' ? 1 : -1)) % commands.value.length;
    void nextTick(() => dialog.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
}
onMounted(() => { dialog.value?.showModal(); void nextTick(() => input.value?.focus()); });
onBeforeUnmount(() => { dialog.value?.close(); if (before?.isConnected) before.focus(); });
</script>
<template>
  <dialog ref="dialog" class="command-palette" aria-label="命令中心" @cancel.prevent="emit('close')" @keydown="keydown" @click="event => { if (event.target === dialog) emit('close'); }">
    <div class="command-palette-body">
      <header><strong>命令中心</strong><button aria-label="关闭命令中心" @click="emit('close')">关闭</button></header>
      <input ref="input" v-model="query" role="combobox" aria-label="搜索命令" aria-controls="workbench-command-list" :aria-activedescendant="commands.length ? `workbench-command-${selected}` : undefined" aria-expanded="true" placeholder="搜索命令、插件或视图…" />
      <div id="workbench-command-list" class="command-list" role="listbox" aria-label="可用命令">
        <button v-for="(command, index) in commands" :id="`workbench-command-${index}`" :key="command.id" role="option" :aria-selected="index === selected" tabindex="-1"
          @pointermove="selected = index" @click="execute(index)"><span>{{ command.label }}<small>{{ command.source }}</small></span><kbd v-if="command.shortcut">{{ shortcutLabel(command.shortcut) }}</kbd></button>
        <p v-if="!commands.length">没有匹配的命令。</p>
      </div>
    </div>
  </dialog>
</template>
<style scoped>
.command-palette { width: min(620px, calc(100vw - 32px)); max-height: min(600px, 80vh); margin: 12vh auto auto; padding: 0; color: var(--text); background: var(--paper); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 20px 70px #0003; }
.command-palette::backdrop { background: #0004; }
.command-palette-body { padding: 14px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
input { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--text); font: inherit; }
.command-list { max-height: 50vh; overflow: auto; margin-top: 8px; }
button { border: 0; border-radius: 6px; background: transparent; color: var(--text); font: inherit; padding: 8px; }
.command-list button { display: flex; width: 100%; align-items: center; justify-content: space-between; text-align: left; padding: 10px; }
button[aria-selected="true"] { background: var(--surface); }
small { display: block; color: var(--muted); margin-top: 4px; }
kbd { font: inherit; font-size: 11px; color: var(--muted); }
p { color: var(--muted); text-align: center; padding: 20px; }
</style>
