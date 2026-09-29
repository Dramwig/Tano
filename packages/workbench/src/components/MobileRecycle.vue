<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, X, RotateCcw } from 'lucide-vue-next';
import { useWorkspaceStore } from '../stores/workspace';
const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore();
const records = ref<{ id: string; path: string; deletedAt: number }[]>([]);
const error = ref(''),
  notice = ref(''),
  busy = ref(false);
const closeButton = ref<HTMLButtonElement>();
let disposed = false;
const originalFocus = document.activeElement as HTMLElement | null;
function trap(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const buttons = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ),
  ];
  const first = buttons[0],
    last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
async function recover(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const path = await invoke<string>('mobile_recover', { workspaceId: props.workspaceId, id });
    if (disposed) return;
    notice.value = `已恢复副本：${path}`;
    if (store.workspace?.id === props.workspaceId) await store.refresh();
  } catch (reason) {
    if (!disposed) error.value = String(reason);
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  closeButton.value?.focus();
  try {
    const result = await invoke<typeof records.value>('mobile_recycled', {
      workspaceId: props.workspaceId,
    });
    if (!disposed) records.value = result;
  } catch (reason) {
    if (!disposed) error.value = String(reason);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  originalFocus?.focus();
});
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <section
      class="modal mobile-recycle"
      role="dialog"
      aria-modal="true"
      aria-label="手机回收站"
      @keydown.esc.stop="emit('close')"
      @keydown="trap"
    >
      <header>
        <h2><Trash2 :size="20" />手机回收站</h2>
        <button
          ref="closeButton"
          class="icon-button"
          aria-label="关闭回收站"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <p>本机移除的文件保留在这里。恢复会在当前空间创建新副本；卸载应用会移除这些本地数据。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <div v-for="item in records" :key="item.id" class="recycle-entry">
        <span
          >{{ item.path }}<small>{{ new Date(item.deletedAt).toLocaleString() }}</small></span
        ><button class="secondary-button" :disabled="busy" @click="recover(item.id)">
          <RotateCcw :size="15" />恢复副本
        </button>
      </div>
      <p v-if="!records.length && !error">暂无本机回收文件</p>
    </section>
  </div>
</template>
<style scoped>
.mobile-recycle {
  width: min(680px, calc(100vw - 24px));
  max-height: 85dvh;
  overflow: auto;
}
h2,
.recycle-entry,
.recycle-entry button {
  display: flex;
  align-items: center;
  gap: 10px;
}
p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.recycle-entry {
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.recycle-entry span {
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}
</style>
