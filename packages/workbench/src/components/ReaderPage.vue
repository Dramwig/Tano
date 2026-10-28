<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{ page: number; width: number; height: number; scale: number; keepMounted?: boolean }>();
const root = ref<HTMLElement>();
const nearby = ref(typeof IntersectionObserver === 'undefined');
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !root.value) return;
  observer = new IntersectionObserver(entries => { nearby.value = entries.some(entry => entry.isIntersecting); }, {
    root: root.value.closest('.reader-viewport'), rootMargin: '600px 0px',
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="reader-page" :data-reader-page="page" :style="{ width: `${width * scale}px`, height: `${height * scale}px` }">
    <slot v-if="nearby || keepMounted" />
  </div>
</template>

<style scoped>
.reader-page { position: relative; flex-shrink: 0; background: #fff; box-shadow: 0 1px 4px #0002, 0 6px 20px #0001; }
</style>
