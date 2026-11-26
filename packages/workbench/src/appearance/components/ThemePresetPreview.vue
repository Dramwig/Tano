<script setup lang="ts">
import { computed } from 'vue';
import { insetLayout, type AppearancePreset } from '../appearance';

const props = defineProps<{ preset: AppearancePreset }>();
const previews = computed(() => props.preset.previews?.length ? props.preset.previews : [{ mode: 'light' as const, colors: {} }]);
</script>

<template>
  <span class="theme-preview" :class="{ 'theme-preview-dual': previews.length === 2 }"
    :data-preview-structure="preset.structure ?? 'continuous'" :data-preview-surface="preset.material"
    :data-preview-flat-sidebar="preset.selected.layout === insetLayout ? '' : undefined" aria-hidden="true">
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
  --preview-green: #2f2e2a;
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
  --preview-green: #e4e3df;
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
/* Inset content under a top bar that sits directly on the desk. */
[data-preview-structure='islands'] .theme-preview-toolbar { border-bottom: 0; background: var(--preview-sidebar); }
[data-preview-structure='islands'] .theme-preview-workspace { gap: 5px; padding: 0 5px 5px; background: var(--preview-sidebar); }
[data-preview-structure='islands'] .theme-preview-sidebar { padding: 6px 4px; border: 0; background: transparent; }
[data-preview-structure='islands']:not([data-preview-flat-sidebar]) .theme-preview-sidebar { border: 1px solid var(--preview-line); border-radius: 4px; background: var(--preview-paper); }
[data-preview-structure='islands'] .theme-preview-main { padding: 7px 9px; border: 1px solid var(--preview-line); border-radius: 4px; }
[data-preview-structure='islands'] .theme-preview-document { gap: 6px; }
[data-preview-structure='islands'] .theme-preview-nav:last-child { display: none; }
/* Paper: a single soft sheet on the desk with a centred title. */
[data-preview-structure='document'] .theme-preview-main { padding: 6px 16px; background: var(--preview-sidebar); }
[data-preview-structure='document'] .theme-preview-document { padding: 8px 9px; gap: 6px; border: 1px solid var(--preview-line); border-radius: 2px; background: var(--preview-paper); box-shadow: 0 2px 5px -2px #00000026; }
[data-preview-structure='document'] .theme-preview-heading { width: 44%; align-self: center; height: 3px; margin-bottom: 2px; }
[data-preview-structure='document'] .theme-preview-callout { display: none; }
[data-preview-structure='document'] .theme-preview-paragraph-short { display: flex; }
/* Raised card: clean flat surfaces with crisp 1px edge bevels and quiet double-bezel tray (see layout-themes.css). */
.theme-preview[data-preview-surface='raised'] .theme-preview-scene {
  --preview-raised-edge: color-mix(in srgb, var(--preview-text) 14%, var(--preview-line));
  --preview-raised-highlight: #ffffff;
  --preview-raised-underside: color-mix(in srgb, var(--preview-text) 9%, transparent);
  --preview-raised-groove: color-mix(in srgb, var(--preview-text) 6%, var(--preview-sidebar));
  --preview-raised-outer: color-mix(in srgb, var(--preview-text) 14%, var(--preview-line));
  --preview-raised-shadow:
    inset 0 1px 0 var(--preview-raised-highlight),
    inset 0 -1px 0 var(--preview-raised-underside),
    0 1px 2px 0 color-mix(in srgb, var(--preview-text) 12%, transparent),
    0 0 0 2px var(--preview-raised-groove),
    0 0 0 2.5px var(--preview-raised-outer),
    0 3px 6px -2px color-mix(in srgb, var(--preview-text) 14%, transparent);
  background: color-mix(in srgb, var(--preview-sidebar) 94%, var(--preview-text) 6%);
}
.theme-preview[data-preview-surface='raised'] .theme-preview-scene[data-preview-mode='dark'] {
  --preview-raised-edge: color-mix(in srgb, #ffffff 11%, var(--preview-paper));
  --preview-raised-highlight: rgb(255 255 255 / 15%);
  --preview-raised-underside: rgb(0 0 0 / 38%);
  --preview-raised-groove: color-mix(in srgb, var(--preview-sidebar) 56%, #000000);
  --preview-raised-outer: color-mix(in srgb, #ffffff 9%, var(--preview-sidebar));
  --preview-raised-shadow:
    inset 0 1px 0 var(--preview-raised-highlight),
    inset 0 -1px 0 var(--preview-raised-underside),
    0 1px 2px 0 rgb(0 0 0 / 52%),
    0 0 0 2px var(--preview-raised-groove),
    0 0 0 2.5px var(--preview-raised-outer),
    0 4px 8px -2px rgb(0 0 0 / 50%);
  background: color-mix(in srgb, var(--preview-sidebar) 70%, #000000 30%);
}
.theme-preview[data-preview-surface='raised'] .theme-preview-window {
  border-color: var(--preview-raised-edge);
  box-shadow: var(--preview-raised-shadow);
}
.theme-preview[data-preview-surface='raised'][data-preview-structure='islands']:not([data-preview-flat-sidebar]) .theme-preview-sidebar,
.theme-preview[data-preview-surface='raised'][data-preview-structure='islands'] .theme-preview-main,
.theme-preview[data-preview-surface='raised'][data-preview-structure='document'] .theme-preview-document {
  border-color: var(--preview-raised-edge);
  box-shadow: var(--preview-raised-shadow);
}
.theme-preview[data-preview-surface='raised'][data-preview-structure='continuous'] .theme-preview-main {
  box-shadow: inset 1px 0 0 var(--preview-raised-edge), inset 0 1px 0 var(--preview-raised-highlight);
}
/* Frosted glass: the same two cards, milky and translucent over soft orbs of colour (see layout-themes.css). */
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-scene {
  --preview-syntax-blue: #2d5fb8;
  --preview-syntax-purple: #6a45b8;
  --preview-syntax-teal: #0b7480;
  --preview-glass: 50%;
  --preview-rim: #ffffffb8;
  --preview-sheen: #ffffff99;
  background:
    radial-gradient(30% 42% at 16% 40%, color-mix(in srgb, var(--preview-syntax-blue) 40%, transparent), transparent 70%),
    radial-gradient(34% 44% at 58% 72%, color-mix(in srgb, var(--preview-syntax-blue) 28%, transparent), transparent 70%),
    radial-gradient(30% 40% at 82% 40%, color-mix(in srgb, var(--preview-syntax-purple) 22%, transparent), transparent 70%),
    radial-gradient(36% 40% at 94% 4%, color-mix(in srgb, var(--preview-syntax-teal) 26%, transparent), transparent 70%),
    linear-gradient(170deg, color-mix(in srgb, var(--preview-sidebar) 70%, #ffffff), color-mix(in srgb, var(--preview-sidebar) 40%, #ffffff));
}
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-scene[data-preview-mode='dark'] {
  --preview-syntax-blue: #9cbcff;
  --preview-syntax-purple: #cbb5ff;
  --preview-glass: 60%;
  --preview-rim: #ffffff24;
  --preview-sheen: #ffffff1f;
  background:
    radial-gradient(30% 42% at 16% 40%, color-mix(in srgb, var(--preview-syntax-blue) 26%, transparent), transparent 70%),
    radial-gradient(34% 44% at 58% 72%, color-mix(in srgb, var(--preview-syntax-blue) 18%, transparent), transparent 70%),
    radial-gradient(30% 40% at 82% 40%, color-mix(in srgb, var(--preview-syntax-purple) 16%, transparent), transparent 70%),
    linear-gradient(170deg, var(--preview-sidebar), color-mix(in srgb, var(--preview-sidebar) 86%, var(--preview-text) 14%));
}
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-window,
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-toolbar,
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-workspace { background: transparent; }
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-window { border-color: transparent; box-shadow: none; }
.theme-preview[data-preview-surface='frost']:not([data-preview-flat-sidebar]) .theme-preview-sidebar,
.theme-preview[data-preview-surface='liquid'][data-preview-structure='islands']:not([data-preview-flat-sidebar]) .theme-preview-sidebar,
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-main {
  border-color: var(--preview-rim);
  border-radius: 6px;
  background: linear-gradient(160deg, var(--preview-sheen), transparent 55%), color-mix(in srgb, var(--preview-paper) var(--preview-glass), transparent);
  box-shadow: inset 0 1px 0 var(--preview-rim), 0 6px 12px -8px #1c305a4d;
  -webkit-backdrop-filter: blur(8px) saturate(170%) brightness(1.04); backdrop-filter: blur(8px) saturate(170%) brightness(1.04);
}
.theme-preview:is([data-preview-surface='frost'], [data-preview-surface='liquid']) .theme-preview-main { --preview-glass: 74%; }
/* Liquid glass: clearer cards whose edges catch the light (see layout-themes.css). */
.theme-preview[data-preview-surface='liquid'] .theme-preview-scene { --preview-glass: 10%; --preview-rim: #ffffff80; --preview-edge: #ffffff80; --preview-outline: #1c24301f; }
.theme-preview[data-preview-surface='liquid'] .theme-preview-scene[data-preview-mode='dark'] { --preview-glass: 16%; --preview-rim: #ffffff42; --preview-edge: #ffffff1a; --preview-outline: #00000073; }
.theme-preview[data-preview-surface='liquid']:not([data-preview-structure='islands']) .theme-preview-sidebar { background: transparent; }
.theme-preview[data-preview-surface='liquid'][data-preview-structure='islands']:not([data-preview-flat-sidebar]) .theme-preview-sidebar,
.theme-preview[data-preview-surface='liquid'] .theme-preview-main {
  border-color: transparent;
  background: color-mix(in srgb, var(--preview-paper) var(--preview-glass), transparent);
  box-shadow: 0 0 0 .5px var(--preview-outline), inset 1px 1px 0 var(--preview-rim), inset -1px -1px 0 var(--preview-edge),
    0 6px 12px -8px #1c305a4d;
  -webkit-backdrop-filter: none; backdrop-filter: none;
}
.theme-preview[data-preview-surface='liquid'] .theme-preview-scene[data-preview-mode] {
  background: url('../../assets/clouds-day.webp') center / cover;
}
.theme-preview[data-preview-surface='liquid'] .theme-preview-scene[data-preview-mode='dark'] {
  background-image: url('../../assets/clouds-night.webp');
}
.theme-preview[data-preview-surface='liquid'] .theme-preview-main { --preview-glass: 16%; }
.theme-preview[data-preview-surface='liquid'][data-preview-structure='continuous'] .theme-preview-main {
  border-radius: 6px 0 0; box-shadow: inset 1px 1px 0 var(--preview-rim);
}
.theme-preview[data-preview-surface='liquid'] [data-preview-mode='dark'] .theme-preview-main { --preview-glass: 22%; }
</style>
