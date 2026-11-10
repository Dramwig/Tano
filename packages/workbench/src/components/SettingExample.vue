<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { settingExamples, type SettingExampleKey } from '../setting-examples';
import { defaultCapabilities } from '@tano/editor/runtime';
import { defaultSelectionContext } from '@tano/editor/selection-context';
import type { CommentThread } from '@tano/protocol';
import { blockPreviewMarkdown } from '../preview-samples';
import RenderedExample from './RenderedExample.vue';
import SourceExample from './SourceExample.vue';
import ExampleViewport from './ExampleViewport.vue';
import EditorToolbar from './EditorToolbar.vue';
import DocumentTitle from './DocumentTitle.vue';
import DocumentOutline from './DocumentOutline.vue';
import DocumentDiscussionHeader from './DocumentDiscussionHeader.vue';
import CommentConversation from './CommentConversation.vue';
import InlineAssistantInput from './InlineAssistantInput.vue';
const props = defineProps<{ setting: SettingExampleKey }>();
const example = computed(() => settingExamples[props.setting]);
const document = computed(() => `## ${t('海边两日游')}\n\n${t('沿着海岸散步。')}`);
const outlineDocument = computed(() => `## ${t('行程')}\n\n${t('沿着海岸散步。')}\n\n## ${t('预算')}\n\n¥180`);
const foldDocument = computed(() => `## ${t('出行清单')}\n\n${blockPreviewMarkdown('list')}\n\n## ${t('海边两日游')}`);
const source = computed(() => blockPreviewMarkdown(example.value.scene === 'mermaid' ? 'mermaid' : 'math-block'));
const propertyDocument = computed(() => `---\ntags: [${JSON.stringify(t('旅行'))}]\ncreated: 2026-11-06\n---\n\n${t('沿着海岸散步。')}`);
const syntax = ['$$\nE = mc^2\n$$', '\\[\nE = mc^2\n\\]'];
const listSource = computed(() => [`- ${t('相机')}\n- ${t('雨伞')}`, `* ${t('相机')}\n* ${t('雨伞')}`]);
const toolbarContext = { ...defaultSelectionContext, level: 'inline' as const, textSelected: true, canStyleText: true };
const noMath = { ...defaultCapabilities, features: { ...defaultCapabilities.features, math: false } };
const outline = computed(() => [t('行程'), t('预算')].map((text, index) => ({ heading: { level: 2, text }, index })));
const thread = computed<CommentThread>(() => ({ id: 'preview-thread', resolved: false, detached: false, createdAt: Date.now(),
  messages: [{ id: 'preview-message', authorId: 'preview-author', authorName: 'Lin', body: t('记得带相机。'), createdAt: Date.now() }] }));
const assistantAnchor = { element: globalThis.document.createElement('div'), getRects: () => [], dispose: () => {} };
const noRename = async () => {};
const phaseLabels = computed(() => {
  switch (example.value.scene) {
    case 'mode': return [t('Markdown 源码'), t('可视化编辑')];
    case 'copy': return [t('Markdown 源码'), t('富文本')];
    case 'reveal': return [t('光标进入'), t('光标离开')];
    case 'math': case 'mermaid': return [t('编辑源码'), t('同步预览')];
    case 'folding': return [t('展开'), t('收起')];
    case 'toolbar': return [t('随选区显示'), t('固定在顶部')];
    case 'wrapping': return [t('选中文字'), t('输入符号')];
    case 'math-syntax': return [t('美元符号'), t('反斜杠括号')];
    case 'bullet': return ['- →', '* →'];
    case 'outline-position': return [t('右侧'), t('左侧')];
    case 'recognition': return [t('普通文本'), t('识别为公式')];
    default: return [t('关闭时'), t('开启时')];
  }
});

</script>
<template>
  <div class="setting-example" :data-setting="setting" :data-scene="example.scene">
    <div class="setting-example-stage" aria-hidden="true" inert>
      <div class="demo-phase"><span class="demo-before">{{ phaseLabels[0] }}</span><span class="demo-after">{{ phaseLabels[1] }}</span></div>
      <ExampleViewport :width="['toolbar', 'outline', 'outline-position', 'discussion'].includes(example.scene) ? 420 : 320" :gutter="example.scene === 'folding' ? 24 : 0">
        <div v-if="example.scene === 'math' || example.scene === 'mermaid'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="source" :source="example.scene" :live-preview="false" />
          <RenderedExample class="demo-after" :markdown="source" :source="example.scene" live-preview />
        </div>
        <div v-else-if="['mode', 'copy'].includes(example.scene)" class="demo-crossfade">
          <SourceExample class="demo-before" :markdown="document" /><RenderedExample class="demo-after" :markdown="document" />
        </div>
        <div v-else-if="example.scene === 'reveal'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="document" reveal /><RenderedExample class="demo-after" :markdown="document" />
        </div>
        <div v-else-if="example.scene === 'folding'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="foldDocument" :folded="false" />
          <RenderedExample class="demo-after" :markdown="foldDocument" folded />
        </div>
        <div v-else-if="example.scene === 'toolbar'" class="demo-crossfade">
          <div class="demo-before actual-floating-toolbar"><RenderedExample :markdown="document" /><EditorToolbar :context="toolbarContext" compact compact-actions assistant /></div>
          <div class="demo-after"><EditorToolbar :context="toolbarContext" compact-actions assistant /><RenderedExample :markdown="document" /></div>
        </div>
        <div v-else-if="example.scene === 'wrapping'" class="demo-crossfade">
          <SourceExample class="demo-before" :markdown="t('海边两日游')" /><SourceExample class="demo-after" :markdown="`*${t('海边两日游')}*`" />
        </div>
        <div v-else-if="example.scene === 'spacing'" class="demo-crossfade">
          <RenderedExample class="demo-before" markdown="用Tano记录2026年的旅行" :preferences="{ autoSpacing: false }" />
          <RenderedExample class="demo-after" markdown="用Tano记录2026年的旅行" :preferences="{ autoSpacing: true }" />
        </div>
        <div v-else-if="example.scene === 'ai'" class="demo-crossfade">
          <div class="demo-before"><RenderedExample markdown="" /><kbd>space</kbd></div>
          <div class="demo-after"><InlineAssistantInput embedded :anchor="assistantAnchor" state="input" :value="t('帮我整理旅行计划。')" /></div>
        </div>
        <div v-else-if="example.scene === 'recognition'" class="demo-crossfade">
          <RenderedExample class="demo-before" markdown="$E = mc^2$" :capabilities="noMath" />
          <RenderedExample class="demo-after" markdown="$E = mc^2$" />
        </div>
        <div v-else-if="example.scene === 'math-syntax'" class="demo-crossfade">
          <div v-for="(text, index) in syntax" :key="index" :class="index ? 'demo-after' : 'demo-before'"><SourceExample :markdown="text" /><RenderedExample :markdown="text" /></div>
        </div>
        <div v-else-if="example.scene === 'bullet'" class="demo-crossfade">
          <div v-for="(text, index) in listSource" :key="index" :class="index ? 'demo-after' : 'demo-before'"><SourceExample :markdown="text" /><RenderedExample :markdown="text" /></div>
        </div>
        <div v-else-if="['outline', 'outline-position'].includes(example.scene)" class="demo-crossfade">
          <div class="demo-before actual-outline-page"><RenderedExample :markdown="outlineDocument" /><DocumentOutline v-if="example.scene === 'outline-position'" :items="outline" :active-index="0" has-headings /></div>
          <div class="demo-after actual-outline-page"><DocumentOutline :items="outline" :active-index="0" has-headings /><RenderedExample :markdown="outlineDocument" /></div>
        </div>
        <div v-else-if="example.scene === 'properties'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="propertyDocument" /><RenderedExample class="demo-after" :markdown="propertyDocument" properties />
        </div>
        <div v-else-if="example.scene === 'title'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="t('沿着海岸散步。')" />
          <div class="demo-after actual-page-title"><DocumentTitle workspace-id="preview" document-id="a00001" :path="`${t('海边两日游')}.md`" :files="[]" readonly :rename="noRename" /><RenderedExample :markdown="t('沿着海岸散步。')" /></div>
        </div>
        <div v-else-if="example.scene === 'discussion'" class="demo-crossfade">
          <RenderedExample class="demo-before" :markdown="t('沿着海岸散步。')" />
          <div class="demo-after"><RenderedExample :markdown="t('沿着海岸散步。')" /><div class="actual-discussion"><DocumentDiscussionHeader :count="1" /><CommentConversation :thread="thread" readonly :busy="false" author-id="preview-reader" author-name="Reader" /></div></div>
        </div>
      </ExampleViewport>
    </div>
    <span class="setting-example-description">{{ t(example.description) }}</span>
  </div>
</template>
<style scoped>
.setting-example { display: grid; gap: 8px; width: 224px; max-width: 100%; white-space: normal; }
.setting-example-stage { padding: 8px; border-radius: 5px; background: var(--paper); color: var(--text); pointer-events: none; user-select: none; }
.demo-phase { display: grid; margin-bottom: 6px; color: var(--muted); font-size: 10px; line-height: 14px; }
.demo-phase > *, .demo-crossfade > .demo-before, .demo-crossfade > .demo-after { grid-area: 1 / 1; }
.demo-before { animation: setting-demo-before 5s ease-in-out infinite; }
.demo-after { animation: setting-demo-after 5s ease-in-out infinite; }
.demo-crossfade { display: grid; }
.actual-floating-toolbar { position: relative; padding-top: 54px; }
.actual-floating-toolbar > :deep(.contextual-toolbar) { position: absolute; top: 0; left: 8px; }
.actual-outline-page { display: flex; gap: 24px; align-items: flex-start; }
.actual-outline-page > .rendered-example { flex: 1; min-width: 0; }
.actual-outline-page > :deep(.outline) { flex: 0 0 120px; min-width: 0; }
.actual-page-title > :deep(.document-title) { margin: 0 0 16px; padding: 0; }
.actual-discussion { margin-top: 24px; }
.setting-example-description { color: #eee; font-size: 12px; line-height: 1.5; }
@keyframes setting-demo-before { 0%, 38%, 100% { opacity: 0; } 48%, 90% { opacity: 1; } }
@keyframes setting-demo-after { 0%, 38%, 100% { opacity: 1; } 48%, 90% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .demo-before { display: none; animation: none; } .demo-after { opacity: 1; animation: none; } }
@media (forced-colors: active) { .setting-example-description { color: CanvasText; } }
</style>
