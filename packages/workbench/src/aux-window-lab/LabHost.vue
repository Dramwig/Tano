<script setup lang="ts">
import { markRaw, nextTick, onBeforeUnmount, reactive, ref, shallowReactive } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import LabPopup from './LabPopup.vue';
import { nativeLabelOf, openAuxWindow, type AuxWindow } from './aux-window';
import {
  countFrames, countGlobalEvents, nextPaint, realmProbe, selectionOwner, toMarkdown, watchBodyLeaks,
  type EventCounts, type ProbeResult,
} from './probes';

type Entry = {
  index: number;
  aux: AuxWindow;
  label: string | null;
  ownBridge: boolean;
  content: string;
  stopEvents: () => void;
};

const SAMPLE = `# 辅助窗口原型

这段内容由**主窗口的 Vue 应用**渲染进新窗口，两边共用同一份状态。

- 试着输入英文和中文
- 输入 \`/\` 打开斜杠菜单
- 选中文字看浮动工具栏

> 主窗口面板会实时显示这里的字数。
`;

const windows = shallowReactive<Entry[]>([]);
const results = reactive<ProbeResult[]>([]);
const events = ref<EventCounts | null>(null);
const selection = ref('');
const busy = ref(false);
const copied = ref(false);
const notes = ref('');
const hostLabel = getCurrentWindow().label;
let counter = 0;

const manual = reactive([
  '在弹窗编辑器里输入英文',
  '中文输入法输入，候选框跟随光标',
  '输入 “/” 后斜杠菜单出现在弹窗内',
  '选中文字后浮动工具栏出现在弹窗内',
  'Ctrl+B 加粗、Ctrl+Z 撤销在弹窗里生效',
  '复制粘贴（含从其他程序粘贴）',
  '拖动区 A（data-tauri-drag-region）能拖动窗口',
  '拖动区 B（主窗口调用 startDragging）能拖动窗口',
  '最小化 / 最大化 / 关闭按钮',
  '弹窗拖到缩放比例不同的另一块显示器后显示正常',
  '主窗口最小化时，弹窗里的光标和动画仍然流畅',
  '关闭主窗口时弹窗一起关闭',
  '弹窗里右键“检查”或 F12 能打开开发者工具',
  'Alt+Tab 和任务栏里弹窗是独立窗口',
].map((label) => ({ label, state: '未测', note: '' })));

function record(result: ProbeResult) {
  const index = results.findIndex((item) => item.id === result.id);
  if (index >= 0) results.splice(index, 1, result);
  else results.push(result);
}

/** Native label of the popup: its own bridge if injected, else the new auxlab-popup-* window. */
async function findLabel(popup: Window, before: Set<string>) {
  const own = nativeLabelOf(popup);
  if (own) return own;
  for (let attempt = 0; attempt < 10; attempt++) {
    const added = (await getAllWebviewWindows()).map((window) => window.label)
      .filter((label) => !before.has(label) && label.startsWith('auxlab-popup-'));
    if (added.length) return added[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

const leaks = watchBodyLeaks(document, () => [document.getElementById('app')!].filter(Boolean));

async function openPopup() {
  if (busy.value) return;
  busy.value = true;
  try {
    const before = new Set((await getAllWebviewWindows()).map((window) => window.label));
    const started = performance.now();
    const index = ++counter;
    const aux = openAuxWindow({
      name: `aux-lab-${index}`,
      title: `辅助窗口 ${index}（原型）`,
      width: 920,
      height: 660,
      left: window.screenX + 80 + index * 32,
      top: window.screenY + 60 + index * 32,
    });
    const entry = reactive({
      index, aux: markRaw(aux), label: null as string | null, ownBridge: false, content: SAMPLE,
      stopEvents: () => {},
    }) as Entry;
    windows.push(entry);
    await nextTick();
    await nextPaint(aux.window);
    const paintMs = performance.now() - started;
    entry.label = await findLabel(aux.window, before);
    entry.ownBridge = !!nativeLabelOf(aux.window);
    entry.stopEvents = countGlobalEvents(window, aux.window, (counts) => {
      events.value = { host: { ...counts.host }, popup: { ...counts.popup } };
    });
    void aux.closed.then(() => {
      entry.stopEvents();
      const at = windows.indexOf(entry);
      if (at >= 0) windows.splice(at, 1);
      record({ id: 'close', title: '弹窗关闭后内容被卸载', status: 'pass', detail: `窗口 ${index} 关闭，pagehide/轮询已触发，Teleport 内容已移除` });
    });

    record({ id: 'open', title: 'window.open 返回可用窗口', status: 'pass', detail: `window.open 用时 ${aux.openMs.toFixed(1)}ms；点击到编辑器首帧 ${paintMs.toFixed(0)}ms` });
    record({
      id: 'opener', title: '新窗口与主窗口同源、共享 JS', status: aux.window.opener === window ? 'pass' : 'fail',
      detail: `popup.opener === window：${aux.window.opener === window}；能直接读写 popup.document`,
    });
    record({
      id: 'native', title: '新窗口是一个 Tauri 管理的原生窗口', status: entry.label ? 'pass' : 'fail',
      detail: entry.label ? `label = ${entry.label}` : 'getAllWebviewWindows 里没有出现 auxlab-popup-*：可能走了 WebView2 默认弹窗，而不是 on_new_window',
    });
    record({
      id: 'bridge', title: '弹窗有自己的 Tauri IPC 桥接', status: entry.ownBridge ? 'info' : 'warn',
      detail: entry.ownBridge
        ? `popup.__TAURI_INTERNALS__ 存在，label = ${nativeLabelOf(aux.window)}。data-tauri-drag-region 等注入脚本在弹窗里可用。`
        : '弹窗里没有 __TAURI_INTERNALS__：标题栏拖动、窗口按钮都只能由主窗口按 label 代为调用。',
    });
    record({
      id: 'current-window', title: '共享 JS 中 getCurrentWindow() 指向哪个窗口', status: 'warn',
      detail: `在弹窗里运行的代码调用 getCurrentWindow() 得到 "${getCurrentWindow().label}"，不是 "${entry.label}"。凡是用 getCurrentWindow() 的地方都要改成按界面所在窗口查找。`,
    });
    const hostPaper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    const popupPaper = aux.window.getComputedStyle(aux.document.documentElement).getPropertyValue('--paper').trim();
    record({
      id: 'styles', title: '样式和主题变量同步到弹窗', status: hostPaper && hostPaper === popupPaper ? 'pass' : 'fail',
      detail: `复制了 ${aux.styles()} 个样式节点；--paper 主窗口 = "${hostPaper}"，弹窗 = "${popupPaper}"`,
    });
    for (const result of realmProbe(window, aux.window, aux.mount)) record(result);
  } catch (error) {
    record({ id: 'open', title: 'window.open 返回可用窗口', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    busy.value = false;
  }
}

async function nativeOf(entry: Entry) {
  return entry.label ? WebviewWindow.getByLabel(entry.label) : null;
}
async function hostDrag(entry: Entry) {
  try { await (await nativeOf(entry))?.startDragging(); }
  catch (error) { record({ id: 'drag-b', title: '主窗口代为 startDragging', status: 'fail', detail: String(error) }); }
}
async function windowAction(entry: Entry, action: 'minimize' | 'toggleMaximize' | 'close') {
  try {
    const native = await nativeOf(entry);
    if (native) await native[action]();
    else if (action === 'close') entry.aux.close();
  } catch (error) {
    record({ id: `action-${action}`, title: `窗口按钮：${action}`, status: 'fail', detail: String(error) });
  }
}

async function measureMinimizedFrames() {
  const entry = windows[0];
  if (!entry || busy.value) return;
  busy.value = true;
  try {
    const baseline = await countFrames(window, entry.aux.window, 1000);
    await getCurrentWindow().minimize();
    const minimized = await countFrames(window, entry.aux.window, 2000);
    await getCurrentWindow().unminimize();
    await getCurrentWindow().setFocus();
    const starved = minimized.hostFrames < baseline.hostFrames;
    record({
      id: 'raf', title: '主窗口最小化时的动画帧', status: starved ? 'warn' : 'pass',
      detail: `正常 1 秒：主窗口 ${baseline.hostFrames} 帧 / 弹窗 ${baseline.popupFrames} 帧；最小化 2 秒：主窗口 ${minimized.hostFrames} 帧 / 弹窗 ${minimized.popupFrames} 帧。` +
        (starved ? ' 现有动效都用主窗口的 requestAnimationFrame，主窗口最小化后弹窗里的动画会停。' : ''),
    });
  } finally {
    busy.value = false;
  }
}

const selectionTimer = setInterval(() => {
  const entry = windows[0];
  if (!entry) { selection.value = ''; return; }
  const owner = selectionOwner(window, entry.aux.window, entry.aux.mount.querySelector('.ProseMirror'));
  selection.value = `window.getSelection()（主窗口）看到光标：${owner.host ? '是' : '否'}；popup.getSelection() 看到光标：${owner.popup ? '是' : '否'}`;
}, 500);

function snapshotLeaks() {
  record({
    id: 'leaks', title: '浮层没有被插入到主窗口 body', status: leaks.leaked.length ? 'fail' : 'pass',
    detail: leaks.leaked.length
      ? `主窗口 body 新增了 ${leaks.leaked.length} 个节点：${[...new Set(leaks.leaked)].slice(0, 8).join('、')}（来自 <Teleport to="body"> 或 document.body.append）`
      : '目前没有。请先在弹窗里打开斜杠菜单、选中文字后再点“生成报告”。',
  });
  if (events.value) {
    const { host, popup } = events.value;
    record({
      id: 'events', title: '弹窗里的键盘/指针事件到达哪个窗口的全局监听', status: popup.keydown && !host.keydown ? 'warn' : 'info',
      detail: `keydown 主窗口 ${host.keydown} / 弹窗 ${popup.keydown}；pointerdown 主窗口 ${host.pointerdown} / 弹窗 ${popup.pointerdown}。挂在主窗口 window 上的快捷键、点外部关闭菜单等监听收不到弹窗里的事件。`,
    });
  }
  if (selection.value) record({ id: 'selection', title: 'Selection API 的归属', status: 'info', detail: selection.value });
}

const environment = () => ({
  'User Agent': navigator.userAgent,
  'devicePixelRatio': String(window.devicePixelRatio),
  '宿主窗口': hostLabel,
  '时间': new Date().toISOString(),
});

const report = ref('');
async function buildReport() {
  snapshotLeaks();
  report.value = toMarkdown(environment(), results, manual, notes.value);
  try {
    await navigator.clipboard.writeText(report.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1600);
  } catch {
    copied.value = false;
  }
}

onBeforeUnmount(() => {
  clearInterval(selectionTimer);
  leaks.stop();
  for (const entry of windows) { entry.stopEvents(); entry.aux.close(); }
});
</script>

<template>
  <div class="aux-lab">
    <header class="aux-lab-head">
      <div>
        <h1>辅助窗口原型</h1>
        <p>用 <code>window.open</code> 打开一个与本窗口共享 JS 的原生窗口，并把编辑器渲染进去。只在开发版可用。</p>
      </div>
      <div class="aux-lab-actions">
        <button type="button" class="primary" :disabled="busy" @click="openPopup">打开辅助窗口</button>
        <button type="button" :disabled="busy || !windows.length" @click="measureMinimizedFrames">测试主窗口最小化时的帧率</button>
        <button type="button" @click="buildReport">{{ copied ? '已复制' : '生成报告并复制' }}</button>
      </div>
    </header>

    <section v-if="windows.length" class="aux-lab-section">
      <h2>共享状态</h2>
      <p v-for="entry in windows" :key="entry.index">
        窗口 {{ entry.index }}（{{ entry.label ?? '无原生 label' }}）：{{ entry.content.length }} 个字符 — 在弹窗里输入，这里会实时变化。
      </p>
      <p v-if="selection" class="aux-lab-muted">{{ selection }}</p>
      <p v-if="events" class="aux-lab-muted">
        keydown 主窗口 {{ events.host.keydown }} / 弹窗 {{ events.popup.keydown }} ·
        pointerdown 主窗口 {{ events.host.pointerdown }} / 弹窗 {{ events.popup.pointerdown }}
      </p>
    </section>

    <section class="aux-lab-section">
      <h2>自动探测</h2>
      <p v-if="!results.length" class="aux-lab-muted">点击“打开辅助窗口”开始。</p>
      <table v-else>
        <tbody>
          <tr v-for="result in results" :key="result.id" :class="`is-${result.status}`">
            <td class="aux-lab-status">{{ { pass: '通过', fail: '失败', warn: '注意', info: '记录' }[result.status] }}</td>
            <td><strong>{{ result.title }}</strong><div class="aux-lab-muted">{{ result.detail }}</div></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="aux-lab-section">
      <h2>手动检查</h2>
      <table>
        <tbody>
          <tr v-for="item in manual" :key="item.label">
            <td>{{ item.label }}</td>
            <td class="aux-lab-choice">
              <select v-model="item.state"><option>未测</option><option>正常</option><option>异常</option></select>
            </td>
            <td><input v-model="item.note" placeholder="备注" /></td>
          </tr>
        </tbody>
      </table>
      <textarea v-model="notes" rows="4" placeholder="其他现象（卡顿、闪烁、报错……）" />
    </section>

    <section v-if="report" class="aux-lab-section">
      <h2>报告</h2>
      <pre>{{ report }}</pre>
    </section>

    <Teleport v-for="entry in windows" :key="entry.index" :to="entry.aux.mount">
      <LabPopup
        v-model="entry.content"
        :index="entry.index"
        :label="entry.label"
        :own-bridge="entry.ownBridge"
        @host-drag="hostDrag(entry)"
        @minimize="windowAction(entry, 'minimize')"
        @maximize="windowAction(entry, 'toggleMaximize')"
        @close="windowAction(entry, 'close')"
        @error="record({ id: `editor-${entry.index}`, title: '编辑器报错', status: 'fail', detail: $event })"
      />
    </Teleport>
  </div>
</template>

<style>
.aux-lab { height: 100vh; overflow: auto; padding: 24px 28px 40px; background: var(--paper); color: var(--text); font-size: 13px; }
.aux-lab h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
.aux-lab h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.aux-lab p { margin: 0 0 6px; }
.aux-lab-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
.aux-lab-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.aux-lab button { height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--text); }
.aux-lab button:hover:not(:disabled) { background: var(--hover); }
.aux-lab button.primary { background: var(--text); border-color: var(--text); color: var(--paper); }
.aux-lab button:disabled { opacity: .5; }
.aux-lab-section { padding: 14px 0; border-top: 1px solid var(--line); }
.aux-lab-muted { color: var(--muted); }
.aux-lab table { width: 100%; border-collapse: collapse; }
.aux-lab td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.aux-lab-status { width: 44px; font-weight: 600; }
.aux-lab tr.is-fail .aux-lab-status { color: var(--danger); }
.aux-lab tr.is-warn .aux-lab-status { color: var(--warning, var(--text)); }
.aux-lab-choice { width: 80px; }
.aux-lab input, .aux-lab select, .aux-lab textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); padding: 4px 6px; font: inherit;
}
.aux-lab textarea { margin-top: 10px; resize: vertical; }
.aux-lab pre { white-space: pre-wrap; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-family: var(--font-mono); font-size: 12px; }
</style>
