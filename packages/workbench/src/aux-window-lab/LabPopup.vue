<script setup lang="ts">
import MarkdownEditor from '@tano/editor';

/**
 * Content rendered INTO the auxiliary window through <Teleport>. It belongs to
 * the opener's Vue app and shares its reactive state — the model being
 * evaluated for tab tear-off.
 */
const props = defineProps<{ index: number; label: string | null; ownBridge: boolean }>();
const content = defineModel<string>({ required: true });
const emit = defineEmits<{ hostDrag: []; minimize: []; maximize: []; close: []; error: [message: string] }>();
</script>

<template>
  <div class="aux-lab-popup">
    <header class="aux-lab-titlebar">
      <div class="aux-lab-drag aux-lab-drag-native" data-tauri-drag-region :title="props.ownBridge ? '' : '弹窗没有自己的 Tauri 桥接，这里可能拖不动'">
        A · data-tauri-drag-region
      </div>
      <div class="aux-lab-drag" @mousedown.left.prevent="emit('hostDrag')">B · 主窗口调用 startDragging</div>
      <span class="aux-lab-label">{{ props.label ?? '未找到原生窗口' }}</span>
      <button type="button" aria-label="最小化" @click="emit('minimize')">–</button>
      <button type="button" aria-label="最大化" @click="emit('maximize')">□</button>
      <button type="button" aria-label="关闭" @click="emit('close')">×</button>
    </header>
    <main class="aux-lab-body">
      <MarkdownEditor
        v-model="content"
        :document-id="`aux-window-lab-${props.index}`"
        @error="emit('error', $event)"
      />
    </main>
  </div>
</template>

<style>
.aux-window-root { height: 100vh; }
.aux-lab-popup { display: flex; flex-direction: column; height: 100%; background: var(--paper); color: var(--text); }
.aux-lab-titlebar {
  display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 6px 0 8px;
  border-bottom: 1px solid var(--line); background: var(--surface); user-select: none; font-size: 12px;
}
.aux-lab-drag {
  flex: 1; height: 26px; display: flex; align-items: center; padding: 0 8px;
  border: 1px dashed var(--line); border-radius: 6px; color: var(--muted); cursor: grab;
}
.aux-lab-label { color: var(--text-secondary); font-family: var(--font-mono); }
.aux-lab-titlebar button {
  width: 30px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font-size: 14px;
}
.aux-lab-titlebar button:hover { background: var(--hover); }
.aux-lab-body { flex: 1; overflow: auto; padding: 24px 32px; }
</style>
