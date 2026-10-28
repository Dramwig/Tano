<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import type { SettingsSnapshot } from '../settings-window';

const props = defineProps<{ enabled: boolean; state: SettingsSnapshot['updates'] }>();
const emit = defineEmits<{ download: []; install: [] }>();
const visible = computed(() => props.enabled && (props.state.status?.configured || props.state.status?.manual) && props.state.candidate &&
  ['available', 'downloading', 'ready', 'installing'].includes(props.state.phase));
const busy = computed(() => props.state.busy || ['downloading', 'installing'].includes(props.state.phase));
const visual = computed(() => busy.value ? 'spinning' : props.state.phase === 'ready' ? 'ready' : 'available');
const celebrating = ref(false);
const iconPath = ref<SVGPathElement>();
const iconRotation = ref<SVGGElement>();
const arrowHead = ref<SVGPathElement>();
const downloadTray = ref<SVGPathElement>();
// Increase the stem's curvature continuously instead of interpolating unrelated
// arrow/arc nodes. Each intermediate shape is one smooth, non-crossing arc.
function curledStem(amount: number) {
  const length = 11 + (Math.PI * 13.5 - 11) * amount;
  const sweep = Math.PI * 1.5 * amount;
  const tangent = Math.PI / 2 * (1 - amount);
  const startY = 4 - amount;
  if (sweep < .00001) {
    return [12, startY, ...Array.from({ length: 12 }, (_, i) => [12, startY + length * (i + 1) / 12]).flat()];
  }
  const radius = length / sweep;
  const handle = radius * 4 / 3 * Math.tan(sweep / 16);
  const point = (angle: number) => {
    const chord = 2 * radius * Math.sin(angle / 2);
    return [12 + chord * Math.cos(tangent + angle / 2), startY + chord * Math.sin(tangent + angle / 2)];
  };
  const result = [12, startY];
  for (let i = 0; i < 4; i++) {
    const a = sweep * i / 4, b = sweep * (i + 1) / 4;
    const start = point(a), end = point(b);
    result.push(start[0]! + handle * Math.cos(tangent + a), start[1]! + handle * Math.sin(tangent + a),
      end[0]! - handle * Math.cos(tangent + b), end[1]! - handle * Math.sin(tangent + b), ...end);
  }
  return result;
}
const shapes = {
  available: curledStem(0),
  spinning: curledStem(1),
  ready: [5, 12, 6.33, 13.33, 7.67, 14.67, 9, 16, 10, 15, 11, 14, 12, 13, 13, 12, 14, 11, 15, 10, 16.33, 8.67, 17.67, 7.33, 19, 6],
};
function pathData(points: number[]) {
  return `M${points.slice(0, 2).join(' ')} ${[2, 8, 14, 20].map(i => `C${points.slice(i, i + 6).join(' ')}`).join(' ')}`;
}
// Vue supplies only the initial path; subsequent state renders must not replace
// the animator's in-flight geometry with the destination icon.
const initialShape = shapes[visual.value];
const initialPath = pathData(initialShape);
let points = [...initialShape], rotation = 0, frame = 0, mounted = false;
let arrowPresence = visual.value === 'available' ? 1 : 0;
let motionPreference: MediaQueryList | undefined;
function paintIcon() {
  iconPath.value?.setAttribute('d', pathData(points));
  iconRotation.value?.setAttribute('transform', `rotate(${rotation} 12 12)`);
  const curl = 1 - arrowPresence;
  const headScale = Math.max(0, 1 - curl / .7);
  const tipX = points[24]!, tipY = points[25]!;
  const angle = Math.atan2(tipY - points[23]!, tipX - points[22]!);
  const backX = tipX - Math.cos(angle) * 5 * headScale;
  const backY = tipY - Math.sin(angle) * 5 * headScale;
  const wingX = Math.sin(angle) * 5 * headScale, wingY = -Math.cos(angle) * 5 * headScale;
  arrowHead.value?.setAttribute('d', `M${backX - wingX} ${backY - wingY} L${tipX} ${tipY} L${backX + wingX} ${backY + wingY}`);
  arrowHead.value?.setAttribute('opacity', String(Math.min(1, headScale * 2)));
  const trayProgress = Math.min(1, curl / .18);
  downloadTray.value?.setAttribute('opacity', String(1 - trayProgress ** 2 * (3 - 2 * trayProgress)));
  downloadTray.value?.setAttribute('transform', `translate(12 20) scale(${1 - trayProgress * .3}) translate(-12 -20)`);
}
function stopAnimation() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
function animateIcon(immediate = false, enteringDownload = false) {
  stopAnimation();
  if (!visible.value) return;
  const target = shapes[visual.value];
  const targetArrow = visual.value === 'available' ? 1 : 0;
  const spinning = visual.value === 'spinning';
  if (motionPreference?.matches || typeof requestAnimationFrame !== 'function') {
    points = [...target]; rotation = 0; arrowPresence = targetArrow; paintIcon(); return;
  }
  if (immediate) {
    points = [...target]; rotation = 0; arrowPresence = targetArrow; paintIcon();
  }
  const from = [...points], fromRotation = rotation % 360;
  const fromArrow = arrowPresence;
  const endRotation = fromRotation > .01 ? 360 : 0;
  const started = performance.now();
  function tick(now: number) {
    const elapsed = now - started;
    const progress = Math.min(1, elapsed / (enteringDownload ? 560 : 460));
    const eased = enteringDownload ? progress ** 2 * (3 - 2 * progress) : 1 - (1 - progress) ** 3;
    arrowPresence = fromArrow + (targetArrow - fromArrow) * eased;
    points = enteringDownload ? curledStem(1 - arrowPresence)
      : progress === 1 ? [...target] : target.map((value, i) => from[i]! + (value - from[i]!) * eased);
    // Start rotating only after the stem has become a recognizable circular arc.
    const spinTime = Math.max(0, elapsed - 360);
    const spinTravel = enteringDownload
      ? spinTime < 240 ? spinTime ** 2 / 480 : spinTime - 120
      : elapsed;
    // Finish the current turn while the arc unfolds, instead of snapping upright.
    rotation = spinning ? fromRotation + spinTravel * .36 : fromRotation + (endRotation - fromRotation) * eased;
    paintIcon();
    frame = spinning || progress < 1 ? requestAnimationFrame(tick) : 0;
  }
  if (spinning || !immediate) tick(started);
}
function updateMotionPreference() { animateIcon(true); }
watch([visible, visual], ([shown, state], [wasShown, previous]) => {
  celebrating.value = Boolean(shown && wasShown && state === 'ready' && previous === 'spinning');
  if (mounted) animateIcon(!wasShown, Boolean(wasShown && previous === 'available' && state === 'spinning'));
}, { flush: 'post' });
onMounted(() => {
  mounted = true;
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  motionPreference?.addEventListener('change', updateMotionPreference);
  animateIcon(true);
});
onBeforeUnmount(() => {
  stopAnimation();
  motionPreference?.removeEventListener('change', updateMotionPreference);
});
const label = computed(() => {
  if (props.state.status?.manual) return t('查看发行版 {0}', [props.state.candidate?.version ?? '']);
  if (props.state.phase === 'downloading') {
    const { downloaded, total } = props.state.progress;
    return total && total > 0
      ? t('正在下载更新 {0}%', [Math.max(0, Math.min(100, Math.round(downloaded / total * 100)))])
      : t('正在下载更新');
  }
  if (props.state.phase === 'installing') return t('正在安装更新');
  return t(props.state.phase === 'ready' ? '保存并安装 {0}' : '下载更新 {0}', [props.state.candidate?.version ?? '']);
});
const hint = computed(() => props.state.error ? `${label.value}：${props.state.error}` : props.state.phase === 'ready'
  ? `${label.value}。${t('更新包已验证。安装会先保存文档，然后退出并重新打开 Tano；离线协作草稿保留在本机。')}`
  : label.value);
function activate() {
  if (busy.value) return;
  if (props.state.phase === 'available') emit('download');
  else if (props.state.phase === 'ready') emit('install');
}
</script>

<template>
  <button v-if="visible" type="button" class="icon-button sidebar-update"
    :class="{ 'is-celebrating': celebrating }" :data-state="visual"
    :aria-label="label" :data-tooltip="hint" :aria-busy="busy" :disabled="busy"
    @click="activate">
    <span class="sidebar-update-disc" aria-hidden="true">
      <svg class="sidebar-update-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <g ref="iconRotation" class="sidebar-update-status">
          <path ref="iconPath" class="sidebar-update-line" :d="initialPath" />
          <path ref="arrowHead" class="sidebar-update-arrowhead" d="M7 10l5 5 5-5" />
        </g>
        <path ref="downloadTray" class="sidebar-update-tray" d="M4 16v4h16v-4" />
      </svg>
      <svg class="sidebar-update-fireworks" width="46" height="46" viewBox="-23 -23 46 46"
        fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <g v-for="ray in 8" :key="ray" :transform="`rotate(${(ray - 1) * 45})`">
          <path d="M0 -14v-4" :style="{ '--ray-delay': `${(ray % 2) * 35}ms` }" />
        </g>
      </svg>
    </span>
  </button>
  <slot v-else />
</template>

<style scoped>
.sidebar-update { display: grid; place-items: center; padding: 0; overflow: visible; }
.sidebar-update-disc {
  position: relative;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
  background: var(--green-fill);
  transition: background-color 180ms ease;
}
.sidebar-update-icon { overflow: visible; }
.sidebar-update-fireworks {
  position: absolute;
  top: -12px;
  left: -12px;
  color: var(--green);
  pointer-events: none;
  overflow: visible;
}
.sidebar-update-fireworks path { opacity: 0; transform-origin: 0 0; }
.is-celebrating .sidebar-update-fireworks path {
  animation: sidebar-update-burst 580ms cubic-bezier(.16, 1, .3, 1) both;
  animation-delay: calc(160ms + var(--ray-delay));
}
.is-celebrating .sidebar-update-disc { animation: sidebar-update-settle 460ms ease-out; }
@keyframes sidebar-update-burst {
  0% { opacity: 0; transform: scale(.72); }
  20% { opacity: .85; }
  65% { opacity: .5; }
  100% { opacity: 0; transform: scale(1.25); }
}
@keyframes sidebar-update-settle {
  0%, 100% { transform: scale(1); }
  45% { transform: scale(1.09); }
}
.sidebar-update:not(:disabled):hover .sidebar-update-disc { background: var(--green-fill-hover); }
.sidebar-update:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.sidebar-update:disabled { opacity: 1; cursor: wait; }
@media (prefers-reduced-motion: reduce) {
  .sidebar-update-disc { transition: none; animation: none; }
  .sidebar-update-fireworks { display: none; }
}
</style>
