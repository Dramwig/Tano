<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CalendarDays, GitFork, Puzzle, X } from 'lucide-vue-next';
import type { ReferenceIdentity } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import PluginInstaller from './PluginInstaller.vue';
import RelationsPanel from './RelationsPanel.vue';
import CalendarPanel from './CalendarPanel.vue';
import '../workspace-tools.css';
export type WorkspaceTool = 'plugins' | 'relations' | 'calendar';
const props = defineProps<{ open: boolean; tab: WorkspaceTool }>();
const emit = defineEmits<{
  close: [];
  tab: [value: WorkspaceTool];
  objects: [];
  openObject: [value: ReferenceIdentity];
}>();
const store = useWorkspaceStore();
const panel = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
function keepFocus(event: FocusEvent) {
  if (
    props.open &&
    panel.value &&
    event.target instanceof Node &&
    !panel.value.contains(event.target)
  )
    panel.value.focus();
}
onMounted(() => document.addEventListener('focusin', keepFocus));
onBeforeUnmount(() => document.removeEventListener('focusin', keepFocus));
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement;
      await nextTick();
      panel.value?.focus();
    } else if (previousFocus?.isConnected) previousFocus.focus();
  },
  { immediate: true },
);
function trap(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return;
  const elements = [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
    ),
  ].filter((element) => element.getClientRects().length);
  const first = elements[0],
    last = elements.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<template>
  <div v-show="open" class="workspace-tools-backdrop" @click.self="emit('close')">
    <section
      ref="panel"
      class="workspace-tools"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-tools-title"
      tabindex="-1"
      @keydown.esc.prevent.stop="emit('close')"
      @keydown="trap"
    >
      <header class="workspace-tools-header">
        <div>
          <h2 id="workspace-tools-title">
            {{ tab === 'plugins' ? '插件安装器' : tab === 'relations' ? '关系引擎' : '日历视图' }}
          </h2>
          <span class="tool-badge">Level 2 · {{ store.workspace?.name }}</span>
        </div>
        <button class="tool-icon" aria-label="关闭工作区工具" @click="emit('close')">
          <X :size="20" />
        </button>
      </header>
      <nav class="workspace-tools-tabs" aria-label="工作区工具">
        <button
          :aria-current="tab === 'plugins' ? 'page' : undefined"
          @click="emit('tab', 'plugins')"
        >
          <Puzzle :size="17" />插件</button
        ><button
          :aria-current="tab === 'relations' ? 'page' : undefined"
          @click="emit('tab', 'relations')"
        >
          <GitFork :size="17" />关系</button
        ><button
          :aria-current="tab === 'calendar' ? 'page' : undefined"
          @click="emit('tab', 'calendar')"
        >
          <CalendarDays :size="17" />日历
        </button>
      </nav>
      <p v-if="!store.capabilities.features.objectReferences" class="tool-level-notice">
        Level 2 已关闭，关系和日历暂时只读。可在工作区设置中重新启用。
      </p>
      <p v-else-if="store.workspace?.readOnly" class="tool-level-notice">
        此工作区为只读，无法修改对象和关系。
      </p>
      <div class="workspace-tools-body">
        <PluginInstaller v-show="tab === 'plugins'" @objects="emit('objects')" />
        <RelationsPanel
          v-show="tab === 'relations'"
          @objects="emit('objects')"
          @open-object="emit('openObject', $event)"
        />
        <CalendarPanel v-show="tab === 'calendar'" />
      </div>
    </section>
  </div>
</template>
