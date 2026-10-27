<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { Focus, GitFork, Minus, Plus, Settings2, X } from 'lucide-vue-next';
import { documentLinks } from '@tano/editor/document-links';
import type { DocumentLink } from '@tano/editor/document-links';
import { useWorkspaceStore } from '../stores/workspace';
import { buildDocumentGraph, graphDocuments } from '../document-graph';
import { createGraphLayout, graphPhysics, nodeRadius } from '../graph-layout';
import type { LayoutNode } from '../graph-layout';

const props = withDefaults(defineProps<{ controlsTarget?: string; openInNewTab?: boolean }>(), {
  openInNewTab: true,
});

const store = useWorkspaceStore();
const host = ref<HTMLElement>();
const viewport = ref<SVGSVGElement>();
const size = reactive({ width: 800, height: 600 });
const camera = reactive({ x: 0, y: 0, k: 1 });
const physics = reactive({ ...graphPhysics });
const layout = shallowRef<ReturnType<typeof createGraphLayout>>();
const hovered = ref('');
const focused = ref('');
const dragging = ref(false);
const panning = ref(false);
const settings = ref(false);
const loading = ref(false);
const failed = ref<string[]>([]);
const visible = ref(false);
let renderFrame: number | undefined;
let cameraFrame: number | undefined;
let pendingZoom = 1;
let pendingZoomAnchor = { x: 0, y: 0 };
let zoomEndTimer: ReturnType<typeof setTimeout> | undefined;
const zooming = ref(false);
const highlighted = computed(() => hovered.value || focused.value);
const neighbours = computed(() => {
  const result = new Set([highlighted.value]);
  for (const edge of layout.value?.edges ?? []) {
    if (edge.source.id === highlighted.value) result.add(edge.target.id);
    if (edge.target.id === highlighted.value) result.add(edge.source.id);
  }
  return result;
});
const nodes = computed(() => layout.value?.nodes ?? []);
const nodeElements = new Map<string, Element>();
const edgeElements = new Map<string, Element>();
watch(layout, () => {
  nodeElements.clear();
  edgeElements.clear();
  viewport.value?.querySelectorAll('[data-node]').forEach((el) =>
    nodeElements.set(el.getAttribute('data-node')!, el));
  viewport.value?.querySelectorAll('[data-edge]').forEach((el) =>
    edgeElements.set(el.getAttribute('data-edge')!, el));
  paintPositions();
}, { flush: 'post' });
const transform = computed(
  () => `translate(${size.width / 2 + camera.x},${size.height / 2 + camera.y}) scale(${camera.k})`,
);
const cache = new Map<
  string,
  { stamp: string; draft: string | undefined; links: DocumentLink[] }
>();
let revision = 0;
let signature = '';
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
let suppressClick = false;
let gesture:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      moved: boolean;
      node?: LayoutNode;
      offsetX: number;
      offsetY: number;
    }
  | undefined;

function paintPositions() {
  for (const node of nodes.value) {
    nodeElements.get(node.id)?.setAttribute('transform', `translate(${node.x},${node.y})`);
  }
  for (const edge of layout.value?.edges ?? []) {
    const el = edgeElements.get(edge.id);
    el?.setAttribute('x1', String(edge.source.x));
    el?.setAttribute('y1', String(edge.source.y));
    el?.setAttribute('x2', String(edge.target.x));
    el?.setAttribute('y2', String(edge.target.y));
  }
}
function renderTick() {
  // Coordinates bypass Vue's template diff; only existing SVG attributes change.
  if (renderFrame !== undefined) return;
  if (typeof requestAnimationFrame !== 'undefined') {
    renderFrame = requestAnimationFrame(() => {
      renderFrame = undefined;
      paintPositions();
    });
  } else {
    paintPositions();
  }
}
function fit() {
  const all = layout.value?.nodes ?? [];
  if (!all.length) return;
  const left = Math.min(...all.map((node) => node.x - 70));
  const right = Math.max(...all.map((node) => node.x + 70));
  const top = Math.min(...all.map((node) => node.y - 25));
  const bottom = Math.max(...all.map((node) => node.y + 40));
  camera.k = Math.max(
    0.12,
    Math.min(
      1.5,
      (size.width - 80) / Math.max(1, right - left),
      (size.height - 140) / Math.max(1, bottom - top),
    ),
  );
  camera.x = (-(left + right) / 2) * camera.k;
  camera.y = (-(top + bottom) / 2) * camera.k;
}
function replaceLayout(graph: Parameters<typeof createGraphLayout>[0], first = false) {
  cancelGesture();
  const previous = layout.value?.nodes;
  layout.value?.simulation.stop();
  layout.value = createGraphLayout(graph, previous, physics);
  layout.value.simulation.on('tick', renderTick);
  if (first) {
    const count = layout.value.nodes.length;
    // A partially settled layout appears immediately and lets the browser
    // remain responsive while the remaining simulation runs in the background.
    layout.value.simulation.tick(count > 600 ? 28 : count > 300 ? 42 : 80);
    fit();
  }
  renderTick();
  if (visible.value) layout.value.simulation.restart();
}
async function reload() {
  const workspace = store.workspace;
  if (!visible.value || !workspace) return;
  const version = ++revision;
  const expected = { id: workspace.id, path: workspace.path };
  const files = graphDocuments(workspace.files);
  const links = new Map<string, DocumentLink[]>();
  const errors: string[] = [];
  loading.value = true;
  for (const file of files) {
    if (version !== revision || !visible.value) return;
    const stamp = JSON.stringify([file.path, file.size, file.modified]);
    const draft = store.documents.find((doc) => doc.id === file.id)?.content;
    const cached = cache.get(file.id);
    try {
      if (cached && cached.stamp === stamp && cached.draft === draft)
        links.set(file.id, cached.links);
      else {
        const content = draft ?? (await store.readGraphDocument(expected, file));
        if (version !== revision || !visible.value) return;
        const parsed = documentLinks(content);
        links.set(file.id, parsed);
        cache.set(file.id, { stamp, draft, links: parsed });
      }
    } catch {
      cache.delete(file.id);
      errors.push(file.path);
    }
  }
  if (
    version !== revision ||
    !visible.value ||
    store.workspace?.id !== expected.id ||
    store.workspace.path !== expected.path
  )
    return;
  const ids = new Set(files.map((file) => file.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  const graph = buildDocumentGraph(files, links, store.relations);
  const nextSignature = JSON.stringify(graph);
  if (nextSignature !== signature) {
    replaceLayout(graph, !layout.value?.nodes.length);
    signature = nextSignature;
  }
  failed.value = errors;
  loading.value = false;
}
function scheduleReload() {
  revision++;
  clearTimeout(reloadTimer);
  if (visible.value) reloadTimer = setTimeout(() => void reload(), 120);
}
function refresh() {
  cache.clear();
  void reload();
}
watch(
  () => [
    store.workspace?.files,
    store.documents.map((doc) => [doc.id, doc.content]),
    store.relations,
  ],
  scheduleReload,
  { deep: true },
);
watch(physics, () => {
  if (!layout.value) return;
  replaceLayout({
    nodes: layout.value.nodes,
    edges: layout.value.edges.map((edge) => ({
      id: edge.id,
      source: edge.source.id,
      target: edge.target.id,
    })),
  });
});

function localPoint(event: { clientX: number; clientY: number }) {
  const rect = viewport.value!.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * size.width) / rect.width,
    y: ((event.clientY - rect.top) * size.height) / rect.height,
  };
}
function worldPoint(event: { clientX: number; clientY: number }) {
  const point = localPoint(event);
  return {
    x: (point.x - size.width / 2 - camera.x) / camera.k,
    y: (point.y - size.height / 2 - camera.y) / camera.k,
  };
}
function zoom(factor: number, anchor = { x: size.width / 2, y: size.height / 2 }) {
  if (gesture) return;
  const k = Math.max(0.12, Math.min(4, camera.k * factor));
  const ratio = k / camera.k;
  camera.x = anchor.x - size.width / 2 - (anchor.x - size.width / 2 - camera.x) * ratio;
  camera.y = anchor.y - size.height / 2 - (anchor.y - size.height / 2 - camera.y) * ratio;
  camera.k = k;
}
function wheel(event: WheelEvent) {
  const delta =
    event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
  pendingZoom *= Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002);
  pendingZoomAnchor = localPoint(event);
  zooming.value = true;
  clearTimeout(zoomEndTimer);
  zoomEndTimer = setTimeout(() => (zooming.value = false), 120);
  if (cameraFrame !== undefined) return;
  const apply = () => {
    cameraFrame = undefined;
    const factor = pendingZoom;
    pendingZoom = 1;
    zoom(factor, pendingZoomAnchor);
  };
  if (typeof requestAnimationFrame !== 'undefined') cameraFrame = requestAnimationFrame(apply);
  else apply();
}
function startGesture(event: PointerEvent, node?: LayoutNode) {
  if (event.button !== 0 || !event.isPrimary || gesture) return;
  event.preventDefault();
  paintPositions();
  const point = worldPoint(event);
  gesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: camera.x,
    y: camera.y,
    moved: false,
    node,
    offsetX: node ? node.x - point.x : 0,
    offsetY: node ? node.y - point.y : 0,
  };
  viewport.value?.setPointerCapture(event.pointerId);
  if (node) {
    node.fx = node.x;
    node.fy = node.y;
    hovered.value = node.id;
  } else {
    hovered.value = '';
    focused.value = '';
  }
}
function moveGesture(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const dx = event.clientX - gesture.startX,
    dy = event.clientY - gesture.startY;
  if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
  if (!gesture.moved && gesture.node) {
    // Reheat once when dragging begins. All nodes continue responding to forces;
    // subsequent pointer events only update the dragged node's fixed position.
    const simulation = layout.value?.simulation;
    simulation?.alpha(Math.max(simulation.alpha(), 0.18)).alphaTarget(0.18).restart();
  }
  gesture.moved = true;
  if (gesture.node) {
    dragging.value = true;
    const point = worldPoint(event);
    gesture.node.x = gesture.node.fx = point.x + gesture.offsetX;
    gesture.node.y = gesture.node.fy = point.y + gesture.offsetY;
    renderTick();
  } else {
    panning.value = true;
    const rect = viewport.value!.getBoundingClientRect();
    camera.x = gesture.x + (dx * size.width) / rect.width;
    camera.y = gesture.y + (dy * size.height) / rect.height;
  }
}
function cancelGesture() {
  const previous = gesture;
  if (previous?.node) paintPositions();
  gesture = undefined;
  dragging.value = false;
  panning.value = false;
  if (previous?.node) {
    previous.node.fx = null;
    previous.node.fy = null;
  }
  layout.value?.simulation.alphaTarget(0);
  if (previous && viewport.value?.hasPointerCapture(previous.pointerId))
    viewport.value.releasePointerCapture(previous.pointerId);
}
function endGesture(event: PointerEvent, cancelled = false) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const { node, moved } = gesture;
  suppressClick = moved || cancelled;
  cancelGesture();
  if (node && !moved && !cancelled) openNode(node.id);
  hovered.value = '';
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    suppressClick = false;
  }, 0);
}
function openNode(id: string) {
  const file = store.workspace?.files.find((file) => file.id === id);
  if (file) void (props.openInNewTab ? store.openFileInNewTab(file) : store.openFile(file));
}
function accessibleClick(event: MouseEvent, id: string) {
  // Pointer activation is handled on release because SVG owns pointer capture.
  if (event.detail === 0 && !suppressClick) openNode(id);
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancelGesture();
    settings.value = false;
    hovered.value = '';
    return;
  }
  if (event.target !== viewport.value) return;
  if (event.key === '+' || event.key === '=') zoom(1.2);
  else if (event.key === '-') zoom(1 / 1.2);
  else if (event.key === '0') fit();
  else if (event.key === 'ArrowLeft') camera.x += 40;
  else if (event.key === 'ArrowRight') camera.x -= 40;
  else if (event.key === 'ArrowUp') camera.y += 40;
  else if (event.key === 'ArrowDown') camera.y -= 40;
  else return;
  event.preventDefault();
}
function activate() {
  if (visible.value) return;
  visible.value = true;
  void reload();
  if (layout.value && layout.value.simulation.alpha() > layout.value.simulation.alphaMin())
    layout.value.simulation.restart();
}
function deactivate() {
  visible.value = false;
  revision++;
  clearTimeout(reloadTimer);
  cancelGesture();
  layout.value?.simulation.stop();
  hovered.value = '';
  focused.value = '';
}
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (rect && rect.width > 0 && rect.height > 0) {
      size.width = rect.width;
      size.height = rect.height;
    }
  });
  if (host.value) {
    const rect = host.value.getBoundingClientRect();
    if (rect.width && rect.height) {
      size.width = rect.width;
      size.height = rect.height;
    }
    observer.observe(host.value);
  }
  activate();
});
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => {
  deactivate();
  if (renderFrame !== undefined && typeof cancelAnimationFrame !== 'undefined')
    cancelAnimationFrame(renderFrame);
  if (cameraFrame !== undefined && typeof cancelAnimationFrame !== 'undefined')
    cancelAnimationFrame(cameraFrame);
  renderFrame = undefined;
  cameraFrame = undefined;
  clearTimeout(zoomEndTimer);
  observer?.disconnect();
  clearTimeout(clickTimer);
});
</script>

<template>
  <main
    ref="host"
    class="relation-graph"
    :class="{ 'has-topbar': controlsTarget }"
    :aria-label="t('关系图谱')"
  >
    <LoadingSkeleton v-if="store.workspaceLoading?.objects || store.workspaceLoading?.relations" variant="document" :rows="6" />
    <div v-show="!store.workspaceLoading?.objects && !store.workspaceLoading?.relations" class="component-loading-content">
    <svg
      ref="viewport"
      class="graph-viewport"
      :class="{ 'is-dragging': dragging, 'is-panning': panning, 'is-zooming': zooming }"
      :viewBox="`0 0 ${size.width} ${size.height}`"
      tabindex="0"
      role="group"
      :aria-label="t('文档关系网络，可拖动节点；方向键平移，加减键缩放，0 键居中')"
      @pointerdown="startGesture($event)"
      @pointermove="moveGesture"
      @pointerup="endGesture($event)"
      @pointercancel="endGesture($event, true)"
      @lostpointercapture="cancelGesture"
      @pointerleave="!gesture && (hovered = '')"
      @wheel.prevent="wheel"
      @keydown="keyboard"
    >
      <g :transform="transform">
        <g class="graph-edges" aria-hidden="true">
          <line
            v-for="edge in layout?.edges ?? []"
            :key="edge.id"
            :data-edge="edge.id"
            :class="{
              highlighted:
                highlighted && (edge.source.id === highlighted || edge.target.id === highlighted),
              dimmed:
                highlighted && edge.source.id !== highlighted && edge.target.id !== highlighted,
            }"
            :x1="edge.source.x"
            :y1="edge.source.y"
            :x2="edge.target.x"
            :y2="edge.target.y"
          />
        </g>
        <g
          v-for="node in nodes"
          :key="node.id"
          class="graph-node"
          :data-node="node.id"
          :transform="`translate(${node.x},${node.y})`"
          :class="{
            highlighted: node.id === highlighted,
            neighbour: highlighted && neighbours.has(node.id),
            dimmed: highlighted && !neighbours.has(node.id),
            orphan: !node.degree,
          }"
          role="link"
          tabindex="0"
          :aria-label="t('打开文档：{0}，{1} 条连线', [node.label, node.degree])"
          @pointerdown.stop="startGesture($event, node)"
          @pointerenter="!gesture && (hovered = node.id)"
          @pointerleave="!gesture && (hovered = '')"
          @focus="focused = node.id"
          @blur="focused = ''"
          @click.stop="accessibleClick($event, node.id)"
          @keydown.enter.stop.prevent="openNode(node.id)"
          @keydown.space.stop.prevent="openNode(node.id)"
        >
          <title>{{ node.path }}</title>
          <circle class="graph-node-hit" :r="Math.max(16, nodeRadius(node) + 8)" />
          <circle class="graph-node-halo" :r="nodeRadius(node) + 5" />
          <circle class="graph-node-dot" :r="nodeRadius(node)" />
          <text
            v-if="nodes.length < 180 || camera.k > 0.85 || neighbours.has(node.id)"
            :y="nodeRadius(node) + 17"
            text-anchor="middle"
          >
            {{ node.label }}
          </text>
        </g>
      </g>
    </svg>
    <Teleport v-if="visible" :to="controlsTarget ?? 'body'" :disabled="!controlsTarget" defer>
      <div
        class="graph-controls"
        :class="{ 'graph-controls-inline': controlsTarget }"
        role="group"
        :aria-label="t('图谱操作')"
      >
        <button
          class="icon-button"
          :data-tooltip="t('布局设置')"
          :aria-label="t('布局设置')"
          :aria-expanded="settings"
          @click="settings = !settings"
        >
          <Settings2 :size="17" />
        </button>
        <button class="icon-button" :data-tooltip="t('放大')" :aria-label="t('放大图谱')" @click="zoom(1.25)">
          <Plus :size="17" />
        </button>
        <button class="icon-button" :data-tooltip="t('缩小')" :aria-label="t('缩小图谱')" @click="zoom(0.8)">
          <Minus :size="17" />
        </button>
        <button class="icon-button" :data-tooltip="t('适应窗口 · 0')" :aria-label="t('图谱居中')" @click="fit">
          <Focus :size="17" />
        </button>
      </div>
    </Teleport>
    <section
      v-if="settings"
      class="graph-settings"
      :aria-label="t('布局设置')"
      @keydown.esc.stop="settings = false"
    >
      <header>
        <strong>{{ t('布局设置') }}</strong
        ><button class="icon-button" :aria-label="t('关闭布局设置')" @click="settings = false">
          <X :size="15" />
        </button>
      </header>
      <label
        >{{ t('向心力') }}<input
          v-model.number="physics.center"
          :aria-label="t('向心力')"
          type="range"
          min="0.002"
          max="0.08"
          step="0.002"
      /></label>
      <label
        >{{ t('吸引力') }}<input
          v-model.number="physics.attraction"
          :aria-label="t('吸引力')"
          type="range"
          min="0.02"
          max="0.4"
          step="0.01"
      /></label>
      <label
        >{{ t('斥力') }}<input
          v-model.number="physics.repulsion"
          :aria-label="t('斥力')"
          type="range"
          min="0"
          max="1200"
          step="20"
      /></label>
      <label
        >{{ t('连线长度') }}<input
          v-model.number="physics.distance"
          :aria-label="t('连线长度')"
          type="range"
          min="50"
          max="240"
          step="5"
      /></label>
      <button class="graph-reset" @click="Object.assign(physics, graphPhysics)">
        {{ t('恢复默认布局参数') }}
      </button>
    </section>
    <LoadingSkeleton v-if="loading && !nodes.length" :rows="6" />
    <div v-if="!loading && !nodes.length" class="graph-empty">
      <GitFork :size="32" />
      <p>{{ t('工作区还没有 Markdown 文档') }}</p>
      <span>{{ t('创建文档后，即可在这里查看它们的关系。') }}</span>
    </div>
    <div
      v-if="failed.length || store.relationError"
      class="graph-warning"
      role="status"
      :title="failed.join('\n')"
    >
      {{ failed.length ? t('有 {0} 篇文档未能读取，图谱可能不完整。', [failed.length]) : ''
      }}{{ store.relationError }}
      <button @click="refresh">{{ t('重试') }}</button>
    </div>
    <footer class="graph-help">{{ t('拖动节点或空白处 · 滚轮缩放 · 点击节点打开文档') }}</footer>
    </div>
  </main>
</template>

<style scoped>
.relation-graph {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
}
.graph-viewport {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.graph-viewport.is-panning,
.graph-viewport.is-dragging,
.is-dragging .graph-node {
  cursor: grabbing;
}
.graph-viewport.is-panning .graph-node text,
.graph-viewport.is-dragging .graph-node text {
  display: none;
}
.graph-viewport.is-zooming .graph-node,
.graph-viewport.is-zooming .graph-edges line {
  transition: none;
}
.graph-viewport:focus-visible {
  outline: 1px solid var(--line);
  outline-offset: -2px;
}
.graph-edges line {
  stroke: var(--graph-edge, #c5ccd1);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  transition:
    opacity 120ms,
    stroke 120ms;
}
.graph-edges line.highlighted {
  stroke: var(--green);
  stroke-width: 1.7;
}
.graph-edges line.dimmed {
  opacity: 0.15;
}
.graph-node {
  cursor: pointer;
  outline: none;
  transition: opacity 120ms;
}
.graph-node-hit {
  fill: transparent;
}
.graph-node-dot {
  fill: var(--graph-node, #626971);
  transition: fill 120ms;
}
.graph-node.orphan .graph-node-dot {
  fill: var(--graph-orphan, #b2b8be);
}
.graph-node-halo {
  fill: var(--green);
  opacity: 0;
}
.graph-node.highlighted .graph-node-halo,
.graph-node:focus-visible .graph-node-halo {
  opacity: 0.12;
}
.graph-node.highlighted .graph-node-dot {
  fill: var(--green);
}
.graph-node.dimmed {
  opacity: 0.22;
}
.graph-node text {
  fill: var(--text-secondary);
  font-size: 12px;
  paint-order: stroke;
  stroke: var(--paper);
  stroke-width: 4px;
  stroke-linejoin: round;
}
.graph-node.highlighted text {
  fill: var(--green);
  font-weight: 600;
}
.graph-controls {
  position: absolute;
  right: 16px;
  top: 10px;
  display: flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.graph-controls .icon-button {
  width: 29px;
  height: 29px;
}
.graph-controls-inline {
  position: static;
  padding: 0;
  border: 0;
  background: transparent;
}
.has-topbar .graph-settings {
  top: var(--topbar-height, var(--workbench-topbar-height));
  right: 8px;
}
.graph-settings {
  position: absolute;
  top: 58px;
  right: 16px;
  width: 242px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 5px 24px #0000000c;
  font-size: 12px;
}
.graph-settings header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.graph-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
}
.graph-settings input {
  width: 130px;
  accent-color: var(--green);
}
.graph-reset {
  color: var(--muted);
  margin-top: 8px;
  padding: 6px 0;
}
.graph-help {
  position: absolute;
  bottom: 17px;
  width: 100%;
  text-align: center;
  pointer-events: none;
  font-size: 11px;
  color: var(--muted);
}
.graph-empty {
  position: absolute;
  top: 45%;
  width: 100%;
  text-align: center;
  color: var(--muted);
  pointer-events: none;
}
.graph-empty p {
  font-size: 14px;
  color: var(--text-secondary);
}
.graph-empty span {
  font-size: 12px;
}
.graph-warning {
  position: absolute;
  bottom: 44px;
  left: 20px;
  right: 20px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  font-size: 12px;
}
.graph-warning button {
  color: var(--green);
  text-decoration: underline;
}
@media (max-width: 600px) {
  .graph-controls {
    right: 12px;
  }
  .graph-settings {
    right: 12px;
  }
  .graph-help {
    font-size: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .graph-node,
  .graph-edges line,
  .graph-node-dot {
    transition: none;
  }
}
</style>
