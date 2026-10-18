<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import type { AssistantUserInput } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
const props = defineProps<{ request: AssistantUserInput }>();
const assistant = useAssistantStore();
const pending = computed(() => assistant.pendingUserInput?.request.id === props.request.id ? assistant.pendingUserInput : null);
const question = computed(() => pending.value ? props.request.questions[pending.value.step]! : null);
const input = ref<HTMLTextAreaElement>();
const body = ref<HTMLDivElement>();
const customAnswer = ref('');
const customSelected = ref(true);
function resizeInput() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(input.value.scrollHeight, 120)}px`;
}
function selectOption(option: string) {
  if (!pending.value) return;
  customSelected.value = false;
  pending.value.values[pending.value.step] = option;
}
function selectCustom() {
  if (!pending.value) return;
  customSelected.value = true;
  pending.value.values[pending.value.step] = customAnswer.value;
}
function updateCustom() {
  selectCustom();
  resizeInput();
}
function advance(skip = false) {
  const state = pending.value;
  if (!state || state.submitting) return;
  if (skip) state.values[state.step] = '';
  if (state.step < props.request.questions.length - 1) state.step++;
  else void assistant.submitUserInput(props.request.id);
}
watch(() => pending.value?.step, () => {
  const value = pending.value?.values[pending.value.step] ?? '';
  customSelected.value = !question.value?.options?.includes(value);
  customAnswer.value = customSelected.value ? value : '';
  void nextTick(() => {
    if (body.value) body.value.scrollTop = 0;
    resizeInput();
    const target = customSelected.value ? input.value : body.value?.querySelector<HTMLInputElement>('input:checked');
    target?.focus({ preventScroll: true });
  });
}, { immediate: true });
</script>

<template>
  <form v-if="pending && question" class="assistant-question-card" :aria-label="t('回答助手问题')" @submit.prevent="advance()">
    <div class="assistant-question-heading"><label :for="`answer-${request.id}`">{{ question.question }}</label></div>
    <div ref="body" class="assistant-question-body panel-scrollbar">
    <div v-if="question.options?.length" class="assistant-question-options" role="radiogroup" :aria-label="question.question">
      <label v-for="option in question.options" :key="option"><input type="radio" :name="request.id" :value="option" :checked="!customSelected && pending.values[pending.step] === option" :disabled="pending.submitting" @change="selectOption(option)" /><span>{{ option }}</span></label>
    </div>
    <div class="assistant-question-custom">
      <input type="radio" :name="request.id" :aria-label="t('自定义回答')" :checked="customSelected" :disabled="pending.submitting" @change="selectCustom(); input?.focus()" />
      <textarea :id="`answer-${request.id}`" ref="input" v-model="customAnswer" :disabled="pending.submitting" :placeholder="t('或者，请描述你的要求……')" maxlength="4000" rows="1" @focus="selectCustom()" @input="updateCustom()" @keydown.ctrl.enter.prevent="advance()" @keydown.meta.enter.prevent="advance()" />
      <span class="assistant-question-number" :title="t('第 {0} 题，共 {1} 题', [pending.step + 1, request.questions.length])" :aria-label="t('第 {0} 题，共 {1} 题', [pending.step + 1, request.questions.length])">{{ pending.step + 1 }}</span>
    </div>
    </div>
    <div class="assistant-question-actions">
      <button v-if="pending.step > 0" type="button" :disabled="pending.submitting" @click="pending.step--">{{ t('上一题') }}</button>
      <button type="button" class="assistant-question-skip" :disabled="pending.submitting" @click="advance(true)">{{ t('跳过') }}</button>
      <button class="assistant-question-send" :aria-label="pending.step === request.questions.length - 1 ? t('提交回答') : t('下一题')" :disabled="pending.submitting">{{ pending.submitting ? t('正在提交') : pending.step === request.questions.length - 1 ? t('发送') : t('下一题') }}</button>
    </div>
  </form>
  <div v-else-if="request.status === 'answered'" class="assistant-user-answers" role="group" :aria-label="t('你的回答')">
    <div v-for="(item, index) in request.questions" :key="item.id"><p>{{ item.question }}</p><div>{{ request.answers?.[index]?.answer ?? t('（已跳过）') }}</div></div>
  </div>
  <p v-else class="assistant-question-cancelled">{{ request.status === 'pending' ? t('正在准备问题…') : t('这组问题已停止，未提交回答。') }}</p>
</template>

<style scoped>
.assistant-question-card { --question-accent: var(--green-fill); display: flex; flex-direction: column; min-height: 0; margin: 0; padding: 14px 8px 8px; border: 1px solid color-mix(in srgb, var(--line) 75%, var(--paper)); border-radius: 18px; background: var(--paper); box-shadow: 0 2px 3px #00000005; }
.assistant-question-heading { flex-shrink: 0; padding: 0 7px; margin-bottom: 14px; font-size: 14px; line-height: 20px; }
.assistant-question-heading label { font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant-question-body { min-height: 0; margin-right: -8px; padding-right: 8px; overflow: auto; overscroll-behavior: contain; }
.assistant-question-options { display: grid; gap: 6px; margin-bottom: 6px; }
.assistant-question-options label, .assistant-question-custom { display: flex; align-items: flex-start; gap: 8px; min-height: 40px; padding: 8px 6px; border-radius: 8px; background: color-mix(in srgb, var(--surface) 70%, var(--paper)); font-size: 14px; line-height: 24px; overflow-wrap: anywhere; }
.assistant-question-options label { cursor: pointer; }
.assistant-question-card input[type="radio"] { appearance: none; flex-shrink: 0; width: 20px; height: 20px; margin: 2px 0; border: 1.5px solid color-mix(in srgb, var(--muted) 35%, var(--paper)); border-radius: 50%; background: var(--paper); cursor: pointer; }
.assistant-question-card input[type="radio"]:checked { border: 6px solid var(--question-accent); background: white; }
.assistant-question-card textarea { display: block; width: 100%; min-width: 0; min-height: 24px; max-height: 120px; resize: none; border: 0; border-radius: 0; padding: 0; outline: none; background: transparent; color: var(--text); font: inherit; line-height: 24px; }
.assistant-question-card textarea::placeholder { color: var(--muted); opacity: .55; }
.assistant-question-number { display: grid; place-items: center; flex-shrink: 0; min-width: 22px; height: 22px; margin-top: 1px; padding: 0 4px; border-radius: 5px; background: var(--question-accent); color: white; font-size: 12px; line-height: 1; }
.assistant-question-actions { display: flex; flex-shrink: 0; align-items: center; gap: 6px; margin-top: 18px; }
.assistant-question-actions button { min-height: 32px; padding: 5px 8px; border-radius: 7px; color: var(--muted); font-size: 14px; line-height: 22px; }
.assistant-question-skip { margin-left: auto; color: var(--muted); }
.assistant-question-actions .assistant-question-send { background: var(--question-accent); color: white; }
.assistant-question-send:hover:not(:disabled) { background: var(--green-fill-hover); }
.assistant-question-card :is(input, button):focus-visible { outline-color: var(--green); }
.assistant-user-answers { width: fit-content; max-width: 90%; margin: 18px 0 18px auto; padding: 14px 18px; border-radius: 18px; background: var(--surface); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; white-space: pre-wrap; }
.assistant-user-answers > div + div { margin-top: 16px; }
.assistant-user-answers p { margin: 0 0 4px; color: var(--muted); }
.assistant-question-cancelled { color: var(--muted); font-size: 12px; }
</style>
