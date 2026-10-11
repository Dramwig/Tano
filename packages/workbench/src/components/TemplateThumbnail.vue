<script setup lang="ts">
import { computed } from 'vue';
import { Check, Square } from 'lucide-vue-next';
import type { DocumentTemplate } from '../workspace-templates';
import { templateInfo, templatePreview } from '../template-catalog';
import { templateStarterBody } from '../document-starters';
const props = defineProps<{ template: DocumentTemplate }>();
const lines = computed(() => {
  try {
    return templateStarterBody(templatePreview(props.template)).split('\n').filter(line => line.trim() && !/^\|[\s:|-]+\|$/.test(line)).slice(0, 11).map(line => ({
      heading: /^#{1,6} /.test(line), task: /^- \[[ xX]\]/.test(line), checked: /^- \[[xX]\]/.test(line),
      cells: /^\|.+\|$/.test(line) ? line.slice(1, -1).split('|').map(cell => cell.trim()) : null,
      text: line.replace(/^#{1,6} |^- \[[ xX]\] ?|^[-*] /g, '').replace(/\*\*|__/g, ''),
    }));
  } catch { return []; }
});
</script>
<template>
  <div class="template-thumbnail" :class="`tone-${templateInfo(template).tone}`" aria-hidden="true">
    <div class="template-mini-page">
      <strong>{{ template.name }}</strong>
      <div v-for="(line, index) in lines" :key="index" class="template-mini-line" :class="{ 'is-heading': line.heading, 'is-task': line.task }">
        <div v-if="line.cells" class="template-mini-table"><span v-for="(cell, cellIndex) in line.cells" :key="cellIndex">{{ cell }}</span></div>
        <template v-else><component :is="line.checked ? Check : Square" v-if="line.task" :size="12" />{{ line.text }}</template>
      </div>
    </div>
  </div>
</template>
<style scoped>
.template-thumbnail { --template-tint: #9db7a8; aspect-ratio: 1.6; padding: 19px 23px 0; overflow: hidden; border: 1px solid color-mix(in srgb, var(--text) 3%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--template-tint) 15%, var(--paper)); }
.tone-blue { --template-tint: #9aadc2; } .tone-sand { --template-tint: #d7c5a2; } .tone-lavender { --template-tint: #b2a8c3; }
.template-mini-page { width: 160%; min-height: 390px; padding: 29px 30px; transform: scale(.625); transform-origin: top left; background: var(--paper); color: var(--text-secondary); border: 0; border-radius: 2px 2px 0 0; box-shadow: 0 4px 14px #00000004; }
.template-mini-page > strong { display: block; color: var(--text); font-size: 22px; line-height: 30px; margin-bottom: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.template-mini-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 21px; min-height: 21px; }
.template-mini-line.is-heading { color: var(--text); font-size: 14px; font-weight: 600; margin-top: 20px; margin-bottom: 5px; }
.template-mini-line.is-task { display: flex; align-items: center; gap: 5px; }
.template-mini-line svg { flex-shrink: 0; }
.template-mini-table { display: flex; border-top: 1px solid var(--line); border-left: 1px solid var(--line); font-size: 10px; }
.template-mini-table span { flex: 1; min-width: 0; padding: 0 5px; border-right: 1px solid var(--line); overflow: hidden; text-overflow: ellipsis; }
</style>
