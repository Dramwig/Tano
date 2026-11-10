<script setup lang="ts">
import { computed } from 'vue';
import RenderedExample from './RenderedExample.vue';
import ExampleViewport from './ExampleViewport.vue';
import { blockPreviewMarkdown } from '../preview-samples';
import { t } from '../i18n';

const props = defineProps<{ command: string; value?: string; label: string }>();
const headingLevel = computed(() => Math.max(1, Math.min(4, Number(props.value) || 1)));
const markdown = computed(() => blockPreviewMarkdown(props.command, props.value));
const description = computed(() => {
  if (props.command === 'heading') return [
    t('用大标题开启新的篇章。'), t('用中标题划分内容章节。'),
    t('用小标题组织章节内的内容。'), t('用更小的标题标记细分内容。'),
  ][headingLevel.value - 1];
  if (props.command === 'callout' && props.value === 'CUSTOM')
    return t('用自选图标突出一段内容。');
  const descriptions: Record<string, string> = {
    paragraph: t('用段落记录想法和正文内容。'),
    'object-reference': t('插入对象或文档卡片，方便查看和跳转。'),
    quote: t('突出引用的文字或一段摘录。'),
    list: t('创建简单的项目符号列表。'),
    'ordered-list': t('按顺序列出步骤或要点。'),
    'todo-list': t('添加可勾选的待办事项。'),
    'code-block': t('用代码块展示代码或命令。'),
    image: t('插入图片，让内容更直观。'),
    table: t('用行和列整理数据。'),
    mermaid: t('用 Mermaid 绘制流程图等图表。'),
    callout: t('突出提示、说明等重要内容。'),
    toggle: t('将详细内容收进可展开的折叠块。'),
    file: t('插入附件卡片，方便打开文件。'),
    embed: t('在页面中预览图片、音频或视频。'),
    tabs: t('用标签页分组展示内容。'),
    columns: t('将内容并排放在多栏中。'),
    'horizontal-rule': t('用分隔线区分不同主题。'),
    'math-block': t('用 LaTeX 排版独立的数学公式。'),
  };
  return descriptions[props.command] ?? props.label;
});
</script>

<template>
  <div class="block-example" :data-command="command" :data-value="value">
    <div v-if="command === 'table'" class="block-example-rendered is-table"><ExampleViewport :width="400"><RenderedExample :markdown="markdown" /></ExampleViewport></div>
    <div v-else class="block-example-rendered"><RenderedExample :markdown="markdown" /></div>
    <span class="block-example-description">{{ description }}</span>
  </div>
</template>

<style scoped>
.block-example {
  --block-example-scale: 0.8;
  --block-example-width: 240px;
  display: grid; gap: 7px;
  width: calc(var(--block-example-width) * var(--block-example-scale));
  max-width: 100%; white-space: normal;
}
.block-example-rendered {
  width: var(--block-example-width); max-width: calc(100% / var(--block-example-scale));
  zoom: var(--block-example-scale); padding: 16px; border-radius: 4px;
  background: var(--paper); color: var(--text); pointer-events: none; user-select: none;
}
/* Keep the real table's column measurements intact before shrinking the viewport. */
.block-example-rendered.is-table { width: 192px; zoom: 1; padding: 8px; }
.block-example-description { color: #eee; font-size: 12px; line-height: 1.5; }
@media (forced-colors: active) { .block-example-description { color: CanvasText; } }
</style>
