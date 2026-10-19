<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { useWorkspaceStore } from '../stores/workspace';
import { shortcutLabel } from '../shortcuts';
import { matchesCommand } from '../command-palette';
import type { WorkbenchCommand } from '../command-palette';
const props = defineProps<{
  commands: WorkbenchCommand[];
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const query = ref('');
const selected = ref(-1);
const before = document.activeElement as HTMLElement | null;
const commands = computed(() => [
  ...props.commands.map(command => ({ ...command, source: command.category ?? t('同页'), showSource: !!command.category })),
  ...store.pluginCommands.map(command => ({ id: command.key, label: command.label, source: command.pluginName, showSource: true, shortcut: command.shortcut,
    run: () => store.interactWithPlugin({ workspaceId: store.workspace!.id, pluginId: command.pluginId, instanceId: command.instanceId, kind: 'command', name: command.id,
      payload: { workspaceId: store.workspace!.id, fileId: store.active?.id } }) })),
  ...store.pluginViews.map(view => ({ id: view.key + ':open', label: t('打开{0}', [view.label]), source: view.pluginName, showSource: true, shortcut: '', run: () => store.openPluginView(view.pluginId, view.id) })),
].filter(command => matchesCommand(command, query.value)));
watch(query, () => {
  selected.value = -1;
  void nextTick(() => dialog.value?.querySelector('.command-option')?.scrollIntoView({ block: 'nearest' }));
});
watch(commands, items => { selected.value = Math.min(selected.value, items.length - 1); });
function execute(index: number) {
  const command = commands.value[index];
  if (!command) return;
  emit('close');
  void Promise.resolve().then(() => command.run()).catch(store.report);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key !== 'Escape' && event.target !== input.value) return;
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
  if (event.key === 'Escape') emit('close');
  else if (event.key === 'Enter') execute(selected.value);
  else if (commands.value.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    selected.value = selected.value < 0
      ? (event.key === 'ArrowDown' ? 0 : commands.value.length - 1)
      : (selected.value + commands.value.length + (event.key === 'ArrowDown' ? 1 : -1)) % commands.value.length;
    void nextTick(() => dialog.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
}
onMounted(() => { dialog.value?.showModal(); void nextTick(() => input.value?.focus()); });
onBeforeUnmount(() => { dialog.value?.close(); if (before?.isConnected) before.focus(); });
</script>
<template>
  <dialog ref="dialog" class="command-palette" :aria-label="t('命令中心')" @cancel.prevent="emit('close')" @keydown="keydown" @click="event => { if (event.target === dialog) emit('close'); }">
    <div class="command-palette-body">
      <div class="command-search">
        <input ref="input" v-model="query" role="combobox" :aria-label="t('搜索命令')" aria-autocomplete="list" aria-controls="workbench-command-list" :aria-activedescendant="selected >= 0 && commands[selected] ? `workbench-command-${selected}` : undefined" aria-expanded="true" :placeholder="t('搜索命令…')" autocomplete="off" spellcheck="false" />
        <button type="button" class="command-close" :aria-label="t('关闭命令中心')" :data-tooltip="t('关闭')" data-tooltip-shortcut="Escape" @click="emit('close')"><X :size="15" aria-hidden="true" /></button>
      </div>
      <div class="command-results panel-scrollbar">
        <div id="workbench-command-list" class="command-list" role="listbox" :aria-label="t('可用命令')">
          <button v-for="(command, index) in commands" :id="`workbench-command-${index}`" :key="command.id" type="button" class="command-option" role="option" :aria-selected="index === selected" tabindex="-1"
            @pointermove="selected = index" @click="execute(index)">
            <span class="command-label" :title="command.showSource ? `${command.source}：${command.label}` : command.label"><template v-if="command.showSource">{{ command.source }}：</template>{{ command.label }}</span>
            <kbd v-if="command.shortcut" class="command-shortcut">{{ shortcutLabel(command.shortcut) }}</kbd>
          </button>
        </div>
        <p v-if="!commands.length" class="command-empty" role="status">{{ t('没有匹配的命令') }}</p>
      </div>
    </div>
  </dialog>
</template>
<style scoped>
.command-palette {
  --command-max-height: min(560px, calc(100dvh - 72px));
  width: min(600px, calc(100vw - 32px));
  max-height: var(--command-max-height);
  margin: 48px auto auto;
  padding: 0;
  overflow: hidden;
  color: var(--text);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 36px #18212b24, 0 2px 8px #18212b0d;
}
.command-palette::backdrop { background: #0000000d; }
.command-palette-body { display: flex; flex-direction: column; max-height: calc(var(--command-max-height) - 2px); }
.command-close { display: grid; flex: none; place-items: center; width: 26px; height: 26px; padding: 0; border-radius: 6px; color: var(--muted); }
.command-close:hover { background: var(--hover); color: var(--text); }
.command-search { display: flex; flex: none; align-items: center; gap: 8px; padding: 10px 12px 10px 20px; border-bottom: 1px solid var(--line); }
.command-search input { flex: 1; min-width: 0; height: 30px; padding: 0; border: 0; border-radius: 0; outline: none; background: transparent; color: var(--text); font-size: 14px; line-height: 22px; }
.command-search input::placeholder { color: var(--muted); }
.command-results { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 7px; }
.command-option { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 32px; padding: 6px 12px; border-radius: 6px; text-align: left; font-size: 13px; line-height: 20px; transition: none; }
.command-option[aria-selected='true'] { background: color-mix(in srgb, var(--accent) 45%, var(--hover)); }
.command-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-shortcut { flex: none; padding: 0 5px; border: 0; border-radius: 4px; background: var(--surface); color: var(--muted); font-family: inherit; font-size: 11px; line-height: 18px; }
.command-empty { margin: 0; padding: 14px 12px; color: var(--muted); font-size: 13px; }
@media (max-width: 480px) {
  .command-palette { --command-max-height: calc(100dvh - 32px); width: calc(100vw - 24px); margin-top: 16px; }
}
</style>
