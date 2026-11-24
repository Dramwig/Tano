<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { sourceSpacingPositions } from '@tano/editor/source-highlight';
import { t } from '../../i18n/i18n';
import { useWindowContext } from '../../windows/context';

const { window } = useWindowContext();
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const keystrokes = '用Tano记录2026年\n公式$x$见[[笔记]]';
type Part = { text: string; inserted?: boolean };
const frames: { key: string; parts: Part[]; delay: number }[] = [{ key: '', parts: [], delay: 260 }];

let markdown = '';
for (const key of keystrokes) {
  const source = markdown + key;
  const spaces = sourceSpacingPositions(source, markdown.length, source.length);
  const parts: Part[] = [];
  let start = 0;
  for (const at of spaces) {
    parts.push({ text: source.slice(start, at) }, { text: ' ', inserted: true });
    start = at;
  }
  parts.push({ text: source.slice(start) });
  markdown = parts.map(part => part.text).join('');
  frames.push({ key, parts, delay: spaces.length ? 420 : frames.length === 1 ? 260 : 125 });
}

const reducedMotion = ref(motion.matches);
const last = frames.length - 1;
const index = ref(reducedMotion.value ? last : 0);
const frame = computed(() => frames[index.value]!);
let timer: number | undefined;

function schedule() {
  timer = window.setTimeout(() => {
    index.value = index.value === last ? 0 : index.value + 1;
    schedule();
  }, index.value === last ? 1800 : frame.value.delay);
}

function restart() {
  window.clearTimeout(timer);
  reducedMotion.value = motion.matches;
  index.value = reducedMotion.value ? last : 0;
  if (!reducedMotion.value) schedule();
}

onMounted(() => {
  motion.addEventListener('change', restart);
  restart();
});
onBeforeUnmount(() => {
  motion.removeEventListener('change', restart);
  window.clearTimeout(timer);
});
</script>

<template>
  <div class="input-spacing-example">
    <div class="input-spacing-caption">
      <span>{{ t('Markdown 源码') }}</span>
      <span v-if="!reducedMotion && frame.key" class="input-spacing-key">{{ t('输入') }} <kbd>{{ frame.key === '\n' ? '↵' : frame.key }}</kbd></span>
    </div>
    <code class="input-spacing-source"><span v-for="(part, i) in frame.parts" :key="i" :class="{ 'input-spacing-inserted': part.inserted && !reducedMotion }">{{ part.text }}</span><span v-if="!reducedMotion" class="input-spacing-caret" /></code>
  </div>
</template>

<style scoped>
.input-spacing-caption { display: flex; align-items: center; justify-content: space-between; min-height: 20px; margin-bottom: 4px; color: var(--muted); font-size: 11px; }
.input-spacing-key { display: flex; align-items: center; gap: 4px; }
.input-spacing-key kbd { min-width: 1em; padding: 0 3px; border: 1px solid var(--line); border-radius: 3px; color: var(--text); font: inherit; text-align: center; }
.input-spacing-source { display: block; min-height: 3em; color: var(--text); font-size: 15px; line-height: 1.5; white-space: pre; }
.input-spacing-caret { display: inline-block; width: 1.5px; height: 1em; background: currentColor; vertical-align: -0.12em; }
.input-spacing-inserted { background: color-mix(in srgb, currentColor 18%, transparent); text-decoration: underline; }
</style>
