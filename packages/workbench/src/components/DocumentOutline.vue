<script setup lang="ts">
import { t } from '../i18n';
import { vScrollFade } from '../scroll-fade';
defineProps<{ items: readonly { heading: { level: number; text: string }; index: number }[]; activeIndex: number; hasHeadings: boolean }>();
const emit = defineEmits<{ select: [index: number] }>();
</script>
<template>
  <nav v-scroll-fade class="outline" :aria-label="t('文档大纲')">
    <button v-for="{ heading, index } in items" :key="index" :class="{ 'outline-active': activeIndex === index }"
      :style="{ '--outline-indent': `${Math.max(0, heading.level - 1) * 12}px`, '--outline-marker-width': `${Math.max(9, 20 - heading.level * 2)}px` }"
      :aria-label="t('跳转到{0}', [heading.text])" :aria-current="activeIndex === index ? 'location' : undefined" @click="emit('select', index)">
      <span class="outline-marker" aria-hidden="true" /><span class="outline-text">{{ heading.text }}</span>
    </button>
    <p v-if="!hasHeadings" class="panel-empty"><span class="outline-empty-marker" aria-hidden="true" />{{ t('写下一个标题，') }}<br />{{ t('让思路有迹可循。') }}</p>
    <p v-else-if="!items.length" class="outline-no-results" role="status">{{ t('没有匹配的标题') }}</p>
  </nav>
</template>
