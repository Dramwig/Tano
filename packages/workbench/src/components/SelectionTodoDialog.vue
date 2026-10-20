<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { X } from 'lucide-vue-next';
import type { SelectionTodoSession } from '../selection-todo';
const props = defineProps<{ session: SelectionTodoSession }>();
const emit = defineEmits<{ close: []; openTask: [id: string] }>();
const name = ref(props.session.name);
const input = ref<HTMLInputElement>();
const panel = ref<HTMLElement>();
const busy = ref(false);
const createdId = ref<string>();
const error = ref('');
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(async () => { await nextTick(); input.value?.focus(); input.value?.select(); });
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function close() { if (!busy.value) emit('close'); }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return;
  const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
}
async function save(append = false) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await props.session.save(name.value, append); emit('close'); }
  catch (reason) { createdId.value = props.session.created?.object.id; error.value = String(reason); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="selection-todo-backdrop" @click.self="close">
    <form ref="panel" class="selection-todo-dialog" role="dialog" aria-modal="true" :aria-label="t('从选区创建 Todo')" @submit.prevent="save()" @keydown.esc.stop.prevent="close" @keydown="trapFocus">
      <header><h2>{{ t('创建 Todo') }}</h2><button type="button" class="icon-button" :aria-label="t('关闭创建 Todo')" :data-tooltip="t('关闭')" :disabled="busy" @click="close"><X :size="18" /></button></header>
      <label>{{ t('名称') }}<input ref="input" v-model="name" maxlength="200" required :disabled="busy || !!createdId" /></label>
      <small>{{ session.source.name }}</small><blockquote>{{ session.text }}</blockquote>
      <p v-if="createdId" role="status">{{ t('任务已创建，原文引用尚未保存。') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="submit" class="primary-button" :disabled="busy || !name.trim()">{{ busy ? t('保存中') : createdId ? t('重试插入引用') : t('创建') }}</button><button v-if="createdId" type="button" :disabled="busy" @click="save(true)">{{ t('在原文末尾插入引用') }}</button><button v-if="createdId" type="button" :disabled="busy" @click="emit('openTask', createdId)">{{ t('打开任务') }}</button></footer>
    </form>
  </div>
</template>

<style scoped>
.selection-todo-backdrop { position: fixed; inset: 0; z-index: 90; background: #0005; display: grid; place-items: center; padding: 16px; }
.selection-todo-dialog { background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 8px; width: min(460px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: 20px; }
header { display: flex; align-items: center; justify-content: space-between; }
h2 { font-size: 18px; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; margin: 16px 0 10px; }
input { background: var(--paper); color: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 8px; font: inherit; width: 100%; }
blockquote { margin: 12px 0; padding-left: 12px; border-left: 2px solid var(--line); max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
small { color: var(--muted); }
footer { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
footer button { padding: 7px 12px; border: 1px solid var(--line); border-radius: 6px; }
p { font-size: 13px; overflow-wrap: anywhere; }
[role=alert] { color: var(--red, #b42336); }
</style>
