<script setup lang="ts">
import { computed } from 'vue';
import { splitFrontmatter } from '@tano/editor/syntax';
import { frontmatterProperties } from '@tano/editor/frontmatter-display';
import { t } from '../i18n';
import '../loading-skeleton.css';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ modelValue: string; showDocumentProperties?: boolean }>(), { showDocumentProperties: true });
const markdown = computed(() => splitFrontmatter(props.modelValue));
const hasProperties = computed(() => {
  if (!props.showDocumentProperties || !markdown.value.prefix) return false;
  const properties = frontmatterProperties(markdown.value.prefix);
  return properties === null || properties.length > 0;
});
const firstBlock = computed(() => {
  const heading = markdown.value.body.trimStart().match(/^(#{1,6})[ \t]+([^\r\n]+)/);
  return heading ? { tag: `h${heading[1]!.length}`, text: heading[2]!.replace(/[ \t]+#+[ \t]*$/, '') } : { tag: 'p', text: '' };
});
</script>

<template>
  <!-- These are siblings, just like MarkdownEditor: title spacing depends on
       whether the immediately following element is the properties panel. -->
  <div v-if="hasProperties" class="frontmatter-panel" aria-hidden="true">
    <div class="frontmatter-heading"><span class="tano-skeleton-bar" style="width: 80px" /></div>
  </div>
  <div class="milkdown-host markdown-editor-skeleton" role="status" aria-busy="true" :aria-label="t('正在加载…')">
    <div class="tano-prose" aria-hidden="true">
      <component :is="firstBlock.tag" class="skeleton-first-block">
        <span v-if="firstBlock.text" class="skeleton-heading-mirror">{{ firstBlock.text }}</span>
        <span class="tano-skeleton-bar" :class="{ 'skeleton-heading-bar': firstBlock.text }" />
      </component>
      <p v-for="row in 6" :key="row"><span class="tano-skeleton-bar" /></p>
    </div>
  </div>
</template>

<style scoped>
.tano-skeleton-bar { display: inline-block; vertical-align: baseline; width: 100%; height: .75em; }
:is(h1, h2, h3, h4, h5, h6) .tano-skeleton-bar { width: 45%; }
.skeleton-first-block { position: relative; }
.skeleton-heading-mirror { visibility: hidden; }
.skeleton-heading-bar { position: absolute; top: .25em; left: var(--tano-block-padding-inline, 8px); }
p:last-child .tano-skeleton-bar { width: 65%; }
</style>
