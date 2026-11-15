/**
 * Runtime probes for the auxiliary window prototype. Each one turns a suspected
 * cross-window pitfall into a measured result for docs/aux-window-prototype.md.
 */

export type ProbeStatus = 'pass' | 'fail' | 'warn' | 'info';
export type ProbeResult = { id: string; title: string; status: ProbeStatus; detail: string };

/** Resolves after the popup has painted twice (layout + first composited frame). */
export function nextPaint(target: Window) {
  return new Promise<void>((resolve) => {
    target.requestAnimationFrame(() => target.requestAnimationFrame(() => resolve()));
  });
}

/**
 * Which realm's DOM classes recognise elements living in the popup. Workbench
 * and editor code use `x instanceof HTMLElement` with the opener's globals.
 */
export function realmProbe(host: Window, popup: Window, root: Element): ProbeResult[] {
  const hostGlobals = host as unknown as typeof globalThis;
  const popupGlobals = popup as unknown as typeof globalThis;
  const editor = root.querySelector('.ProseMirror');
  const results: ProbeResult[] = [];
  const vueNode = root.firstElementChild;
  if (vueNode) {
    const hostSees = vueNode instanceof hostGlobals.HTMLElement;
    results.push({
      id: 'realm-vue', title: 'Vue 创建的节点能被主窗口的 instanceof 识别',
      status: hostSees ? 'pass' : 'fail',
      detail: `instanceof 主窗口 HTMLElement = ${hostSees}；instanceof 弹窗 HTMLElement = ${vueNode instanceof popupGlobals.HTMLElement}；ownerDocument 是弹窗 = ${vueNode.ownerDocument === popup.document}`,
    });
  }
  if (editor) {
    const hostSees = editor instanceof hostGlobals.HTMLElement;
    results.push({
      id: 'realm-editor', title: 'ProseMirror 根节点能被主窗口的 instanceof 识别',
      status: hostSees ? 'pass' : 'fail',
      detail: `instanceof 主窗口 HTMLElement = ${hostSees}；ownerDocument 是弹窗 = ${editor.ownerDocument === popup.document}`,
    });
    // Nodes created by the popup itself (e.g. contenteditable typing, paste)
    // carry the popup realm's prototypes.
    const native = popup.document.createElement('span');
    results.push({
      id: 'realm-native', title: '弹窗自己创建的节点（输入/粘贴产生）能被主窗口的 instanceof 识别',
      status: native instanceof hostGlobals.HTMLElement ? 'pass' : 'warn',
      detail: `instanceof 主窗口 HTMLElement = ${native instanceof hostGlobals.HTMLElement}。为 false 时，所有 \`x instanceof HTMLElement\` 判断都要换成 nodeType / ownerDocument.defaultView 判断。`,
    });
  } else {
    results.push({ id: 'realm-editor', title: '编辑器已渲染到弹窗', status: 'fail', detail: '弹窗里找不到 .ProseMirror' });
  }
  return results;
}

/** Counts elements appended to the opener's <body> outside `ignore` (Teleport to="body", floating menus). */
export function watchBodyLeaks(host: Document, ignore: () => Element[]) {
  const leaked: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target !== host.body) continue;
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (ignore().some((root) => root === element || root.contains(element))) return;
        leaked.push(element.className ? `${element.tagName.toLowerCase()}.${String(element.className).split(/\s+/).join('.')}` : element.tagName.toLowerCase());
      });
    }
  });
  observer.observe(host.body, { childList: true });
  return { leaked, stop: () => observer.disconnect() };
}

export type EventCounts = { host: Record<string, number>; popup: Record<string, number> };
const EVENT_NAMES = ['keydown', 'pointerdown', 'resize', 'scroll', 'focus', 'blur'] as const;

/** Counts which window's global listeners receive events while the user works in the popup. */
export function countGlobalEvents(host: Window, popup: Window, onChange: (counts: EventCounts) => void) {
  const counts: EventCounts = { host: {}, popup: {} };
  const stops: (() => void)[] = [];
  for (const [side, target] of [['host', host], ['popup', popup]] as const) {
    for (const name of EVENT_NAMES) {
      counts[side][name] = 0;
      const listener = () => { counts[side][name]++; onChange(counts); };
      target.addEventListener(name, listener, true);
      stops.push(() => target.removeEventListener(name, listener, true));
    }
  }
  return () => stops.forEach((stop) => stop());
}

/** Frames delivered by each window's requestAnimationFrame over `ms`. */
export async function countFrames(host: Window, popup: Window, ms: number) {
  let hostFrames = 0;
  let popupFrames = 0;
  let running = true;
  const tick = (target: Window, increment: () => void) => {
    const step = () => { if (!running) return; increment(); target.requestAnimationFrame(step); };
    target.requestAnimationFrame(step);
  };
  tick(host, () => hostFrames++);
  tick(popup, () => popupFrames++);
  await new Promise((resolve) => setTimeout(resolve, ms));
  running = false;
  return { hostFrames, popupFrames };
}

/** Which window's Selection API reports the caret while typing in the popup editor. */
export function selectionOwner(host: Window, popup: Window, editor: Element | null) {
  const inside = (selection: Selection | null) =>
    !!selection?.anchorNode && !!editor && editor.contains(selection.anchorNode);
  return { host: inside(host.getSelection()), popup: inside(popup.getSelection()) };
}

export function toMarkdown(environment: Record<string, string>, results: ProbeResult[], manual: { label: string; state: string; note: string }[], notes: string) {
  const mark: Record<ProbeStatus, string> = { pass: '通过', fail: '失败', warn: '注意', info: '记录' };
  const lines = ['## 辅助窗口原型实测结果', '', ...Object.entries(environment).map(([key, value]) => `- ${key}：${value}`), '',
    '### 自动探测', '', '| 项目 | 结果 | 说明 |', '| --- | --- | --- |',
    ...results.map((result) => `| ${result.title} | ${mark[result.status]} | ${result.detail.replace(/\|/g, '\\|')} |`),
    '', '### 手动检查', '', '| 项目 | 结果 | 备注 |', '| --- | --- | --- |',
    ...manual.map((item) => `| ${item.label} | ${item.state} | ${item.note.replace(/\|/g, '\\|')} |`)];
  if (notes.trim()) lines.push('', '### 其他记录', '', notes.trim());
  return lines.join('\n');
}
