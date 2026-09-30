<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Type,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  Code,
  Highlighter,
  Ellipsis,
} from 'lucide-vue-next';

const props = defineProps<{ disabled?: boolean; more?: boolean; hideFormats?: boolean; dragging?: boolean }>();
const emit = defineEmits<{ format: [command: string, value?: string] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
watch(() => props.dragging, () => { open.value = false; });
const styles = [
  { command: 'underline', name: '下划线', icon: Underline },
  { command: 'strikethrough', name: '删除线', icon: Strikethrough },
  { command: 'superscript', name: '上标', icon: Superscript },
  { command: 'subscript', name: '下标', icon: Subscript },
  { command: 'code', name: '行内代码', icon: Code },
  { command: 'highlight', name: '高亮', icon: Highlighter },
];
const colors = [
  { name: '红色', value: '#dc2626' },
  { name: '橙色', value: '#c2410c' },
  { name: '绿色', value: '#15803d' },
  { name: '蓝色', value: '#2563eb' },
  { name: '紫色', value: '#7c3aed' },
  { name: '粉色', value: '#db2777' },
];
function format(command: string, value?: string) {
  open.value = false;
  emit('format', command, value);
}
function closeOutside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
function escape() {
  open.value = false;
  trigger.value?.focus();
}
onMounted(() => window.addEventListener('click', closeOutside));
onBeforeUnmount(() => window.removeEventListener('click', closeOutside));
</script>

<template>
  <div ref="root" class="menu-wrap" @keydown.esc.stop.prevent="escape">
    <button
      ref="trigger"
      class="icon-button"
      :aria-label="more ? '更多格式' : '文字样式'"
      :title="more ? '更多格式' : '文字样式与颜色'"
      :aria-expanded="open && (!disabled || !!$slots.preferences)"
      :disabled="disabled && !$slots.preferences"
      @mousedown.prevent
      @click="open = !open"
    >
      <Ellipsis v-if="more" :size="17" /><Type v-else :size="17" />
    </button>
    <div v-if="open && (!disabled || $slots.preferences)" class="dropdown text-style-dropdown">
      <template v-if="!hideFormats">
        <div class="text-style-grid">
          <button
            v-for="style in styles"
            :key="style.command"
            :disabled="disabled"
            @mousedown.prevent
            @click="format(style.command)"
          >
            <component :is="style.icon" :size="16" />{{ style.name }}
          </button>
        </div>
        <div class="text-style-label">文字颜色</div>
        <div class="text-color-grid">
          <button
            v-for="color in colors"
            :key="color.value"
            :disabled="disabled"
            :aria-label="`${color.name}文字`"
            :title="color.name"
            @mousedown.prevent
            @click="format('text-color', color.value)"
          >
            <span class="text-color-swatch" :style="{ backgroundColor: color.value }" />
          </button>
        </div>
        <button :disabled="disabled" @mousedown.prevent @click="format('text-color')">
          恢复默认文字颜色
        </button>
      </template>
      <div v-if="$slots.extra" class="extra-formats" @click="open = false">
        <slot name="extra" />
      </div>
      <div v-if="$slots.preferences" @click="open = false">
        <div v-if="!hideFormats || $slots.extra" class="menu-divider" role="separator" />
        <slot name="preferences" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-style-dropdown {
  top: calc(100% + 6px);
  left: 0;
  width: 226px;
}
.text-style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.text-style-label {
  margin: 6px 4px 0;
  padding: 10px 6px 4px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.text-color-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  margin: 2px 4px 4px;
}
.text-color-grid button {
  justify-content: center;
  padding: 7px;
}
.text-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}
@media (max-width: 700px) {
  .text-style-dropdown {
    left: 50%;
    transform: translateX(-50%);
  }
}
</style>
