<script setup lang="ts">
import { computed } from 'vue';
import { Check, ChevronRight, CircleAlert, LoaderCircle, Square } from 'lucide-vue-next';
import type { AssistantMessage } from '@tano/protocol';
import { uiLocale } from '../i18n';
import { assistantCopy, formatAssistantText } from '../assistant/language';
import { assistantDisplayParts, assistantToolLabel } from '../assistant/results';
import AssistantRunSummary from './AssistantRunSummary.vue';

const props = defineProps<{ message: AssistantMessage }>();
const parts = computed(() => assistantDisplayParts(props.message));
const copy = computed(() => assistantCopy(uiLocale.value).activity);
const toolCount = computed(() => props.message.activity?.filter(item => item.kind === 'tool').length ?? 0);
const failures = computed(() => props.message.toolResults?.filter(result => result.status === 'failed').length ?? 0);
const active = computed(() => props.message.state === 'running' || props.message.state === 'waiting');
const waitingCopy = computed(() => assistantCopy(uiLocale.value).run.waiting);
</script>

<template>
  <details v-if="parts.process.length" class="assistant-process" :open="active">
    <summary>
      <ChevronRight class="assistant-process-chevron" :size="14" />
      <LoaderCircle v-if="message.state === 'running'" class="assistant-process-spinner" :size="13" />
      <span>{{ message.state === 'waiting' ? waitingCopy : active ? copy.working : copy.title }}</span>
      <span v-if="toolCount" class="assistant-process-count">{{ formatAssistantText(copy.calls, [toolCount]) }}</span>
      <span v-if="failures" class="assistant-process-failures">{{ formatAssistantText(copy.failures, [failures]) }}</span>
    </summary>
    <div class="assistant-process-items">
      <div v-for="part in parts.process" :key="part.key" class="assistant-process-item">
        <slot v-if="part.kind === 'text'" name="text" :content="part.content" :id="part.key" />
        <slot v-else-if="part.kind === 'input'" name="input" :input="part.input" />
        <div v-else class="assistant-tool-step" :data-status="part.tool.status" role="status">
          <div class="assistant-tool-step-heading">
            <LoaderCircle v-if="part.tool.status === 'running'" class="assistant-process-spinner" :size="13" />
            <Check v-else-if="part.tool.status === 'succeeded'" :size="13" />
            <CircleAlert v-else-if="part.tool.status === 'failed'" :size="13" />
            <Square v-else :size="12" />
            <span>{{ assistantToolLabel(part.tool.name) }}</span><small>{{ copy[part.tool.status] }}</small>
          </div>
          <p v-if="part.result?.error" class="assistant-tool-step-error">{{ part.result.error }}</p>
        </div>
      </div>
    </div>
  </details>
  <template v-for="part in parts.answer" :key="part.key">
    <slot v-if="part.kind === 'text'" name="text" :content="part.content" :id="part.key" />
    <slot v-else-if="part.kind === 'input'" name="input" :input="part.input" />
  </template>
  <AssistantRunSummary :message="message" />
</template>

<style scoped>
.assistant-process { margin: 4px 0 12px; color: var(--muted); font-size: 12px; }
.assistant-process > summary { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; cursor: pointer; list-style: none; padding: 5px 0; }
.assistant-process > summary::-webkit-details-marker { display: none; }
.assistant-process > summary:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; border-radius: 4px; }
.assistant-process[open] .assistant-process-chevron { transform: rotate(90deg); }
.assistant-process-count { opacity: .8; }
.assistant-process-failures, .assistant-tool-step[data-status="failed"] { color: var(--danger, #b44235); }
.assistant-process-items { margin: 6px 0 0 6px; padding-left: 14px; border-left: 1px solid var(--line); }
.assistant-process-item + .assistant-process-item { margin-top: 10px; }
.assistant-tool-step-heading { display: flex; align-items: center; gap: 7px; min-width: 0; }
.assistant-tool-step-heading small { margin-left: auto; flex-shrink: 0; font-size: 11px; }
.assistant-tool-step-error { margin: 5px 0 0 20px; overflow-wrap: anywhere; }
.assistant-process-spinner { animation: assistant-process-spin 1.4s linear infinite; flex-shrink: 0; }
@keyframes assistant-process-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .assistant-process-spinner { animation: none; } }
</style>
