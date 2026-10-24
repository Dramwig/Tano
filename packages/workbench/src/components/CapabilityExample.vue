<script setup lang="ts">
import { t } from '../i18n';
import type { DocumentFeature } from '@tano/editor/runtime';
defineProps<{ feature: DocumentFeature }>();
</script>

<template>
  <div class="capability-example" :data-feature="feature">
    <span class="example-caption">{{ t('渲染示例') }}</span>


    <div class="example-rendered">
      <span v-if="feature === 'objectReferences'" class="example-reference">↗ {{ t('文档') }}</span>
      <span v-else-if="feature === 'math'" class="example-math"><i>E</i> = <i>mc</i><sup>2</sup></span>
      <div v-else-if="feature === 'mermaid'" class="example-diagram"><span>{{ t('开始') }}</span><span aria-hidden="true">→</span><span>{{ t('完成') }}</span></div>
      <span v-else-if="feature === 'wikiLink'" class="example-link">{{ t('文档') }}</span>
      <div v-else-if="feature === 'callout'" class="example-callout"><strong>ⓘ {{ t('提示') }}</strong><div>{{ t('文字') }}</div></div>
      <div v-else-if="feature === 'footnotes'">{{ t('文字') }}<sup class="example-link">1</sup><div class="example-footnote">1. {{ t('注释') }}</div></div>
      <div v-else-if="feature === 'embed'" class="example-document"><span>PDF · guide.pdf</span><strong>{{ t('文档') }}</strong><span class="example-document-line" /><span class="example-document-line short" /></div>
      <strong v-else-if="feature === 'html'">{{ t('文字') }}</strong>
      <div v-else-if="feature === 'enhanced'" class="example-details"><strong>▾ {{ t('文档') }}</strong><div>{{ t('文字') }}</div></div>
      <span v-else-if="feature === 'superscript'">x<sup>2</sup></span>
      <span v-else-if="feature === 'subscript'">H<sub>2</sub>O</span>
      <u v-else-if="feature === 'underline'">{{ t('文字') }}</u>
      <mark v-else-if="feature === 'highlight'">{{ t('文字') }}</mark>
      <span v-else-if="feature === 'inlineComment'" class="example-comment">{{ t('注释') }}</span>
    </div>
  </div>
</template>

<style scoped>
.capability-example { display: grid; gap: 6px; width: 260px; max-width: 100%; white-space: normal; }
.example-caption { color: #b8b8b8; font-size: 11px; }
.example-rendered { padding: 10px; border: 1px solid #ffffff26; border-radius: 4px; line-height: 1.6; }
.example-link { color: #a4d7ff; text-decoration: underline; }
.example-reference { padding: 2px 6px; border-radius: 4px; background: #ffffff12; color: #a4d7ff; }
.example-math { font-family: Georgia, serif; font-size: 18px; }
.example-diagram { display: flex; align-items: center; justify-content: center; gap: 12px; }
.example-diagram > span:not([aria-hidden]) { padding: 4px 12px; border: 1px solid #a9c5bc; border-radius: 4px; background: #88b5a51a; }
.example-callout { border-left: 3px solid #91c4ec; padding-left: 8px; }
.example-footnote { border-top: 1px solid #ffffff26; margin-top: 8px; padding-top: 5px; color: #ccc; }
.example-document { display: grid; gap: 6px; }
.example-document > span:first-child { font-size: 10px; color: #bbb; }
.example-document-line { height: 3px; background: #ffffff26; width: 90%; }
.example-document-line.short { width: 65%; }
.example-details > div { padding-left: 14px; }
mark { background: #ffe58a; color: #292929; padding: 0 2px; }
.example-comment { color: #aaa; text-decoration: line-through; }
@media (forced-colors: active) {
  .example-caption { color: CanvasText; }
  .example-link, .example-reference, .example-comment { color: CanvasText; }
  .example-rendered { border-color: CanvasText; }
}
</style>
