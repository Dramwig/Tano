<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import type { DocumentFeature } from '@tano/editor/runtime';

const props = defineProps<{ feature: DocumentFeature }>();
const source = computed(() => {
  const text = t('文字'), document = t('文档');
  const examples: Record<DocumentFeature, string> = {
    objectReferences: `[${document}](object://document/Ab3dE5gH)`,
    math: '$E = mc^2$',
    mermaid: `\`\`\`mermaid\nflowchart LR\n  A[${t('开始')}] --> B[${t('完成')}]\n\`\`\``,
    wikiLink: `[[${document}]]`,
    callout: `> [!NOTE]\n> ${text}`,
    footnotes: `${text}[^1]\n\n[^1]: ${t('注释')}`,
    embed: `:::embed\n\n[${document}](assets/guide.pdf)\n\n:::`,
    html: `<strong>${text}</strong>`,
    enhanced: `<details>\n<summary>${document}</summary>\n\n${text}\n\n</details>`,
    superscript: 'x^2^', subscript: 'H~2~O', underline: `++${text}++`,
    highlight: `==${text}==`, inlineComment: `%%${t('注释')}%%`,
  };
  return examples[props.feature];
});
</script>
<template>
  <code class="capability-syntax" :aria-label="t('语法示例')">{{ source.replace(/\n+/g, ' ↵ ') }}</code>
</template>

<style scoped>
.capability-syntax {
  display: block;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--surface);
  color: var(--green);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.6;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
