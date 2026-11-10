<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import MarkdownEditor from '@tano/editor';
import { prepareEditorPreview } from '@tano/editor/preview';
import { defaultCapabilities, defaultEditorPreferences, type EditorPreferences, type WorkspaceCapabilities } from '@tano/editor/runtime';
import { previewResource, previewTargets } from '../preview-samples';
import { t } from '../i18n';
import CalloutIconPicker from './CalloutIconPicker.vue';

const props = defineProps<{
  markdown: string; properties?: boolean; source?: 'math' | 'mermaid'; livePreview?: boolean;
  reveal?: boolean; folded?: boolean; editable?: boolean; preferences?: Partial<EditorPreferences>; capabilities?: WorkspaceCapabilities;
}>();
const editor = ref<InstanceType<typeof MarkdownEditor>>();
const host = ref<HTMLElement>();
const id = useId();
const ready = ref(false);
let observer: MutationObserver | undefined;
let sizing: ResizeObserver | undefined;
function popupSize() {
  const popup = host.value?.querySelector<HTMLElement>('.tano-live-math-preview, .tano-live-mermaid-preview');
  const height = popup && !popup.hidden ? popup.offsetHeight + 6 : 0;
  host.value?.style.setProperty('--preview-popup-height', `${height}px`);
}
onMounted(() => {
  observer = new MutationObserver(popupSize); observer.observe(host.value!, { childList: true, subtree: true });
  sizing = new ResizeObserver(popupSize); sizing.observe(host.value!);
});
onBeforeUnmount(() => { observer?.disconnect(); sizing?.disconnect(); });
const targets = computed(previewTargets);
const preferences = computed(() => ({ ...defaultEditorPreferences, ...props.preferences,
  previewMathWhileEditing: props.livePreview !== false, previewMermaidWhileEditing: props.livePreview !== false }));
async function prepare() {
  ready.value = true;
  await nextTick();
  if (props.source || props.reveal) editor.value?.revealPreviewSource();
  editor.value?.withContext(ctx => prepareEditorPreview(ctx, { folded: props.folded }));
  if (props.properties) host.value?.querySelector('details')?.setAttribute('open', '');
}
watch(() => [props.markdown, props.source, props.folded, props.reveal], () => { if (ready.value) void prepare(); }, { flush: 'post' });
</script>

<template>
  <div ref="host" class="rendered-example" :data-ready="ready" data-renderer="editor" :data-source="source" :data-live-preview="livePreview !== false" :data-fold-demo="folded !== undefined || undefined"
    inert aria-hidden="true" @click.stop @pointerdown.stop>
    <MarkdownEditor ref="editor" :model-value="markdown" :document-id="`example-${id}`" :readonly="!editable && !source && !reveal"
      :translate="t" :reference-targets="targets" :resolve-image="previewResource" :reveal-markdown="!!source || !!reveal"
      :show-document-properties="!!properties" :preferences="preferences" :capabilities="capabilities ?? defaultCapabilities" :custom-callout-icon="CalloutIconPicker" @ready="prepare" />
  </div>
</template>

<style scoped>
.rendered-example { position: relative; min-width: 0; color: var(--text); }
/* Only viewport/chrome geometry changes. Content uses the application's own styles. */
.rendered-example :deep(.tano-prose) { min-height: 0; padding-bottom: 0; }
.rendered-example :deep(.tano-prose > :first-child) { margin-top: 0; }
.rendered-example :deep(.tano-prose > :last-child) { margin-bottom: 0; }
.rendered-example :deep(.frontmatter-panel) { margin: 0 0 16px; width: 100%; }
.rendered-example[data-source] { padding-bottom: var(--preview-popup-height, 0px); }
.rendered-example :deep(.tano-live-mermaid-preview) { position: absolute !important; left: 50% !important; top: calc(100% + 6px) !important; transform: translateX(-50%); max-width: 100%; }
.rendered-example :deep(.tano-live-math-preview) { max-width: 100%; }
.rendered-example[data-fold-demo] :deep(.tano-fold-toggle) { opacity: 1; pointer-events: none; }
</style>
