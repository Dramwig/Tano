<script setup lang="ts">
import { ref } from 'vue';
import DocumentScrollbar from './DocumentScrollbar.vue';
import DocumentTitle from './DocumentTitle.vue';
import MarkdownEditorSkeleton from './MarkdownEditorSkeleton.vue';
import { t } from '../i18n';
defineProps<{ unlimited?: boolean; touch?: boolean }>();
const scroll = ref<HTMLElement>();
const rename = async () => {};
</script>

<template>
  <div class="document-scroll-shell document-loading" role="status" aria-busy="true" :aria-label="t('正在加载…')">
    <div ref="scroll" class="document-layout">
      <main class="document-main">
        <div class="editor-scroll" :class="{ 'width-unlimited': unlimited }">
          <DocumentTitle loading workspace-id="" document-id="" path="" :files="[]" readonly :rename="rename" />
          <MarkdownEditorSkeleton model-value="" />
        </div>
      </main>
    </div>
    <DocumentScrollbar v-if="!touch" :scroll-element="scroll" />
  </div>
</template>
