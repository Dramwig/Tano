<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ArrowUp, UserRound } from 'lucide-vue-next';

const props = defineProps<{ modelValue: string; authorName: string; label: string; busy?: boolean; compact?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>();
const input = ref<HTMLTextAreaElement>();
function resize() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(160, Math.max(36, input.value.scrollHeight))}px`;
}
function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  resize();
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!props.busy && props.modelValue.trim()) emit('submit');
}
async function focus() { await nextTick(); input.value?.focus(); }
defineExpose({ focus });
</script>

<template>
  <form class="comment-composer" :class="{ 'is-compact': compact }" @submit.prevent="emit('submit')">
    <span v-if="compact" class="comment-avatar" :title="authorName"><UserRound :size="15" /></span>
    <div class="comment-composer-field">
      <textarea ref="input" :value="modelValue" :aria-label="label" :placeholder="label" rows="1"
        maxlength="20000" @input="update" @keydown="keydown" />
      <button type="submit" class="comment-send" :aria-label="`发表${label}`" :title="`发表${label}`"
        :disabled="busy || !modelValue.trim()"><ArrowUp :size="16" /></button>
    </div>
  </form>
</template>

<style scoped>
.comment-composer { display: flex; align-items: flex-start; gap: 10px; }
.comment-avatar { display: grid; place-items: center; width: 28px; height: 28px; flex: none; margin-top: 4px; border: 1px solid var(--line); border-radius: 50%; color: var(--muted); background: var(--paper); }
.comment-composer-field { display: flex; align-items: flex-end; gap: 8px; min-width: 0; flex: 1; padding: 6px 9px; border: 1px solid var(--control-border, var(--line)); border-radius: 6px; transition: border-color .15s; }
.comment-composer-field:focus-within { border-color: var(--green); }
textarea { width: 100%; min-width: 0; min-height: 36px; max-height: 160px; resize: none; border: 0; padding: 8px 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; line-height: 20px; box-sizing: border-box; }
textarea::placeholder { color: var(--muted); }
.comment-send { display: grid; place-items: center; width: 26px; height: 26px; flex: none; margin-bottom: 5px; padding: 0; border: 0; border-radius: 50%; background: var(--green); color: white; cursor: pointer; }
.comment-send:disabled { background: var(--line); color: var(--muted); cursor: default; }
.comment-send:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.is-compact .comment-composer-field { border-color: transparent; padding: 0 6px; }
.is-compact .comment-composer-field:focus-within { border-color: var(--line); }
</style>
