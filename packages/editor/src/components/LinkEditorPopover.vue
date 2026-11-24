<script setup lang="ts">
import { useEditorWindow } from '../primitives/dom-context';
import { vSurfaceMotion } from '../primitives/surface-motion';
import type { SlashTranslate } from '../plugins/slash-commands';
import type { LinkPanel, LinkPanelField } from '../plugins/link-panel-controller';

const props = defineProps<{
  panel: LinkPanel | null;
  translate?: SlashTranslate;
  setPanelElement: (el: HTMLElement | undefined) => void;
  setFirstInput: (el: HTMLInputElement | undefined) => void;
}>();

const emit = defineEmits<{
  edit: [field: LinkPanelField, event: Event];
  close: [];
}>();

const document = useEditorWindow().document;
const t: SlashTranslate = (message, values = []) =>
  props.translate?.(message, values) ??
  message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token,
  );
</script>

<template>
  <Teleport :to="document.body">
    <div
      v-if="panel"
      v-surface-motion="'MarkdownEditor:1'"
      :ref="(el) => setPanelElement((el as HTMLElement | null) ?? undefined)"
      class="tano-editor-panel tano-link-editor-panel"
      role="group"
      :aria-label="panel.kind === 'wiki' ? t('编辑 Wiki 链接') : t('编辑链接')"
      :style="{ left: `${panel.x}px`, top: `${panel.y}px` }"
      @keydown.esc.prevent.stop="emit('close')"
      @mousedown.stop
      @click.stop
    >
      <template v-if="panel.kind === 'wiki'">
        <label
          >{{ t('目标') }}<input
            :ref="(el) => setFirstInput((el as HTMLInputElement | null) ?? undefined)"
            :value="panel.target"
            :aria-label="t('Wiki 链接目标')"
            @input="emit('edit', 'target', $event)"
        /></label>
        <label
          >{{ t('别名') }}<input
            :value="panel.label"
            :aria-label="t('Wiki 链接别名')"
            :placeholder="t('留空时使用目标名称')"
            @input="emit('edit', 'label', $event)"
        /></label>
      </template>
      <template v-else>
        <label
          >{{ t('文字') }}<input
            :ref="(el) => setFirstInput((el as HTMLInputElement | null) ?? undefined)"
            :value="panel.text"
            :aria-label="t('链接文字')"
            @input="emit('edit', 'text', $event)"
        /></label>
        <label
          >{{ t('地址') }}<input
            :value="panel.href"
            :aria-label="t('链接地址')"
            @input="emit('edit', 'href', $event)"
        /></label>
        <label
          >{{ t('标题') }}<input
            :value="panel.title"
            :aria-label="t('链接标题')"
            :placeholder="t('可选')"
            @input="emit('edit', 'title', $event)"
        /></label>
      </template>
    </div>
  </Teleport>
</template>
