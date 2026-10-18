<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { markdownDiff } from '@tano/markdown';
const props = withDefaults(
  defineProps<{ before: string; after: string; beforeLabel?: string; afterLabel?: string }>(),
  { get beforeLabel() { return t('修改前'); }, get afterLabel() { return t('修改后'); } },
);
const diff = computed(() => markdownDiff(props.before, props.after));
</script>
<template>
  <section class="change-diff" :aria-label="t('修改差异')">
    <div class="diff-summary">
      <span>{{ beforeLabel }} → {{ afterLabel }}</span
      ><span v-if="!diff.limited"
        ><b class="diff-add">+{{ diff.added }}</b> /
        <b class="diff-remove">−{{ diff.removed }}</b></span
      >
    </div>
    <p v-if="diff.limited" class="panel-hint">
      {{ t('内容过大或差异过于复杂，请查看原文。为保持界面响应，此处不展开逐行差异。') }}
    </p>
    <p v-else-if="before === after" class="panel-hint">{{ t('内容相同。') }}</p>
    <div v-else class="diff-lines panel-scrollbar" tabindex="0" :aria-label="t('逐行差异，可滚动')">
      <div v-for="(row, index) in diff.rows" :key="index" class="diff-line" :class="row.kind">
        <span class="diff-number">{{ row.before ?? '' }}</span
        ><span class="diff-number">{{ row.after ?? '' }}</span>
        <span class="diff-sign">{{
          row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''
        }}</span
        ><code>{{ row.text }}</code>
      </div>
    </div>
  </section>
</template>
