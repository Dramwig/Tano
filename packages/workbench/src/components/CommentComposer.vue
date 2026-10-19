<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowUp, AtSign, UserRound } from 'lucide-vue-next';
import type { CommentMention } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ modelValue: string; authorName: string; label: string; busy?: boolean; compact?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [mentions: CommentMention[]] }>();
const workspace = useWorkspaceStore();
const choosing = ref(false);
const query = ref('');
const mentionStart = ref<number | null>(null);
const mentions = ref<CommentMention[]>([]);
const people = computed(() => workspace.objects.map(item => item.object).filter(item =>
  item.type === 'person' && !item.archived && item.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())));
watch(() => props.modelValue, value => {
  mentions.value = mentions.value.filter(item => value.includes(item.text));
  if (!value) choosing.value = false;
  void nextTick(resize);
});
function submit() { if (!props.busy && props.modelValue.trim()) emit('submit', mentions.value); }
async function mention(personId: string, name: string) {
  if (props.busy) return;
  const text = `@${name.slice(0, 119)}`;
  const from = mentionStart.value ?? input.value?.selectionStart ?? props.modelValue.length;
  const to = input.value?.selectionEnd ?? from;
  if (props.modelValue.length - (to - from) + text.length + 1 > 20_000) return;
  emit('update:modelValue', `${props.modelValue.slice(0, from)}${text} ${props.modelValue.slice(to)}`);
  if (!mentions.value.some(item => item.personId === personId)) mentions.value.push({ personId, text });
  choosing.value = false;
  query.value = '';
  mentionStart.value = null;
  await focus();
  input.value?.setSelectionRange(from + text.length + 1, from + text.length + 1);
}
const input = ref<HTMLTextAreaElement>();
function resize() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(160, Math.max(props.compact ? 26 : 36, input.value.scrollHeight))}px`;
}
function update(event: Event) {
  const field = event.target as HTMLTextAreaElement;
  emit('update:modelValue', field.value);
  const typed = /(?:^|\s)@([^\s@]*)$/.exec(field.value.slice(0, field.selectionStart));
  choosing.value = Boolean(typed);
  query.value = typed?.[1] ?? '';
  mentionStart.value = typed ? field.selectionStart - typed[1]!.length - 1 : null;
  resize();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { choosing.value = false; return; }
  if (event.key === 'Enter' && choosing.value && !event.shiftKey && !event.isComposing && people.value[0]) {
    event.preventDefault();
    void mention(people.value[0].id, people.value[0].name);
    return;
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}
async function focus() { await nextTick(); input.value?.focus(); }
defineExpose({ focus });
</script>

<template>
  <form class="comment-composer" :class="{ 'is-compact': compact, 'has-content': !!modelValue }" @submit.prevent="submit">
    <span v-if="compact" class="comment-avatar" :title="authorName"><UserRound :size="15" /></span>
    <div class="comment-composer-field">
      <textarea ref="input" :value="modelValue" :aria-label="label" :placeholder="label" rows="1"
        maxlength="20000" @input="update" @keydown="keydown" />
      <button v-if="workspace.objects.some(item => item.object.type === 'person' && !item.object.archived)" type="button"
        class="comment-mention" :data-tooltip="t('提及人物')" :aria-label="t('提及人物')" :aria-expanded="choosing" :disabled="busy" @click="choosing = !choosing; mentionStart = null; query = ''"><AtSign :size="16" /></button>
      <button type="submit" class="comment-send" :aria-label="t('发表{0}', [label])" :data-tooltip="t('发表{0}', [label])"
        :disabled="busy || !modelValue.trim()"><ArrowUp :size="16" /></button>
    </div>
    <div v-if="choosing" class="comment-people" role="dialog" :aria-label="t('提及人物')" @keydown.esc.stop="choosing = false">
      <input v-model="query" :aria-label="t('搜索人物')" :placeholder="t('搜索人物')" @keydown.enter.prevent />
      <button v-for="person in people" :key="person.id" type="button" @click="mention(person.id, person.name)"><UserRound :size="14" />{{ person.name }}</button>
      <span v-if="!people.length">{{ t('没有匹配的人物') }}</span>
    </div>
  </form>
</template>

<style scoped>
.comment-composer { position: relative; display: flex; align-items: flex-start; gap: 10px; }
.comment-mention { display: grid; place-items: center; width: 26px; height: 26px; flex: none; margin-bottom: 5px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.comment-people { position: absolute; bottom: 100%; right: 0; z-index: 10; display: grid; gap: 4px; width: min(260px, 100%); max-height: 220px; overflow: auto; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); box-shadow: 0 4px 16px rgb(0 0 0 / 10%); }
.comment-people input { width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); color: var(--text); font: inherit; }
.comment-people button { display: flex; align-items: center; gap: 8px; padding: 6px; border: 0; background: transparent; color: var(--text); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.comment-people button:hover { background: var(--hover); }
.comment-avatar { display: grid; place-items: center; width: 24px; height: 24px; flex: none; margin-top: 4px; border: 1px solid var(--line); border-radius: 50%; color: var(--muted); background: var(--paper); }
.comment-composer-field { display: flex; align-items: flex-end; gap: 8px; min-width: 0; flex: 1; padding: 6px 9px; border: 1px solid var(--control-border, var(--line)); border-radius: 6px; transition: border-color .15s; }
.comment-composer-field:focus-within { border-color: var(--green); }
textarea { width: 100%; min-width: 0; min-height: 36px; max-height: 160px; resize: none; border: 0; padding: 8px 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; line-height: 20px; box-sizing: border-box; }
textarea::placeholder { color: color-mix(in srgb, var(--muted) 55%, var(--paper)); opacity: 1; }
.comment-send { display: grid; place-items: center; width: 26px; height: 26px; flex: none; margin-bottom: 5px; padding: 0; border: 0; border-radius: 50%; background: var(--green-fill); color: white; cursor: pointer; }
.comment-send:disabled { background: var(--line); color: var(--muted); cursor: default; }
.comment-send:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.comment-composer .comment-send, .comment-composer .comment-mention { visibility: hidden; }
.comment-composer:focus-within .comment-send, .comment-composer:focus-within .comment-mention,
.comment-composer.has-content .comment-send, .comment-composer.has-content .comment-mention { visibility: visible; }
.is-compact { gap: 8px; }
.is-compact .comment-composer-field { border: 0; padding: 0; }
.is-compact textarea { min-height: 26px; padding-block: 3px; }
.is-compact .comment-avatar { margin-top: 1px; }
.is-compact .comment-send, .is-compact .comment-mention { margin-bottom: 0; }
</style>
