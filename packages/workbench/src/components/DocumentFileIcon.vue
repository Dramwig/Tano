<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Bot, FileText, Table2 } from 'lucide-vue-next';
import { isDataTableFilePath } from '@tano/protocol';
import type { FileEntry } from '@tano/protocol';
import WorkspaceIcon from './WorkspaceIcon.vue';

const props = defineProps<{
  file: FileEntry;
  /** Undefined means unopened; an empty string explicitly removes the icon. */
  icon?: string;
  load?: (file: FileEntry, signal: AbortSignal) => Promise<string>;
}>();
const host = ref<HTMLElement>();
const visible = ref(false);
const savedIcon = ref('');
const currentIcon = computed(() => props.icon ?? savedIcon.value);
let observer: IntersectionObserver | undefined;

watch([
  () => props.file.id, () => props.file.path, () => props.file.modified, () => props.file.size,
  () => props.icon, () => props.load, visible,
], async (_, previous, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  if (previous && props.file.id !== previous[0]) savedIcon.value = '';
  if (props.icon !== undefined) { savedIcon.value = props.icon; return; }
  if (!visible.value || !props.load) return;
  try {
    const value = await props.load(props.file, controller.signal);
    if (!controller.signal.aborted) savedIcon.value = value;
  } catch {
    // A failed decorative read must not block navigation or surface a save error.
    if (!controller.signal.aborted) savedIcon.value = '';
  }
}, { immediate: true });

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { visible.value = true; return; }
  observer = new IntersectionObserver(entries => {
    visible.value = entries.some(entry => entry.isIntersecting);
  });
  if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <span ref="host" class="document-file-icon" aria-hidden="true">
    <WorkspaceIcon v-if="currentIcon" :icon="currentIcon" :size="16" />
    <component v-else :is="isDataTableFilePath(file.path) ? Table2 : file.name === 'AGENTS.md' ? Bot : FileText" :size="16" :stroke-width="1.6" />
  </span>
</template>

<style>
.document-file-icon { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 3px; overflow: hidden; }
</style>
