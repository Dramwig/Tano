<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { ArrowUpRight, Check } from 'lucide-vue-next';
import { helpChecklist, helpDocumentationUrl, type HelpChecklistId, type HelpContext, type HelpAvailability, type HelpTopicId } from '../help-content';
import { resumeHelpLesson } from '../help-checklist';

const props = defineProps<{
  completed: readonly HelpChecklistId[];
  context: HelpContext;
  availability?: HelpAvailability;
  documentationBaseUrl?: string;
  headingId?: string;
}>();
const emit = defineEmits<{ documentation: [event: MouseEvent, topic?: HelpTopicId] }>();
// Re-evaluate on the next opening. Keep links stable under the pointer and keyboard focus.
const lesson = resumeHelpLesson(props.completed, props.context, props.availability);
const nextStep = computed(() => lesson?.visible.find(step => !props.completed.includes(step.id))?.id);
const totalDone = computed(() => helpChecklist.filter(step => props.completed.includes(step.id)).length);
const docsUrl = (topic?: HelpTopicId) => helpDocumentationUrl(props.documentationBaseUrl, topic);
</script>

<template>
  <div class="help-checklist">
    <div class="help-preview-heading"><span :id="headingId">{{ lesson ? t('上手 · {0}', [lesson.label]) : t('上手指引') }}</span><span>{{ totalDone }}/{{ helpChecklist.length }} {{ t('已完成') }}</span></div>
    <section v-if="lesson" class="help-current-stage" :aria-label="t('当前阶段：{0}', [lesson.label])">
      <ol class="help-timeline" :aria-label="lesson.label">
        <li v-for="step in lesson.visible" :key="step.id"
          :class="{ 'is-complete': completed.includes(step.id), 'is-next': nextStep === step.id }">
          <span class="help-step-status" role="img" :aria-label="`${step.label}：${completed.includes(step.id) ? t('已完成') : t('未完成')}`">
            <span class="help-step-marker" aria-hidden="true"><Check v-if="completed.includes(step.id)" :size="9" :stroke-width="2.5" /></span>
          </span>
          <div class="help-step-content">
            <a :href="docsUrl(step.topic)" target="_blank" rel="noopener noreferrer" @click="emit('documentation', $event, step.topic)">{{ step.label }}<ArrowUpRight :size="11" /></a>
            <p v-if="nextStep === step.id">{{ step.hint }}</p>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.help-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 5px; color: var(--muted); font-size: 10px; }
.help-preview-heading > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.help-preview-heading > span:last-child { flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.help-timeline { list-style: none; padding: 0; margin: 1px 0 5px 3px; }
.help-timeline li { display: flex; position: relative; gap: 5px; min-height: 27px; }
.help-timeline li:not(:last-child)::before { content: ''; position: absolute; top: 13px; bottom: -13px; left: 10px; width: 1px; background: var(--line); }
.help-step-status { position: relative; z-index: 1; display: grid; place-items: center; align-self: flex-start; flex: 0 0 21px; width: 21px; height: 27px; }
.help-step-marker { display: grid; place-items: center; width: 7px; height: 7px; color: var(--paper); background: var(--paper); border: 1px solid var(--muted); border-radius: 50%; box-shadow: 0 0 0 3px var(--paper); }
.is-next .help-step-marker { background: var(--green); border-color: var(--green); }
.is-complete .help-step-marker { width: 11px; height: 11px; color: var(--green); border-color: var(--green); }
.help-step-content { flex: 1; min-width: 0; padding: 4px 0 5px; }
.help-step-content a { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.help-step-content a svg { flex-shrink: 0; color: var(--muted); opacity: 0; }
.help-step-content a:hover svg, .help-step-content a:focus-visible svg { opacity: 1; }
.is-next .help-step-content a { color: var(--text); }
.is-complete .help-step-content a { color: var(--muted); }
.help-step-content p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.help-checklist a:hover { color: var(--green); }
.help-checklist a { text-decoration: none; }
.help-checklist :is(button, a):focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
</style>
