<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ImagePlus, Trash2 } from 'lucide-vue-next';
import { builtinWallpapers, debugStripeWallpaper, glassWallpaper } from '../glass-wallpaper';
import { t } from '../i18n';

/** Background image for the frosted-glass layout. Rendered only while that layout is active. */
const controller = glassWallpaper();
const state = computed(() => controller?.state.value);
const input = ref<HTMLInputElement>();
const softnessId = useId();
const choices = computed(() => {
  const current = state.value;
  if (!current) return [];
  const debugStripePreview = current.thumbnails[debugStripeWallpaper.id];
  return [
    { id: 'none', label: '光斑', preview: undefined },
    ...builtinWallpapers.map(item => ({ id: item.id, label: item.label, preview: current.thumbnails[item.id] })),
    ...(debugStripePreview ? [{ ...debugStripeWallpaper, preview: debugStripePreview }] : []),
    ...(current.customRevision !== undefined ? [{ id: 'custom', label: '我的图片', preview: current.customThumbnail }] : []),
  ];
});

function pick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (file) void controller?.importFile(file);
}
</script>

<template>
  <section v-if="controller && state" class="glass-wallpaper" data-settings-key="appearance-wallpaper" :aria-label="t('背景图片')" :aria-busy="state.busy">
    <div class="glass-wallpaper-head">
      <div>
        <strong>{{ t('背景图片') }}</strong>
        <p>{{ t('玻璃材质会透出这张图片，卡片透明度会按图片自动调整以保证文字清晰。图片只保存在这台设备。') }}</p>
      </div>
      <div class="glass-wallpaper-actions">
        <button type="button" class="glass-wallpaper-button" :disabled="state.busy" @click="input?.click()">
          <ImagePlus :size="15" aria-hidden="true" />{{ t(state.customRevision !== undefined ? '更换图片' : '选择图片') }}
        </button>
        <button v-if="state.customRevision !== undefined" type="button" class="glass-wallpaper-icon" :disabled="state.busy"
          :aria-label="t('移除我的图片')" :data-tooltip="t('移除我的图片')" @click="controller.removeCustom()">
          <Trash2 :size="15" aria-hidden="true" />
        </button>
        <input ref="input" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" hidden @change="pick" />
      </div>
    </div>
    <div class="glass-wallpaper-choices" role="group" :aria-label="t('背景图片')">
      <button v-for="choice in choices" :key="choice.id" type="button" class="glass-wallpaper-choice"
        :aria-pressed="state.source === choice.id" :disabled="state.busy && state.source !== choice.id" @click="controller.select(choice.id)">
        <span class="glass-wallpaper-swatch" :class="{ 'glass-wallpaper-swatch-field': choice.id === 'none' }"
          :style="choice.preview ? { backgroundImage: `url(${JSON.stringify(choice.preview)})` } : undefined" aria-hidden="true" />
        <span>{{ t(choice.label) }}</span>
      </button>
    </div>
    <div class="glass-wallpaper-softness">
      <label :for="softnessId">{{ t('柔化') }}</label>
      <input :id="softnessId" type="range" min="0" max="100" step="1" :value="state.softness" :disabled="state.source === 'none'"
        :aria-valuetext="`${state.softness}%`"
        @input="controller.setSoftness(Number(($event.target as HTMLInputElement).value))"
        @change="controller.setSoftness(Number(($event.target as HTMLInputElement).value), true)" />
      <output :for="softnessId">{{ state.softness }}%</output>
    </div>
    <p v-if="state.error" role="alert" class="glass-wallpaper-error">{{ t(state.error) }}</p>
  </section>
</template>

<style scoped>
.glass-wallpaper { padding: 16px 0 18px; border-bottom: 1px solid var(--line); }
.glass-wallpaper-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; }
.glass-wallpaper-head strong { font-size: 13px; line-height: 1.6; font-weight: 500; }
.glass-wallpaper-head p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
.glass-wallpaper-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.glass-wallpaper-button, .glass-wallpaper-icon {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 12px;
  border: 1px solid var(--control-border); border-radius: var(--radius-control, 6px); background: var(--paper); color: var(--text); font-size: 13px;
}
.glass-wallpaper-icon { width: 34px; padding: 0; color: var(--muted); }
.glass-wallpaper-button:hover:not(:disabled), .glass-wallpaper-icon:hover:not(:disabled) { border-color: var(--line-strong); background: var(--hover); color: var(--text); }
.glass-wallpaper-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-top: 14px; }
.glass-wallpaper-choice { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 4px; border: 1px solid transparent; border-radius: 10px; background: none; color: var(--text-secondary); font-size: 12px; text-align: start; }
.glass-wallpaper-choice > span:last-child { padding-inline: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.glass-wallpaper-choice:hover:not(:disabled) { background: var(--hover); }
.glass-wallpaper-choice[aria-pressed='true'] { border-color: var(--green); color: var(--text); }
.glass-wallpaper-choice:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.glass-wallpaper-swatch { display: block; aspect-ratio: 16 / 10; border-radius: 7px; background: var(--surface) center / cover no-repeat; box-shadow: inset 0 0 0 1px var(--line); }
/* The default painted light field, as a tiny live sample of the current palette. */
.glass-wallpaper-swatch-field {
  background:
    radial-gradient(40% 55% at 20% 40%, color-mix(in srgb, var(--syntax-blue) 34%, transparent), transparent 70%),
    radial-gradient(40% 55% at 80% 35%, color-mix(in srgb, var(--syntax-purple) 20%, transparent), transparent 70%),
    radial-gradient(45% 50% at 50% 100%, color-mix(in srgb, var(--syntax-teal) 22%, transparent), transparent 70%),
    var(--sidebar);
}
.glass-wallpaper-softness { display: flex; align-items: center; gap: 12px; margin-top: 14px; font-size: 12px; color: var(--text-secondary); }
.glass-wallpaper-softness input { flex: 1; min-width: 0; accent-color: var(--green); }
.glass-wallpaper-softness input:disabled { opacity: .45; }
.glass-wallpaper-softness output { width: 36px; text-align: end; font-variant-numeric: tabular-nums; color: var(--muted); }
.glass-wallpaper-error { margin: 10px 0 0; color: var(--danger); font-size: 12px; }
@media (max-width: 700px) {
  .glass-wallpaper-head { flex-direction: column; gap: 10px; }
}
</style>
