<script setup lang="ts">
import { computed } from 'vue';
import type { AssistantMessage } from '@tano/protocol';
import { assistantCopy, formatAssistantText } from '../assistant/language';
import { uiLocale } from '../i18n';

const props = defineProps<{ message: AssistantMessage }>();
const copy = computed(() => assistantCopy(uiLocale.value).run);
const reason = computed(() => props.message.termination?.reason ?? (props.message.state === 'cancelled' ? 'cancelled' : props.message.state === 'interrupted' ? 'interrupted' : 'error'));
const receipts = computed(() => [
  [copy.value.succeeded, props.message.toolResults?.filter(result => result.status === 'succeeded').length ?? 0],
  [copy.value.failed, props.message.toolResults?.filter(result => result.status === 'failed').length ?? 0],
  [copy.value.interrupted, props.message.activity?.filter(item => item.kind === 'tool' && item.status === 'interrupted').length ?? 0],
] as const);
const changes = computed(() => [
  { label: copy.value.saved, items: props.message.proposals?.filter(item => item.status === 'applied' && !item.suggestionGroupId) ?? [] },
  { label: copy.value.review, items: props.message.proposals?.filter(item => item.status === 'ready') ?? [] },
  { label: copy.value.uncertain, items: props.message.proposals?.filter(item => ['unknown', 'applying', 'conflicted'].includes(item.status)) ?? [] },
]);
</script>

<template>
  <div v-if="message.state && ['failed', 'cancelled', 'interrupted'].includes(message.state)" class="assistant-run-summary" role="status">
    <strong>{{ copy.reasons[reason] }}</strong>
    <p>{{ copy.incomplete }}</p>
    <div class="assistant-run-receipts"><span v-for="[label, count] in receipts.filter(([, count]) => count > 0)" :key="label">{{ formatAssistantText(label, [count]) }}</span></div>
    <template v-for="group in changes" :key="group.label">
      <template v-if="group.items.length"><p>{{ group.label }}</p><ul><li v-for="item in group.items" :key="item.id">{{ item.path }}</li></ul></template>
    </template>
  </div>
</template>

<style scoped>
.assistant-run-summary { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.assistant-run-summary p { margin: 5px 0; }
.assistant-run-summary ul { margin: 3px 0; padding-left: 18px; }
.assistant-run-receipts { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--muted); }
</style>
