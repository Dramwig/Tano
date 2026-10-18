<script setup lang="ts">
import { Check, ChevronDown, ChevronRight, ChevronUp, MessageCircle, MoreHorizontal, Square, ThumbsDown, ThumbsUp, Undo2, X } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import MarkdownEditor from '@tano/editor';
import AssistantButterfly from './AssistantButterfly.vue';

export interface InlineAssistantAnchor {
  element: HTMLElement;
  getRects: () => DOMRect[];
  dispose: () => void;
}

const props = withDefaults(defineProps<{
  anchor: InlineAssistantAnchor;
  value: string;
  state: 'input' | 'loading' | 'completed' | 'response' | 'error';
  message?: string;
  progress?: string;
  error?: string;
  placeholder?: string;
}>(), { error: '', placeholder: '告诉助手如何处理所选内容…' });
const emit = defineEmits<{
  'update:value': [value: string];
  submit: [];
  stop: [];
  conversation: [];
  undo: [];
  close: [];
}>();

const input = ref<HTMLInputElement>();
const shell = ref<HTMLElement>();
const preview = ref<HTMLElement>();
const response = ref<HTMLElement>();
const responseId = useId();
const expanded = ref(false);
const renderFailed = ref(false);
let expansionChosen = false;
let resizeObserver: ResizeObserver | undefined;
const style = ref<Record<string, string>>({});
const busy = computed(() => props.state === 'loading');
const progressText = computed(() => props.progress?.trim() || '正在准备');
const resultText = computed(() => props.state === 'error' ? props.error : props.message || '我已完成更新。');
const canExpand = computed(() => !!resultText.value.trim());
let frame = 0;
let lastRect: DOMRect | undefined;

function position() {
  updateResponseMask();
  const rects = props.anchor.getRects();
  const current = rects.at(-1) ?? lastRect;
  if (!current || !shell.value) return;
  if (rects.length) lastRect = current;
  const width = Math.min(expanded.value ? 560 : 460, Math.max(0, window.innerWidth - 24));
  const left = Math.max(12, Math.min(current.left, window.innerWidth - width - 12));
  const top = Math.min(current.bottom + 8, window.innerHeight - shell.value.getBoundingClientRect().height - 12);
  style.value = { left: `${left}px`, top: `${Math.max(12, top)}px`, width: `${width}px` };
  measurePreview();
}
function updateResponseMask() {
  const element = response.value;
  if (!element) return;
  const remaining = Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop - 1);
  element.style.setProperty('--response-top-fade-strength', String(Math.min(1, Math.max(0, element.scrollTop) / 28)));
  element.style.setProperty('--response-bottom-fade-strength', String(Math.min(1, remaining / 12)));
}
function measurePreview() {
  if (preview.value && preview.value.clientWidth > 0 &&
      preview.value.scrollWidth > preview.value.clientWidth && !expansionChosen) expanded.value = true;
}
function toggleExpanded() {
  expansionChosen = true;
  expanded.value = !expanded.value;
}
function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { frame = 0; position(); });
}
function submit() {
  if (props.value.trim() && props.state === 'input') emit('submit');
}
function handleOutsidePointerDown(event: PointerEvent) {
  const target = event.target;
  if (busy.value || !(target instanceof Node) || shell.value?.contains(target)) return;
  emit('close');
}
watch(() => [props.anchor, props.state], () => { schedule(); if (props.state === 'input') void nextTick(() => input.value?.focus()); });
watch(() => [props.state, resultText.value], () => {
  expansionChosen = false;
  renderFailed.value = false;
  // Show substantial replies immediately, even before WebView has measured the text.
  const text = resultText.value.trim();
  expanded.value = !['input', 'loading'].includes(props.state) && (/\n/.test(text) || Array.from(text).length > 32);
  schedule();
}, { immediate: true });
watch(preview, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (element) resizeObserver?.observe(element);
  void nextTick(measurePreview);
}, { flush: 'post' });
watch(response, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (element) resizeObserver?.observe(element);
  schedule();
}, { flush: 'post' });
watch(expanded, () => { void nextTick(schedule); });
onMounted(() => {
  schedule();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => { measurePreview(); schedule(); });
    if (shell.value) resizeObserver.observe(shell.value);
    if (preview.value) resizeObserver.observe(preview.value);
    if (response.value) resizeObserver.observe(response.value);
  }
  if (props.state === 'input') void nextTick(() => input.value?.focus());
  document.addEventListener('pointerdown', handleOutsidePointerDown, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('resize', schedule);
  props.anchor.dispose();
});
</script>

<template>
  <Teleport to="body">
    <div ref="shell" class="inline-assistant" :class="{ 'inline-assistant-error': state === 'error' }" :style="style" role="status">
      <form v-if="state === 'input'" class="inline-assistant-input" @submit.prevent="submit">
        <AssistantButterfly :size="22" motion="none" />
        <input ref="input" :value="value" maxlength="20000" aria-label="输入助手任务" :placeholder="placeholder" @input="emit('update:value', ($event.target as HTMLInputElement).value)" @keydown.esc.prevent="emit('close')" />
        <button type="submit" class="inline-assistant-send" :disabled="!value.trim()" aria-label="发送给助手" title="发送"><ChevronRight :size="17" /></button>
      </form>
      <div v-else-if="busy" class="inline-assistant-state">
        <AssistantButterfly :size="22" motion="fly" />
        <span class="inline-assistant-thinking" :title="progressText">
          <span class="inline-assistant-thinking-text">{{ progressText }}</span>
          <span class="inline-assistant-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
        </span>
        <button type="button" class="inline-assistant-stop" aria-label="停止助手生成" title="停止生成" @click="emit('stop')"><Square :size="13" fill="currentColor" /></button>
      </div>
      <div v-else class="inline-assistant-state inline-assistant-complete" :class="{ 'inline-assistant-expanded': expanded }">
        <AssistantButterfly :size="22" motion="none" />
        <div v-if="expanded" :id="responseId" ref="response" class="inline-assistant-response panel-scrollbar" tabindex="0" aria-label="助手回复" @scroll.passive="updateResponseMask">
          <div v-if="state === 'error' || renderFailed" class="inline-assistant-response-text">{{ resultText }}</div>
          <MarkdownEditor v-else :model-value="resultText" :document-id="responseId" readonly :reveal-markdown="false" :resolve-image="() => null"
            open-links-on-tap @open-link="emit('conversation')" @ready="schedule" @error="renderFailed = true" />
        </div>
        <span v-else :id="responseId" ref="preview" class="inline-assistant-message" :title="resultText">{{ resultText }}</span>
        <div class="inline-assistant-actions">
        <button v-if="canExpand" type="button" class="inline-assistant-action" :aria-expanded="expanded" :aria-controls="responseId"
          :aria-label="expanded ? '收起回复' : '展开回复'" :title="expanded ? '收起回复' : '展开回复'" @click="toggleExpanded">
          <ChevronUp v-if="expanded" :size="16" /><ChevronDown v-else :size="16" />
        </button>
        <template v-if="state === 'completed'">
          <button type="button" class="inline-assistant-action" aria-label="有帮助" title="有帮助"><ThumbsUp :size="15" /></button>
          <button type="button" class="inline-assistant-action" aria-label="没帮助" title="没帮助"><ThumbsDown :size="15" /></button>
          <button type="button" class="inline-assistant-action" aria-label="查看修改" title="查看修改"><MoreHorizontal :size="16" /></button>
          <button type="button" class="inline-assistant-conversation" @click="emit('conversation')"><MessageCircle :size="15" />对话</button>
          <button type="button" class="inline-assistant-action" aria-label="撤销修改" title="撤销修改" @click="emit('undo')"><Undo2 :size="15" /></button>
          <button type="button" class="inline-assistant-done" aria-label="关闭" title="关闭" @click="emit('close')"><Check :size="15" /></button>
        </template>
        <template v-else>
          <button type="button" class="inline-assistant-conversation" @click="emit('conversation')"><MessageCircle :size="15" />对话</button>
          <button type="button" class="inline-assistant-action" aria-label="关闭" title="关闭" @click="emit('close')"><X :size="15" /></button>
        </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<!-- Teleport mounts this floating shell under <body>. Keep these unique
     classes global so WebView versions that do not carry the SFC scope
     attribute across Teleport still receive the panel background and shadow. -->
<style>
.inline-assistant {
  position: fixed;
  z-index: 46;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: min(460px, calc(100vw - 24px));
  min-height: 48px;
  padding: 0 12px;
  /* Keep the one-shot composer visibly floating on white documents as well as
     dark themes.  The previous mixed border/shadow was too subtle on the
     light page and disappeared in WebView captures. */
  border: 1px solid var(--control-border, #b9bfc8);
  border-radius: 15px;
  background: var(--paper, #ffffff);
  box-shadow:
    0 12px 30px rgba(26, 32, 44, 0.18),
    0 3px 8px rgba(26, 32, 44, 0.12);
  color: var(--text);
  font-size: 13px;
}
.inline-assistant-input, .inline-assistant-state {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.inline-assistant-input input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
.inline-assistant-input input::placeholder { color: var(--muted); }
.inline-assistant-send, .inline-assistant-stop, .inline-assistant-done { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: var(--text); color: var(--paper); cursor: pointer; }
.inline-assistant-send:disabled { opacity: .35; cursor: default; }
.inline-assistant-stop { margin-left: auto; border-radius: 7px; background: var(--surface); color: var(--text); }
.inline-assistant-thinking { display: inline-flex; align-items: baseline; min-width: 0; color: var(--text-secondary, var(--muted)); }
.inline-assistant-thinking-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.inline-assistant-thinking-dots { display: inline-flex; flex-shrink: 0; gap: 3px; margin-left: 3px; }
.inline-assistant-thinking-dots i { display: block; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .35; animation: inline-assistant-thinking-dot 1.1s ease-in-out infinite; }
.inline-assistant-thinking-dots i:nth-child(2) { animation-delay: .14s; }
.inline-assistant-thinking-dots i:nth-child(3) { animation-delay: .28s; }
.inline-assistant-complete { gap: 10px; line-height: 22px; }
.inline-assistant-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.inline-assistant-expanded { --response-top-fade: 28px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; padding-block: 0 6px; gap: 0 10px; }
.inline-assistant-expanded > .assistant-butterfly { margin-top: 12px; }
.inline-assistant-response {
  --response-edge-fade: 12px;
  --response-top-fade-strength: 0;
  --response-bottom-fade-strength: 0;
  --response-mask: linear-gradient(to bottom,
    rgba(0, 0, 0, calc(1 - var(--response-top-fade-strength))) 4px,
    rgba(0, 0, 0, calc(1 - var(--response-top-fade-strength) * .85)) 10px,
    rgba(0, 0, 0, calc(1 - var(--response-top-fade-strength) * .4)) 20px,
    #000 var(--response-top-fade),
    #000 calc(100% - var(--response-edge-fade)),
    rgba(0, 0, 0, calc(1 - var(--response-bottom-fade-strength))));
  min-width: 0;
  max-height: min(240px, calc(100dvh - 112px));
  margin-right: -12px;
  /* Fade overflowing content without reserving extra space at either edge. */
  padding: 12px 12px 0 0;
  overflow: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
  line-height: inherit;
  -webkit-mask-image: var(--response-mask);
  mask-image: var(--response-mask);
}
.inline-assistant-response-text { white-space: pre-wrap; }
.inline-assistant-response .ProseMirror { min-height: 0; padding: 0; font: inherit; }
.inline-assistant-response .frontmatter-panel { display: none; }
.inline-assistant-response p { margin: 0 0 10px; }
.inline-assistant-response .ProseMirror > :last-child { margin-bottom: 0; }
.inline-assistant-response :is(h1, h2, h3, h4, h5, h6) { font-size: 15px; line-height: 1.5; margin: 12px 0 6px; }
.inline-assistant-response :is(ul, ol) { padding-left: 22px; }
.inline-assistant-response pre { max-width: 100%; overflow: auto; }
.inline-assistant-expanded .inline-assistant-actions { grid-column: 2; justify-self: end; flex-wrap: wrap; justify-content: flex-end; }
.inline-assistant-message { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inline-assistant-action, .inline-assistant-conversation { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; min-height: 28px; padding: 0 4px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; }
.inline-assistant-action:hover, .inline-assistant-conversation:hover { background: var(--surface); color: var(--text); }
.inline-assistant-conversation { padding-inline: 6px; }
.inline-assistant-done { background: #e3f1ff; color: #2876c7; }
.inline-assistant-error :is(.inline-assistant-message, .inline-assistant-response) { color: var(--danger, #b64545); }
@keyframes inline-assistant-thinking-dot { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) {
  .inline-assistant-thinking-dots i { animation: none; }
  .inline-assistant-thinking-dots i { opacity: .7; }
}
@media (max-width: 620px) { .inline-assistant-complete:not(.inline-assistant-expanded) { flex-wrap: wrap; padding-block: 8px; } .inline-assistant-actions { margin-left: auto; } }
</style>
