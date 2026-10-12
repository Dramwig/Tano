<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import AssistantButterfly from './AssistantButterfly.vue';
import { butterflyPerchDirective, useButterflyController } from '../assistant/butterfly-vue';
import type { ButterflyPerch } from '../assistant/butterfly-vue';

const props = defineProps<{ busy?: boolean; scope?: string; contextLabel?: string }>();
const emit = defineEmits<{ open: [] }>();
const controller = useButterflyController();
const vButterflyPerch = butterflyPerchDirective(controller);
const home = computed<ButterflyPerch | undefined>(() => props.scope ? ({ id: `home:${props.scope}`, scope: props.scope,
  label: '圆球', kind: 'home', placement: { edge: 'center' } }) : undefined);
const away = computed(() => controller?.state.visible && controller.state.homeId === home.value?.id);
const hintId = useId();
const hint = computed(() => away.value ? '点此返回 · Esc 也可返回' : props.busy ? '正在忙，点开看看进展' : props.contextLabel ?? '聊聊这篇文档');
const butterflyMark = ref<InstanceType<typeof AssistantButterfly>>();
function greet(event: PointerEvent) {
  if (event.pointerType !== 'touch' && !away.value) butterflyMark.value?.flutter();
}
</script>

<template>
  <button
    v-butterfly-perch="home"
    type="button"
    class="assistant-launcher"
    :aria-label="away ? '让蝴蝶回到圆球' : '打开同页助手'"
    :aria-describedby="hintId"
    @mousedown.prevent
    @pointerenter="greet"
    @click="away ? controller?.returnHome() : emit('open')"
  >
    <span :id="hintId" class="assistant-launcher-hint" role="tooltip">
      <strong>同页助手</strong>
      <span>{{ hint }}</span>
    </span>
    <AssistantButterfly ref="butterflyMark" class="assistant-launcher-mark" :class="{ 'is-away': away }" />
    <span v-if="busy" class="assistant-launcher-status" aria-hidden="true" />
  </button>
</template>

<style scoped>
.assistant-launcher {
  position: absolute;
  z-index: 8;
  right: 24px;
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: 0 2px 3px #00000008, 0 6px 16px #00000008;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 200ms ease;
}
.assistant-launcher-mark {
  width: 36px;
  height: 36px;
}
.assistant-launcher-mark.is-away { visibility: hidden; }
.assistant-launcher-hint {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  display: grid;
  gap: 3px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 4px 16px #0000000a;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
}
.assistant-launcher-hint strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.assistant-launcher:focus-visible .assistant-launcher-hint {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
@media (hover: hover) {
  .assistant-launcher:hover {
    border-color: var(--control-border);
    box-shadow: 0 2px 4px #0000000a, 0 8px 20px #0000000c;
    transform: scale(1.06);
  }
  .assistant-launcher:hover .assistant-launcher-hint {
    visibility: visible;
    opacity: 1;
    transform: translateY(0);
  }
}
.assistant-launcher:active {
  transform: scale(0.97);
}
.assistant-launcher-status {
  position: absolute;
  right: 1px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--paper);
  border-radius: 50%;
  background: var(--text);
}
@media (max-width: 700px) {
  .assistant-launcher {
    right: 18px;
    bottom: max(14px, env(safe-area-inset-bottom, 0px));
    width: 50px;
    height: 50px;
  }
  .assistant-launcher-mark {
    width: 32px;
    height: 32px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-launcher,
  .assistant-launcher-hint {
    transition: none;
  }
}
</style>
