<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { previewLoadingLabels, previewSkeletonKind, type PreviewSkeletonKind } from '../preview-skeleton';
import '../loading-skeleton.css';

// Async preview components also forward binary props to their loading component.
defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ path?: string; kind?: PreviewSkeletonKind; controls?: boolean }>(), { path: '', controls: true });
const layout = computed(() => props.kind ?? previewSkeletonKind(props.path));
const toolbar = computed(() => props.controls && ['pdf', 'word', 'spreadsheet', 'presentation'].includes(layout.value));
</script>

<template>
  <div class="preview-skeleton" :class="`preview-skeleton-${layout}`" :data-preview-kind="layout" role="status" aria-busy="true" :aria-label="t(previewLoadingLabels[layout])">
    <div aria-hidden="true">
      <div v-if="toolbar" class="preview-skeleton-controls">
        <span v-if="layout !== 'pdf'" class="tano-skeleton-bar preview-skeleton-badge" />
        <span v-if="layout === 'spreadsheet'" class="tano-skeleton-bar preview-skeleton-picker" />
        <template v-if="layout !== 'word'"><span v-for="index in 3" :key="index" class="tano-skeleton-bar preview-skeleton-button" /></template>
      </div>
      <span v-if="toolbar && layout !== 'pdf'" class="tano-skeleton-bar preview-skeleton-note" />
      <div v-if="layout === 'spreadsheet'" class="preview-skeleton-grid">
        <div v-for="row in 11" :key="row" class="preview-skeleton-grid-row" :class="{ 'preview-skeleton-grid-header': row === 1 }">
          <div v-for="column in 7" :key="column" class="preview-skeleton-cell"><span class="tano-skeleton-bar" :style="{ width: `${column === 1 ? 40 : 35 + (row * 17 + column * 11) % 45}%` }" /></div>
        </div>
      </div>
      <div v-else-if="layout === 'word' || layout === 'pdf' || layout === 'presentation'" class="preview-skeleton-paper">
        <span class="tano-skeleton-bar preview-skeleton-title" />
        <div class="preview-skeleton-paragraph"><span v-for="row in layout === 'presentation' ? 3 : 4" :key="row" class="tano-skeleton-bar" /></div>
        <div v-if="layout === 'word'" class="preview-skeleton-document-table"><span v-for="cell in 6" :key="cell"><span class="tano-skeleton-bar" /></span></div>
        <div v-else class="preview-skeleton-figure"><span class="tano-skeleton-bar" /></div>
        <div v-if="layout !== 'presentation'" class="preview-skeleton-paragraph"><span v-for="row in 3" :key="row" class="tano-skeleton-bar" /></div>
      </div>
      <div v-else-if="layout === 'image' || layout === 'video'" class="preview-skeleton-media">
        <div class="preview-skeleton-visual"><span class="tano-skeleton-bar" :class="layout === 'video' ? 'preview-skeleton-play' : 'preview-skeleton-picture'" /></div>
        <div v-if="layout === 'video'" class="preview-skeleton-player-controls"><span class="tano-skeleton-bar preview-skeleton-play-small" /><span class="tano-skeleton-bar preview-skeleton-track" /><span class="tano-skeleton-bar preview-skeleton-time" /></div>
      </div>
      <div v-else-if="layout === 'audio'" class="preview-skeleton-player-controls preview-skeleton-audio"><span class="tano-skeleton-bar preview-skeleton-play-small" /><span class="tano-skeleton-bar preview-skeleton-track" /><span class="tano-skeleton-bar preview-skeleton-time" /></div>
      <div v-else class="preview-skeleton-lines" :class="{ 'preview-skeleton-code-lines': layout === 'code' }">
        <span v-for="row in 12" :key="row" class="tano-skeleton-bar" :style="{ width: `${42 + (row * 19) % 50}%`, marginLeft: layout === 'code' ? `${(row % 4) * 16}px` : '0' }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-skeleton { width: 100%; min-width: 0; color: var(--text, #37352f); }
.preview-skeleton-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 32px; margin-bottom: 12px; }
.preview-skeleton-badge { width: 64px; height: 26px; }
.preview-skeleton-picker { width: 160px; height: 30px; }
.preview-skeleton-button { width: 64px; height: 30px; }
.preview-skeleton-note { width: min(85%, 680px); height: 10px; margin: 10px 0 24px; }
.preview-skeleton-grid { width: 100%; border: 1px solid var(--line, #e4e6e0); border-radius: 4px; overflow: hidden; }
.preview-skeleton-grid-row { display: grid; grid-template-columns: 40px repeat(6, minmax(0, 1fr)); }
.preview-skeleton-grid-row + .preview-skeleton-grid-row { border-top: 1px solid var(--line, #e4e6e0); }
.preview-skeleton-grid-header { background: var(--hover, #f5f6f3); }
.preview-skeleton-cell { display: flex; align-items: center; min-width: 0; height: 34px; padding: 0 12px; }
.preview-skeleton-cell + .preview-skeleton-cell { border-left: 1px solid var(--line, #e4e6e0); }
.preview-skeleton-cell .tano-skeleton-bar { height: 9px; }
.preview-skeleton-paper { box-sizing: border-box; width: 100%; min-width: 0; max-width: 900px; margin: 24px auto; padding: clamp(16px, 4vw, 48px); border: 1px solid var(--line, #e4e6e0); border-radius: 8px; }
.preview-skeleton-title { width: 48%; height: 28px; margin-bottom: 32px; }
.preview-skeleton-paragraph { display: grid; gap: 18px; margin-bottom: 24px; }
.preview-skeleton-paragraph .tano-skeleton-bar:last-child { width: 68%; }
.preview-skeleton-document-table { display: grid; grid-template-columns: 1fr 1fr; margin: 24px 0; border-top: 1px solid var(--line, #e4e6e0); border-left: 1px solid var(--line, #e4e6e0); }
.preview-skeleton-document-table > span { padding: 16px 12px; border-right: 1px solid var(--line, #e4e6e0); border-bottom: 1px solid var(--line, #e4e6e0); }
.preview-skeleton-document-table .tano-skeleton-bar { width: 55%; height: 10px; }
.preview-skeleton-pdf .preview-skeleton-controls { justify-content: center; margin-bottom: 16px; }
.preview-skeleton-pdf .preview-skeleton-paper { display: grid; grid-template-rows: auto auto minmax(64px, 1fr) auto; gap: 20px; max-width: 800px; aspect-ratio: 1 / 1.414; margin: 0 auto; padding: clamp(20px, 5%, 48px); border-radius: 2px; }
.preview-skeleton-pdf .preview-skeleton-title, .preview-skeleton-pdf .preview-skeleton-paragraph { margin: 0; }
.preview-skeleton-figure { display: flex; align-items: center; justify-content: center; min-height: 140px; margin: 28px 0; border: 1px solid var(--line, #e4e6e0); border-radius: 4px; }
.preview-skeleton-figure > span { width: 65%; height: 70px; }
.preview-skeleton-pdf .preview-skeleton-figure { min-height: 64px; margin: 0; }
.preview-skeleton-presentation .preview-skeleton-paper { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .85fr); column-gap: 24px; aspect-ratio: 16 / 9; min-height: 280px; align-content: start; }
.preview-skeleton-presentation .preview-skeleton-title { grid-column: 1 / -1; width: 58%; margin-bottom: 24px; }
.preview-skeleton-presentation .preview-skeleton-paragraph { align-content: start; gap: 16px; margin-bottom: 0; }
.preview-skeleton-presentation .preview-skeleton-figure { margin: 0; }
.preview-skeleton-media { max-width: 960px; margin: 0 auto; border: 1px solid var(--line, #e4e6e0); border-radius: 8px; overflow: hidden; }
.preview-skeleton-visual { display: grid; place-items: center; aspect-ratio: 16 / 9; background: var(--hover, #f5f6f3); }
.preview-skeleton-image .preview-skeleton-visual { aspect-ratio: 4 / 3; max-height: 65vh; min-height: 180px; }
.preview-skeleton-picture { width: 72px; height: 54px; clip-path: polygon(0 100%, 35% 30%, 55% 60%, 75% 10%, 100% 100%); border-radius: 0; }
.preview-skeleton-play { width: 48px; height: 56px; clip-path: polygon(0 0, 100% 50%, 0 100%); border-radius: 0; }
.preview-skeleton-player-controls { display: flex; align-items: center; gap: 16px; padding: 16px; }
.preview-skeleton-play-small { flex: 0 0 24px; height: 24px; border-radius: 50%; }
.preview-skeleton-track { flex: 1; height: 6px; }
.preview-skeleton-time { width: 44px; height: 10px; }
.preview-skeleton-audio { box-sizing: border-box; max-width: 480px; border: 1px solid var(--line, #e4e6e0); border-radius: 28px; }
.preview-skeleton-lines { display: grid; gap: 18px; max-width: 900px; padding: 4px 0; }
.preview-skeleton-code-lines { gap: 12px; max-width: 800px; }
.preview-skeleton-code-lines .tano-skeleton-bar { height: 10px; border-radius: 3px; }
@media (max-width: 640px) {
  .preview-skeleton-paper { padding: 16px; margin: 16px 0; }
  .preview-skeleton-title { height: 24px; margin-bottom: 24px; }
  .preview-skeleton-controls { gap: 8px; }
  .preview-skeleton-picker { width: 120px; }
  .preview-skeleton-cell { padding: 0 6px; }
  .preview-skeleton-grid-row { grid-template-columns: 28px repeat(6, minmax(0, 1fr)); }
  .preview-skeleton-presentation .preview-skeleton-paper { min-height: 0; }
  .preview-skeleton-presentation .preview-skeleton-paragraph { max-width: 100%; }
  .preview-skeleton-presentation .preview-skeleton-figure { min-height: 80px; }
}
</style>
