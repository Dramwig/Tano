<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useId,
  watch,
} from 'vue';
import { Focus, GitFork, Grip, Minus, Plus, Settings2, X } from 'lucide-vue-next';
import { referenceKey } from '@tano/protocol';
import type { ReferenceIdentity } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import type { ReferenceContext } from '../content-references';
import { nodeRadius } from '../graph-layout';
import {
  createReferenceGraphLayout,
  referenceGraphPhysics,
  referenceEdgeCurve,
  referenceNodeLabel,
} from '../reference-graph-layout';
import type { LayoutEdge, LayoutNode } from '../graph-layout';

const props = withDefaults(
  defineProps<{
    identity: ReferenceIdentity;
    label: string;
    variant?: 'button' | 'menu' | 'panel';
    anchor?: HTMLElement;
  }>(),
  { variant: 'button' },
);
const emit = defineEmits<{ open: [identity: ReferenceIdentity] }>();
const opened = defineModel<boolean>('opened', { default: false });

const store = useWorkspaceStore();
const panel = ref<HTMLElement>();
const panelPosition = reactive({ x: 12, y: 56 });
const movingPanel = ref(false);
const graphHost = ref<HTMLElement>();
const viewport = ref<SVGSVGElement>();
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const context = ref<ReferenceContext>({ outgoing: [], incoming: [], errors: [] });
const size = reactive({ width: 680, height: 360 });
const camera = reactive({ x: 0, y: 0, k: 1 });
const physics = reactive({ ...referenceGraphPhysics });
const arrowId = `reference-graph-arrow-${useId()}`;
const layout = shallowRef<ReturnType<typeof createReferenceGraphLayout>>();
const tick = ref(0);
const hovered = ref('');
const focused = ref('');
const dragging = ref(false);
const panning = ref(false);
const settings = ref(false);
const highlighted = computed(() => hovered.value || focused.value);
const hoveredNode = computed(() =>
  nodes.value.find((node) => node.id === highlighted.value),
);
const hoveredReferences = computed(() => {
  const id = highlighted.value;
  if (!id) return [];
  const references = [
    ...context.value.outgoing
      .filter((edge) => referenceKey(edge.source) === id)
      .map((edge) => ({ direction: t('引用'), name: edge.name, excerpt: edge.excerpt })),
    ...context.value.incoming
      .filter((edge) => referenceKey(edge.target) === id)
      .map((edge) => ({ direction: t('被引用'), name: edge.source.name, excerpt: edge.excerpt })),
  ];
  return references.filter((reference, index) =>
    references.findIndex(
      (candidate) =>
        candidate.direction === reference.direction && candidate.name === reference.name &&
        candidate.excerpt === reference.excerpt,
    ) === index,
  );
});
const contextPreviewPosition = computed(() => {
  const node = hoveredNode.value;
  if (!node) return undefined;
  const width = 276;
  const x = size.width / 2 + camera.x + node.x * camera.k;
  const y = size.height / 2 + camera.y + node.y * camera.k;
  const maxTop = Math.max(8, size.height - 218);
  return {
    left: `${Math.max(width / 2 + 8, Math.min(size.width - width / 2 - 8, x))}px`,
    top: `${Math.max(8, Math.min(maxTop, y + 18))}px`,
  };
});
const nodes = computed(() => {
  void tick.value;
  return [...(layout.value?.nodes ?? [])];
});
const edges = computed(() => {
  const pairs = new Map<string, LayoutEdge & { bidirectional: boolean }>();
  // Merge only the rendered paths; layout and reference counts retain both directions.
  for (const edge of layout.value?.edges ?? []) {
    const key = JSON.stringify([edge.source.id, edge.target.id].sort());
    const existing = pairs.get(key);
    if (existing) existing.bidirectional = true;
    else pairs.set(key, { ...edge, bidirectional: false });
  }
  return [...pairs.values()];
});
const graph = computed(() => buildReferenceGraph(context.value, props.identity, props.label));
const total = computed(() => graph.value.nodes.length - 1);
const neighbours = computed(() => {
  const result = new Set([highlighted.value]);
  for (const edge of layout.value?.edges ?? []) {
    if (edge.source.id === highlighted.value) result.add(edge.target.id);
    if (edge.target.id === highlighted.value) result.add(edge.source.id);
  }
  return result;
});
const transform = computed(
  () => `translate(${size.width / 2 + camera.x},${size.height / 2 + camera.y}) scale(${camera.k})`,
);
let revision = 0;
let signature = '';
let initialLayout = true;
let fitOnMount = true;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
let panelObserver: ResizeObserver | undefined;
let positioned = false;
let panelGesture:
  | { pointerId: number; handle: HTMLElement; startX: number; startY: number; x: number; y: number }
  | undefined;
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

type ReferenceGraph = ReturnType<typeof buildReferenceGraph>;

function buildReferenceGraph(
  value: ReferenceContext,
  identity: ReferenceIdentity,
  label: string,
): {
  nodes: ReferenceGraphNode[];
  edges: ReferenceGraphEdge[];
  identities: Map<string, ReferenceIdentity>;
  meta: Map<string, ReferenceGraphMeta>;
} {
  const nodes = new Map<string, ReferenceGraphNode>();
  const edges = new Map<string, ReferenceGraphEdge>();
  const identities = new Map<string, ReferenceIdentity>();
  const meta = new Map<string, ReferenceGraphMeta>();
  const centerKey = referenceKey(identity);

  const addNode = (
    target: ReferenceIdentity,
    name: string,
    nodeMeta: ReferenceGraphMeta = { missing: false, archived: false },
  ) => {
    const key = referenceKey(target);
    const existing = nodes.get(key);
    if (existing) {
      if (existing.label === key && name) existing.label = name;
      const previous = meta.get(key)!;
      meta.set(key, {
        missing: previous.missing || nodeMeta.missing,
        archived: previous.archived || nodeMeta.archived,
      });
      return key;
    }
    nodes.set(key, { id: key, path: name || key, label: name || key, degree: 0 });
    identities.set(key, target);
    meta.set(key, nodeMeta);
    return key;
  };
  const addEdge = (source: string, target: string) => {
    if (source === target) return;
    const id = `${source}->${target}`;
    if (edges.has(id)) return;
    edges.set(id, { id, source, target });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };

  addNode(identity, label);
  for (const edge of value.incoming) {
    const source = addNode(edge.source, edge.source.name, {
      missing: false,
      archived: !!edge.source.archived,
    });
    addEdge(source, centerKey);
  }
  for (const edge of value.outgoing) {
    const target = addNode(edge.target, edge.name, {
      missing: edge.missing,
      archived: edge.archived,
    });
    addEdge(centerKey, target);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], identities, meta };
}

interface ReferenceGraphNode {
  id: string;
  path: string;
  label: string;
  degree: number;
}
interface ReferenceGraphEdge {
  id: string;
  source: string;
  target: string;
}
interface ReferenceGraphMeta {
  missing: boolean;
  archived: boolean;
}

function renderTick() {
  tick.value++;
}

function nodeLabel(node: LayoutNode) {
  const centerId = referenceKey(props.identity);
  const center = layout.value?.nodes.find((node) => node.id === centerId);
  return referenceNodeLabel(node, centerId, center?.x);
}

function fit() {
  const all = layout.value?.nodes ?? [];
  if (!all.length) return;
  const center = all.find((node) => node.id === referenceKey(props.identity))!;
  const labels = all.map(nodeLabel);
  const halfWidth =
    Math.max(
      ...all.map((node) => Math.abs(node.x - center.x) + nodeRadius(node)),
      ...labels.flatMap((label) => [
        Math.abs(label.left - center.x),
        Math.abs(label.right - center.x),
      ]),
    ) + 24;
  const halfHeight =
    Math.max(
      ...all.map((node) => Math.abs(node.y - center.y) + nodeRadius(node)),
      ...labels.flatMap((label) => [
        Math.abs(label.top - center.y),
        Math.abs(label.bottom - center.y),
      ]),
    ) + 24;
  camera.k = Math.max(
    0.22,
    Math.min(1.25, (size.width - 24) / (2 * halfWidth), (size.height - 48) / (2 * halfHeight)),
  );
  camera.x = -center.x * camera.k;
  camera.y = 12 - center.y * camera.k;
}

function cancelGesture() {
  const previous = gesture;
  gesture = undefined;
  dragging.value = false;
  panning.value = false;
  if (previous?.node) {
    // Only the pointer holds a node in place. Release it to the simulation at its current position.
    previous.node.fx = previous.node.fy = null;
    previous.node.vx = previous.node.vy = 0;
  }
  layout.value?.simulation.alphaTarget(0);
  if (previous && viewport.value?.hasPointerCapture(previous.pointerId))
    viewport.value.releasePointerCapture(previous.pointerId);
}

function replaceLayout(nextGraph: ReferenceGraph, first = false) {
  cancelGesture();
  const previous = layout.value?.nodes;
  layout.value?.simulation.stop();
  layout.value = createReferenceGraphLayout(
    nextGraph,
    referenceKey(props.identity),
    previous,
    physics,
  );
  layout.value.simulation.on('tick', renderTick);
  if (first) {
    layout.value.simulation.tick(200);
    fit();
  }
  renderTick();
  if (opened.value) layout.value.simulation.restart();
}

async function resetLayout() {
  Object.assign(physics, referenceGraphPhysics);
  await nextTick();
  cancelGesture();
  layout.value?.simulation.stop();
  layout.value = undefined;
  replaceLayout(graph.value, true);
}

async function load() {
  if (!store.workspace) return;
  const version = ++revision;
  loading.value = true;
  error.value = '';
  try {
    const result = await store.getReferenceContext(props.identity);
    if (version === revision) {
      context.value = result;
      loaded.value = true;
    }
  } catch (reason) {
    if (version === revision) {
      error.value = String(reason);
    }
  } finally {
    if (version === revision) loading.value = false;
  }
}

function close() {
  opened.value = false;
}

function constrainPanel(x = panelPosition.x, y = panelPosition.y) {
  const rect = panel.value?.getBoundingClientRect();
  if (!rect) return;
  panelPosition.x = Math.max(12, Math.min(x, window.innerWidth - rect.width - 12));
  panelPosition.y = Math.max(12, Math.min(y, window.innerHeight - rect.height - 12));
}

function resizePanel() {
  constrainPanel();
}

function cancelPanelDrag() {
  const previous = panelGesture;
  panelGesture = undefined;
  movingPanel.value = false;
  if (previous?.handle.hasPointerCapture(previous.pointerId))
    previous.handle.releasePointerCapture(previous.pointerId);
}

function startPanelDrag(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || panelGesture) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  panelGesture = {
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    x: panelPosition.x,
    y: panelPosition.y,
  };
  movingPanel.value = true;
  handle.setPointerCapture(event.pointerId);
}

function movePanel(event: PointerEvent) {
  if (!panelGesture || panelGesture.pointerId !== event.pointerId) return;
  constrainPanel(
    panelGesture.x + event.clientX - panelGesture.startX,
    panelGesture.y + event.clientY - panelGesture.startY,
  );
}

function endPanelDrag(event: PointerEvent) {
  if (panelGesture?.pointerId === event.pointerId) cancelPanelDrag();
}

function movePanelWithKeyboard(event: KeyboardEvent) {
  const offsets: Record<string, [number, number]> = {
    ArrowLeft: [-20, 0],
    ArrowRight: [20, 0],
    ArrowUp: [0, -20],
    ArrowDown: [0, 20],
  };
  const offset = offsets[event.key];
  if (!offset) return;
  event.preventDefault();
  event.stopPropagation();
  constrainPanel(panelPosition.x + offset[0], panelPosition.y + offset[1]);
}

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
  const k = Math.max(0.22, Math.min(4, camera.k * factor));
  const ratio = k / camera.k;
  camera.x = anchor.x - size.width / 2 - (anchor.x - size.width / 2 - camera.x) * ratio;
  camera.y = anchor.y - size.height / 2 - (anchor.y - size.height / 2 - camera.y) * ratio;
  camera.k = k;
}

function wheel(event: WheelEvent) {
  const delta =
    event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
  zoom(Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), localPoint(event));
}

function startGesture(event: PointerEvent, node?: LayoutNode) {
  if (event.button !== 0 || !event.isPrimary || gesture) return;
  event.preventDefault();
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
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
  gesture.moved = true;
  if (gesture.node) {
    dragging.value = true;
    const point = worldPoint(event);
    gesture.node.x = gesture.node.fx = point.x + gesture.offsetX;
    gesture.node.y = gesture.node.fy = point.y + gesture.offsetY;
    const simulation = layout.value?.simulation;
    simulation?.alpha(Math.max(simulation.alpha(), 0.18)).alphaTarget(0.18).restart();
    renderTick();
  } else {
    panning.value = true;
    const rect = viewport.value!.getBoundingClientRect();
    camera.x = gesture.x + (dx * size.width) / rect.width;
    camera.y = gesture.y + (dy * size.height) / rect.height;
  }
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
  const identity = graph.value.identities.get(id);
  const meta = graph.value.meta.get(id);
  if (identity && id !== referenceKey(props.identity) && !meta?.missing) {
    emit('open', identity);
  }
}

function accessibleClick(event: MouseEvent, id: string) {
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

function observeGraphHost() {
  observer?.disconnect();
  observer = undefined;
  const host = graphHost.value;
  if (!host) return;
  const resize = (rect: Pick<DOMRect, 'width' | 'height'>) => {
    if (rect.width > 0 && rect.height > 0) {
      size.width = rect.width;
      size.height = rect.height;
      if (fitOnMount) {
        fit();
        fitOnMount = false;
      }
    }
  };
  resize(host.getBoundingClientRect());
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) resize(rect);
    });
    observer.observe(host);
  }
}

const targetKey = computed(() =>
  JSON.stringify([store.workspace?.id, store.workspace?.path, referenceKey(props.identity)]),
);
watch([targetKey, () => store.referenceRevision], ([target], [previousTarget]) => {
  revision++;
  if (target !== previousTarget) {
    cancelGesture();
    layout.value?.simulation.stop();
    layout.value = undefined;
    signature = '';
    initialLayout = fitOnMount = true;
    loaded.value = false;
    error.value = '';
    hovered.value = focused.value = '';
    context.value = { outgoing: [], incoming: [], errors: [] };
  }
  if (opened.value) void load();
});
watch(
  () =>
    JSON.stringify([
      [...graph.value.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      [...graph.value.edges].sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  (nextSignature) => {
    if (nextSignature === signature) return;
    const first = initialLayout && graph.value.edges.length > 0;
    replaceLayout(graph.value, first);
    if (first) initialLayout = false;
    signature = nextSignature;
  },
  { immediate: true },
);
watch(physics, () => replaceLayout(graph.value));
watch(graphHost, observeGraphHost, { flush: 'post' });
watch(
  panel,
  (element) => {
    panelObserver?.disconnect();
    panelObserver = undefined;
    if (!element) return;
    if (!positioned) {
      const anchor = props.anchor?.getBoundingClientRect();
      constrainPanel((anchor?.left ?? 0) + 12, (anchor?.top ?? 44) + 12);
      positioned = true;
    } else constrainPanel();
    if (typeof ResizeObserver !== 'undefined') {
      panelObserver = new ResizeObserver(resizePanel);
      panelObserver.observe(element);
    }
  },
  { flush: 'post' },
);
watch(
  opened,
  (value) => {
    if (value) {
      layout.value?.simulation.restart();
      void load();
      void nextTick(() => panel.value?.focus({ preventScroll: true }));
    } else {
      settings.value = false;
      cancelPanelDrag();
      cancelGesture();
      layout.value?.simulation.stop();
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('resize', resizePanel);
  window.addEventListener('blur', cancelPanelDrag);
});
onBeforeUnmount(() => {
  revision++;
  clearTimeout(clickTimer);
  observer?.disconnect();
  panelObserver?.disconnect();
  cancelPanelDrag();
  cancelGesture();
  layout.value?.simulation.stop();
  window.removeEventListener('resize', resizePanel);
  window.removeEventListener('blur', cancelPanelDrag);
});
</script>

<template>
  <div
    v-if="props.variant !== 'panel'"
    class="reference-graph-popover-root"
    :class="{ 'is-menu-item': props.variant === 'menu' }"
  >
    <button
      type="button"
      class="reference-graph-trigger"
      :class="{ 'reference-graph-menu-trigger': props.variant === 'menu' }"
      aria-haspopup="dialog"
      :aria-expanded="opened"
      :aria-label="t('查看关系图谱')"
      :data-tooltip="t('查看关系图谱')"
      @click.stop="opened = true"
    >
      <GitFork :size="15" />
      <span>{{ t('查看关系图谱') }}</span>
    </button>
  </div>
  <Teleport to="body">
    <section
      v-if="opened"
      ref="panel"
      class="reference-graph-popover"
      :class="{ 'is-moving': movingPanel }"
      :style="{ left: `${panelPosition.x}px`, top: `${panelPosition.y}px` }"
      role="dialog"
      :aria-label="t('当前文档关系图谱')"
      :aria-description="props.label"
      tabindex="-1"
      @keydown.esc.stop="cancelPanelDrag"
    >
      <button
        type="button"
        class="icon-button reference-graph-overlay-button reference-graph-drag-handle"
        :aria-label="t('移动关系图谱面板')"
        :data-tooltip="t('拖动移动面板，也可使用方向键')"
        @pointerdown="startPanelDrag"
        @pointermove="movePanel"
        @pointerup="endPanelDrag"
        @pointercancel="endPanelDrag"
        @lostpointercapture="endPanelDrag"
        @keydown="movePanelWithKeyboard"
      >
        <Grip :size="16" />
      </button>
      <button
        type="button"
        class="icon-button reference-graph-overlay-button reference-graph-close"
        :aria-label="t('关闭关系图谱')"
        :data-tooltip="t('关闭')"
        @click="close"
      >
        <X :size="16" />
      </button>

      <p
        v-if="total && (error || context.errors.length)"
        class="reference-graph-warning"
        role="status"
      >
        {{ error ? t('引用关系更新失败：{0}', [error]) : context.errors[0] }}
      </p>
      <LoadingSkeleton v-if="loading && !loaded" :rows="5" />
      <div
        v-else-if="!total && (error || context.errors.length)"
        class="reference-graph-status is-error"
        role="alert"
      >
        {{ error || context.errors[0] }}
      </div>
      <div v-else-if="!total" class="reference-graph-status">{{ t('当前文档还没有直接引用关系') }}</div>
      <div v-else ref="graphHost" class="reference-graph-surface">
        <svg
          ref="viewport"
          class="reference-graph-canvas reference-graph-viewport"
          :class="{ 'is-dragging': dragging, 'is-panning': panning }"
          :viewBox="`0 0 ${size.width} ${size.height}`"
          tabindex="0"
          role="group"
          :aria-label="t('当前文档关系网络，可拖动节点；滚轮缩放，0 键居中')"
          @pointerdown="startGesture($event)"
          @pointermove="moveGesture"
          @pointerup="endGesture($event)"
          @pointercancel="endGesture($event, true)"
          @lostpointercapture="cancelGesture"
          @pointerleave="!gesture && (hovered = '')"
          @wheel.prevent="wheel"
          @keydown="keyboard"
        >
          <defs aria-hidden="true">
            <marker
              :id="arrowId"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
              refX="10"
              refY="5"
              viewBox="0 0 10 10"
            >
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="context-stroke" />
            </marker>
          </defs>
          <g :transform="transform">
            <g class="reference-graph-edges" aria-hidden="true">
              <path
                v-for="edge in edges"
                :key="edge.id"
                :data-source="edge.source.id"
                :data-target="edge.target.id"
                :d="referenceEdgeCurve(edge, edge.bidirectional)"
                :marker-start="edge.bidirectional ? `url(#${arrowId})` : undefined"
                :marker-end="`url(#${arrowId})`"
                :class="{
                  highlighted:
                    highlighted &&
                    (edge.source.id === highlighted || edge.target.id === highlighted),
                  dimmed:
                    highlighted && edge.source.id !== highlighted && edge.target.id !== highlighted,
                }"
              />
            </g>
            <g
              v-for="node in nodes"
              :key="node.id"
              class="reference-graph-node"
              :data-node="node.id"
              :transform="`translate(${node.x},${node.y})`"
              :class="{
                'reference-graph-center': node.id === referenceKey(props.identity),
                highlighted: node.id === highlighted,
                neighbour: highlighted && neighbours.has(node.id),
                dimmed: highlighted && !neighbours.has(node.id),
                orphan: !node.degree,
                archived: graph.meta.get(node.id)?.archived,
                missing: graph.meta.get(node.id)?.missing,
              }"
              role="link"
              tabindex="0"
              :aria-label="t('{0}，{1} 条引用关系', [node.label, node.degree])"
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
              <circle class="reference-graph-node-hit" :r="Math.max(16, nodeRadius(node) + 8)" />
              <circle class="reference-graph-node-halo" :r="nodeRadius(node) + 5" />
              <circle class="reference-graph-node-dot" :r="nodeRadius(node)" />
              <text
                :x="nodeLabel(node).x"
                :y="nodeLabel(node).y"
                :text-anchor="nodeLabel(node).anchor"
              >
                {{ nodeLabel(node).text }}
              </text>
            </g>
          </g>
        </svg>
        <div class="reference-graph-controls" role="group" :aria-label="t('图谱操作')">
          <button
            class="icon-button"
            :data-tooltip="t('布局设置')"
            :aria-label="t('布局设置')"
            :aria-expanded="settings"
            @click="settings = !settings"
          >
            <Settings2 :size="16" />
          </button>
          <button class="icon-button" :data-tooltip="t('放大')" :aria-label="t('放大图谱')" @click="zoom(1.25)">
            <Plus :size="16" />
          </button>
          <button class="icon-button" :data-tooltip="t('缩小')" :aria-label="t('缩小图谱')" @click="zoom(0.8)">
            <Minus :size="16" />
          </button>
          <button class="icon-button" :data-tooltip="t('适应窗口 · 0')" :aria-label="t('图谱居中')" @click="fit">
            <Focus :size="16" />
          </button>
        </div>
        <aside
          v-if="hoveredNode && hoveredReferences.length"
          class="reference-graph-context-preview"
          :style="contextPreviewPosition"
          aria-live="polite"
        >
          <strong>{{ hoveredNode.label }}</strong>
          <div
            v-for="(reference, index) in hoveredReferences.slice(0, 4)"
            :key="`${reference.direction}-${reference.name}-${index}`"
            class="reference-graph-context-item"
          >
            <span class="reference-graph-context-direction">{{ reference.direction }}</span>
            <span class="reference-graph-context-name">{{ reference.name }}</span>
            <p>{{ reference.excerpt || t('未找到可显示的上下文') }}</p>
          </div>
          <span v-if="hoveredReferences.length > 4" class="reference-graph-context-more">
            {{ t('还有') }} {{ hoveredReferences.length - 4 }} {{ t('条引用') }}
          </span>
        </aside>
        <section v-if="settings" class="reference-graph-settings" :aria-label="t('布局设置')">
          <header>
            <strong>{{ t('布局设置') }}</strong>
            <button class="icon-button" :aria-label="t('关闭布局设置')" @click="settings = false">
              <X :size="14" />
            </button>
          </header>
          <label
            >{{ t('向心力') }}<input
              v-model.number="physics.center"
              type="range"
              min="0.002"
              max="0.08"
              step="0.002"
          /></label>
          <label
            >{{ t('吸引力') }}<input
              v-model.number="physics.attraction"
              type="range"
              min="0.02"
              max="0.4"
              step="0.01"
          /></label>
          <label
            >{{ t('斥力') }}<input
              v-model.number="physics.repulsion"
              type="range"
              min="0"
              max="1200"
              step="20"
          /></label>
          <label
            >{{ t('连线长度') }}<input
              v-model.number="physics.distance"
              type="range"
              min="50"
              max="240"
              step="5"
          /></label>
          <button class="reference-graph-reset" @click="resetLayout">{{ t('恢复默认布局') }}</button>
        </section>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.reference-graph-popover-root {
  position: relative;
  display: inline-flex;
}
.reference-graph-popover-root.is-menu-item {
  display: block;
  width: 100%;
}
.reference-graph-popover-root.document-references {
  display: block;
  max-width: 780px;
  margin: 32px auto 0;
}
.reference-graph-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 12px;
  white-space: nowrap;
}
.reference-graph-trigger:hover,
.reference-graph-trigger[aria-expanded='true'] {
  color: var(--text);
  background: var(--hover);
}
.reference-graph-menu-trigger {
  width: 100%;
  min-height: 26px;
  justify-content: flex-start;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.reference-graph-menu-trigger:hover,
.reference-graph-menu-trigger[aria-expanded='true'] {
  background: var(--hover);
}
.reference-graph-popover {
  position: fixed;
  z-index: 40;
  width: min(700px, calc(100vw - 24px));
  height: min(480px, calc(100dvh - 24px));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 12px 32px #00000018;
}
.reference-graph-overlay-button {
  position: absolute;
  z-index: 3;
  top: 10px;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 2px 8px #00000006;
}
.reference-graph-drag-handle {
  left: 10px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.is-moving .reference-graph-drag-handle {
  cursor: grabbing;
}
.reference-graph-close {
  right: 10px;
}
.reference-graph-surface {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--paper);
}
.reference-graph-viewport {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.reference-graph-viewport.is-panning,
.reference-graph-viewport.is-dragging,
.is-dragging .reference-graph-node {
  cursor: grabbing;
}
.reference-graph-viewport:focus-visible {
  outline: 1px solid var(--line);
  outline-offset: -2px;
}
.reference-graph-edges path {
  stroke: var(--graph-edge, #c5ccd1);
  fill: none;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  transition:
    opacity 120ms,
    stroke 120ms;
}
.reference-graph-edges path.highlighted {
  stroke: var(--green);
  stroke-width: 1.7;
}
.reference-graph-edges path.dimmed {
  opacity: 0.15;
}
.reference-graph-node {
  cursor: pointer;
  outline: none;
  transition: opacity 120ms;
}
.reference-graph-node-hit {
  fill: transparent;
}
.reference-graph-node-dot {
  fill: var(--graph-node, #626971);
  transition: fill 120ms;
}
.reference-graph-node.reference-graph-center .reference-graph-node-dot {
  fill: var(--green);
}
.reference-graph-node.orphan .reference-graph-node-dot {
  fill: var(--graph-orphan, #b2b8be);
}
.reference-graph-node-halo {
  fill: var(--green);
  opacity: 0;
}
.reference-graph-node.highlighted .reference-graph-node-halo,
.reference-graph-node:focus-visible .reference-graph-node-halo {
  opacity: 0.12;
}
.reference-graph-node.highlighted .reference-graph-node-dot {
  fill: var(--green);
}
.reference-graph-node.dimmed {
  opacity: 0.22;
}
.reference-graph-node.archived {
  opacity: 0.55;
}
.reference-graph-node.missing {
  opacity: 0.45;
  cursor: default;
}
.reference-graph-node text {
  fill: var(--text-secondary);
  font-size: 12px;
  paint-order: stroke;
  stroke: var(--paper);
  stroke-width: 4px;
  stroke-linejoin: round;
}
.reference-graph-node.highlighted text {
  fill: var(--green);
  font-weight: 600;
}
.reference-graph-controls {
  position: absolute;
  top: 10px;
  right: 54px;
  display: flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 2px 8px #00000006;
}
.reference-graph-controls .icon-button {
  width: 28px;
  height: 28px;
}
.reference-graph-context-preview {
  position: absolute;
  z-index: 3;
  top: 0;
  left: 0;
  width: 260px;
  max-height: 210px;
  overflow: auto;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  box-shadow: 0 8px 24px #0000001c;
  color: var(--text);
  pointer-events: none;
  transform: translateX(-50%);
}
.reference-graph-context-preview > strong {
  display: block;
  overflow: hidden;
  margin-bottom: 7px;
  color: var(--green);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-graph-context-item {
  padding: 6px 0;
  border-top: 1px solid var(--line);
  font-size: 11px;
}
.reference-graph-context-direction {
  color: var(--muted);
  margin-right: 5px;
}
.reference-graph-context-name {
  color: var(--text-secondary);
  font-weight: 600;
}
.reference-graph-context-item p {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--text-secondary);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.reference-graph-context-more {
  display: block;
  padding-top: 5px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 10px;
}
.reference-graph-settings {
  position: absolute;
  z-index: 2;
  top: 54px;
  right: 10px;
  width: 230px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 8px 22px #00000018;
}
.reference-graph-settings header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.reference-graph-settings header strong {
  font-size: 12px;
}
.reference-graph-settings header .icon-button {
  width: 24px;
  height: 24px;
}
.reference-graph-settings label {
  display: grid;
  grid-template-columns: 52px 1fr;
  align-items: center;
  gap: 8px;
  margin: 7px 0;
  color: var(--text-secondary);
  font-size: 11px;
}
.reference-graph-settings input {
  width: 100%;
  accent-color: var(--green);
}
.reference-graph-reset {
  width: 100%;
  margin-top: 5px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}
.reference-graph-reset:hover {
  background: var(--hover);
  color: var(--text);
}
.reference-graph-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.reference-graph-status.is-error {
  color: var(--danger);
}
.reference-graph-warning {
  position: absolute;
  z-index: 2;
  bottom: 10px;
  left: 10px;
  right: 10px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--paper);
  color: var(--danger);
  font-size: 11px;
}
@media (max-width: 600px) {
  .reference-graph-popover {
    height: min(64dvh, 480px);
  }
}
</style>
