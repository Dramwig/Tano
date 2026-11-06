<script setup lang="ts">
import { computed } from 'vue';
import type { AppearancePreset } from '../appearance';

const props = defineProps<{ preset: AppearancePreset }>();
const previews = computed(() => props.preset.previews?.length ? props.preset.previews : [{ mode: 'light' as const, colors: {} }]);
</script>

<template>
  <span class="theme-preview" :class="{ 'theme-preview-dual': previews.length === 2 }"
    :data-preview-structure="preset.structure ?? 'continuous'" aria-hidden="true">
    <span v-for="preview in previews" :key="preview.mode" class="theme-preview-scene"
      :data-preview-mode="preview.mode" :style="preview.colors">
      <span class="theme-preview-window">
        <span class="theme-preview-toolbar"><i /><i /><i /><span /><i /></span>
        <span class="theme-preview-workspace">
          <span class="theme-preview-sidebar">
            <span class="theme-preview-brand"><i /><i /></span>
            <span v-for="row in 4" :key="row" class="theme-preview-nav"><i /><i /></span>
          </span>
          <span class="theme-preview-main">
            <span class="theme-preview-document">
              <span class="theme-preview-heading" />
              <span class="theme-preview-paragraph"><i /><i /><i /></span>
              <span class="theme-preview-callout"><i /><i /></span>
              <span class="theme-preview-paragraph theme-preview-paragraph-short"><i /><i /></span>
            </span>
          </span>
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.theme-preview { position: relative; display: block; width: 100%; height: var(--theme-preview-height, 132px); overflow: hidden; border-radius: 7px; isolation: isolate; pointer-events: none; }
.theme-preview-scene {
  --preview-paper: #ffffff;
  --preview-sidebar: #f8f8f7;
  --preview-surface: #f7f7f5;
  --preview-green: #1f7a52;
  --preview-text: #37352f;
  --preview-muted: #787774;
  --preview-line: #ebebea;
  --preview-control-border: #d3d2ce;
  --preview-selected: #ebeae8;
  position: absolute; inset: 0; display: flex; padding: 12px;
  background: var(--preview-sidebar); color: var(--preview-text);
}
.theme-preview-scene[data-preview-mode='dark'] {
  --preview-paper: #1f1f1e;
  --preview-sidebar: #1b1b1a;
  --preview-surface: #272726;
  --preview-green: #91b8a1;
  --preview-text: #d8d7d4;
  --preview-muted: #9b9a96;
  --preview-line: #2e2e2d;
  --preview-control-border: #6f6e6b;
  --preview-selected: #323231;
}
.theme-preview-dual .theme-preview-scene:last-child { clip-path: polygon(56% 0, 100% 0, 100% 100%, 44% 100%); }
.theme-preview-window { display: flex; flex-direction: column; width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--preview-line); border-radius: 5px; background: var(--preview-paper); box-shadow: 0 2px 6px #0000000b; }
.theme-preview-toolbar { display: flex; align-items: center; gap: 3px; height: 14px; flex-shrink: 0; padding-inline: 6px; border-bottom: 1px solid var(--preview-line); background: var(--preview-surface); }
.theme-preview-toolbar > i { width: 3px; height: 3px; border-radius: 50%; background: var(--preview-muted); opacity: .4; }
.theme-preview-toolbar > span { width: 30%; height: 3px; margin: auto; border-radius: 2px; background: var(--preview-muted); opacity: .16; }
.theme-preview-toolbar > i:last-child { margin-left: 8px; border-radius: 1px; }
.theme-preview-workspace { display: flex; flex: 1; min-height: 0; }
.theme-preview-sidebar { display: flex; flex-direction: column; gap: 5px; flex: 0 0 26%; min-width: 0; padding: 9px 6px; border-right: 1px solid var(--preview-line); background: var(--preview-sidebar); }
.theme-preview-brand, .theme-preview-nav { display: flex; align-items: center; gap: 4px; height: 5px; flex-shrink: 0; }
.theme-preview-brand { margin-bottom: 4px; }
.theme-preview-brand > i:first-child { width: 6px; height: 6px; border-radius: 2px; background: var(--preview-green); }
.theme-preview-brand > i:last-child { width: 50%; height: 3px; border-radius: 2px; background: var(--preview-text); opacity: .55; }
.theme-preview-nav > i:first-child { width: 4px; height: 4px; border: 1px solid var(--preview-muted); border-radius: 1px; opacity: .5; }
.theme-preview-nav > i:last-child { width: 65%; height: 2px; border-radius: 1px; background: var(--preview-muted); opacity: .32; }
.theme-preview-nav:nth-child(3) { margin: -2px -3px; padding: 2px 3px; height: 9px; border-radius: 2px; background: var(--preview-selected); }
.theme-preview-nav:last-child > i:last-child { width: 45%; }
.theme-preview-main { display: flex; flex: 1; min-width: 0; padding: 10px 12px; background: var(--preview-paper); }
.theme-preview-document { position: relative; display: flex; flex-direction: column; gap: 7px; flex: 1; min-width: 0; }
.theme-preview-heading { width: 48%; height: 4px; flex-shrink: 0; border-radius: 1px; background: var(--preview-text); opacity: .8; }
.theme-preview-paragraph { display: flex; flex-direction: column; gap: 3px; }
.theme-preview-paragraph > i { display: block; width: 100%; height: 2px; border-radius: 1px; background: var(--preview-muted); opacity: .3; }
.theme-preview-paragraph > i:last-child { width: 72%; }
.theme-preview-callout { display: flex; flex-direction: column; gap: 3px; padding: 4px 5px; border-left: 2px solid var(--preview-green); border-radius: 1px; background: color-mix(in srgb, var(--preview-green) 9%, var(--preview-paper)); }
.theme-preview-callout > i { width: 85%; height: 2px; border-radius: 1px; background: var(--preview-green); opacity: .45; }
.theme-preview-callout > i:last-child { width: 60%; }
.theme-preview-paragraph-short { display: none; }
/* Two floating cards under a top bar that sits directly on the desk. */
[data-preview-structure='islands'] .theme-preview-toolbar { border-bottom: 0; background: var(--preview-sidebar); }
[data-preview-structure='islands'] .theme-preview-workspace { gap: 5px; padding: 0 5px 5px; background: var(--preview-sidebar); }
[data-preview-structure='islands'] .theme-preview-sidebar { padding: 6px 4px; border: 1px solid var(--preview-line); border-radius: 4px; background: var(--preview-paper); }
[data-preview-structure='islands'] .theme-preview-main { padding: 7px 9px; border: 1px solid var(--preview-line); border-radius: 4px; }
[data-preview-structure='islands'] .theme-preview-document { gap: 6px; }
[data-preview-structure='islands'] .theme-preview-nav:last-child { display: none; }
/* Paper: a single soft sheet on the desk with a centred title. */
[data-preview-structure='document'] .theme-preview-main { padding: 6px 16px; background: var(--preview-sidebar); }
[data-preview-structure='document'] .theme-preview-document { padding: 8px 9px; gap: 6px; border: 1px solid var(--preview-line); border-radius: 2px; background: var(--preview-paper); box-shadow: 0 2px 5px -2px #00000026; }
[data-preview-structure='document'] .theme-preview-heading { width: 44%; align-self: center; height: 3px; margin-bottom: 2px; }
[data-preview-structure='document'] .theme-preview-callout { display: none; }
[data-preview-structure='document'] .theme-preview-paragraph-short { display: flex; }
</style>
