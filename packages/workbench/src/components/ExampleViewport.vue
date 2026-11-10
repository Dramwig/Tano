<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n';
const props = withDefaults(defineProps<{ width?: number; gutter?: number }>(), { width: 320, gutter: 0 });
const frame = ref<HTMLElement>(), iframe = ref<HTMLIFrameElement>(), content = ref<HTMLElement>(), portal = ref<HTMLElement>();
const viewport = { width: window.innerWidth, height: window.innerHeight };
let resize: ResizeObserver | undefined, mutations: MutationObserver | undefined, styles: MutationObserver | undefined, theme: MutationObserver | undefined, pending = 0;
function measure() {
  if (!frame.value || !content.value || !iframe.value) return;
  const width = frame.value.clientWidth, height = frame.value.clientHeight;
  const scale = Math.min(1, width / props.width, height / Math.max(1, content.value.scrollHeight, content.value.offsetHeight));
  const transform = `translateX(${(width - props.width * scale) / 2}px) scale(${scale})`;
  if (iframe.value.style.transform !== transform) iframe.value.style.transform = transform;
}
function schedule() { cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); }
function synchronize() {
  const document = iframe.value?.contentDocument;
  if (!document || !frame.value) return;
  for (const node of document.head.querySelectorAll('[data-preview-shared]')) node.remove();
  for (const node of globalThis.document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = node.cloneNode(true) as HTMLElement; clone.setAttribute('data-preview-shared', ''); document.head.append(clone);
  }
  const root = globalThis.document.documentElement;
  for (const attribute of root.attributes) document.documentElement.setAttribute(attribute.name, attribute.value);
  const inherited = getComputedStyle(frame.value);
  for (const name of inherited) if (name.startsWith('--')) document.documentElement.style.setProperty(name, inherited.getPropertyValue(name));
  document.body.style.cssText = 'margin:0;min-height:100vh;overflow:hidden;background:var(--paper)';
  schedule();
}
onMounted(async () => {
  const document = iframe.value!.contentDocument!;
  document.open(); document.write('<!doctype html><html><head></head><body><div id="preview-root"></div></body></html>'); document.close();
  synchronize(); portal.value = document.querySelector<HTMLElement>('#preview-root')!;
  await nextTick();
  resize = new ResizeObserver(schedule); resize.observe(frame.value!); resize.observe(content.value!);
  mutations = new MutationObserver(schedule); mutations.observe(content.value!, { childList: true, subtree: true, characterData: true });
  styles = new MutationObserver(synchronize); styles.observe(globalThis.document.head, { childList: true, subtree: true, characterData: true });
  theme = new MutationObserver(synchronize); theme.observe(globalThis.document.documentElement, { attributes: true });
  measure();
});
onBeforeUnmount(() => { resize?.disconnect(); mutations?.disconnect(); styles?.disconnect(); theme?.disconnect(); cancelAnimationFrame(pending); });
</script>
<template>
  <div ref="frame" class="example-viewport">
    <!-- An unscaled inner viewport keeps the real widgets' geometry calculations intact. -->
    <iframe ref="iframe" :title="t('渲染示例')" tabindex="-1" aria-hidden="true" :style="{ width: `${viewport.width}px`, height: `${viewport.height}px` }" />
    <Teleport v-if="portal" :to="portal"><div ref="content" :style="{ width: `${width}px`, paddingLeft: `${gutter}px`, boxSizing: 'border-box' }"><slot /></div></Teleport>
  </div>
</template>
<style scoped>
.example-viewport { position: relative; width: 100%; height: 104px; overflow: hidden; }
.example-viewport > iframe { position: absolute; top: 0; left: 0; border: 0; transform-origin: top left; }
</style>
