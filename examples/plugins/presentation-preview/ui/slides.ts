import { createPreviewLoading, paintPreviewLoading } from '../../shared/preview-loading';
import type { TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import type { Presentation } from '@web-ppt/core';
import { readPresentation, renderSlide } from '../model';
import notices from '../THIRD_PARTY_NOTICES.txt';
import './slides.css';

export default function mount(api: TanoPluginViewApi) {
  const root = document.getElementById('app')!;
  root.innerHTML = '<p id="status" role="status">从文件树打开演示文稿，或选择本机文件。文件仅在此设备处理。</p><main tabindex="0" aria-label="幻灯片预览"><div id="paper"></div></main><dialog><button id="close">关闭</button><pre></pre></dialog>';
  const loading = createPreviewLoading(root, 'presentation');
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = find('status'), paper = find('paper'), viewport = root.querySelector('main')!;
  let deck: Presentation | undefined, page = 0, zoom = 1, fit = true, sequence = 0, token = 0, title = '演示文稿预览';
  const publishHeader = () => api.postMessage({ type: 'header', title, token, page: deck ? page + 1 : 0, count: deck?.slides.length ?? 0 });
  const setStatus = (text: string) => { status.textContent = text; status.hidden = !text; };
  let transfer: { token: number; bytes: Uint8Array; offset: number } | undefined;
  const dispose = () => {
    deck?.dispose?.(); deck = undefined; paper.replaceChildren();
  };
  function resize() {
    if (!deck) return;
    const scale = fit ? Math.min(2, Math.max(0.05, (viewport.clientWidth - 48) / deck.width)) : zoom;
    paper.style.width = `${deck.width * scale}px`; paper.style.height = `${deck.height * scale}px`;
    const svg = paper.firstElementChild as SVGElement | null;
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
  }
  function show() {
    if (!deck) return;
    const doc = new DOMParser().parseFromString(renderSlide(deck, page), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('无法渲染此页');
    // Defense in depth in addition to the opaque iframe's no-network CSP.
    doc.querySelectorAll('script,iframe,object,embed,audio,video,animate,set').forEach(node => node.remove());
    for (const element of doc.querySelectorAll('*')) for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || (/^(href|xlink:href|src)$/i.test(attr.name) && !/^(#|blob:|data:image\/)/i.test(attr.value))) element.removeAttribute(attr.name);
    }
    paper.replaceChildren(document.importNode(doc.documentElement, true));
    void publishHeader();
    resize();
  }
  async function open(bytes: Uint8Array, name: string) {
    const current = ++sequence; dispose(); title = name; loading.show(); setStatus(`正在渲染 ${name}…`);
    try {
      await paintPreviewLoading();
      if (current !== sequence) return;
      const parsed = await readPresentation(bytes);
      if (current !== sequence) { parsed.dispose?.(); return; }
      deck = parsed; page = 0; fit = true; show(); loading.hide(); setStatus('');
    } catch (error) { if (current === sequence) { dispose(); loading.hide(); setStatus(String(error)); void publishHeader(); } }
  }
  const navigate = (delta: number) => { if (deck) { page = Math.max(0, Math.min(deck.slides.length - 1, page + delta)); try { show(); } catch (error) { setStatus(String(error)); } } };
  viewport.onkeydown = event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); navigate(event.key === 'ArrowRight' ? 1 : -1); } };
  const dialog = root.querySelector('dialog')!; dialog.querySelector('pre')!.textContent = notices;
  find('close').onclick = () => dialog.close();
  function action(id: string) {
    if (id === 'previous' || id === 'next') navigate(id === 'next' ? 1 : -1);
    if (id === 'fit') { fit = true; resize(); }
    if (id === 'minus' || id === 'plus') {
      if (deck && fit) zoom = paper.clientWidth / deck.width;
      fit = false; zoom = Math.max(0.1, Math.min(4, zoom + (id === 'plus' ? 0.1 : -0.1))); resize();
    }
    if (id === 'license' && !dialog.open) dialog.showModal();
  }
  const observer = new ResizeObserver(resize); observer.observe(viewport);
  const unsubscribe = api.onState(async raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (typeof raw.action === 'string' && raw.chunk === undefined) { action(raw.action); return; }
    if (typeof raw.token === 'number') token = raw.token;
    if (raw.loading) { transfer = undefined; ++sequence; dispose(); loading.show(); setStatus('正在读取文件…'); return; }
    if (raw.idle) { transfer = undefined; ++sequence; dispose(); title = '演示文稿预览'; loading.hide(); setStatus('请选择 PPT/PPTX 文件'); void publishHeader(); return; }
    if (typeof raw.error === 'string') { transfer = undefined; ++sequence; dispose(); loading.hide(); setStatus(raw.error); void publishHeader(); return; }
    if (typeof raw.chunk !== 'string' || typeof raw.token !== 'number' || typeof raw.total !== 'number' || raw.total > 50 * 1024 * 1024 || raw.total < 0) return;
    if (raw.offset === 0) { transfer = { token: raw.token, bytes: new Uint8Array(raw.total), offset: 0 }; ++sequence; dispose(); loading.show(); title = String(raw.path); void publishHeader(); }
    const active = transfer;
    if (!active || active.token !== raw.token || raw.offset !== active.offset) return;
    try {
      const chunk = Uint8Array.from(atob(raw.chunk), c => c.charCodeAt(0));
      if (!chunk.length || active.offset + chunk.length > active.bytes.length) throw new Error('附件分块无效');
      active.bytes.set(chunk, active.offset); active.offset += chunk.length;
      setStatus(`读取文件 ${Math.round(active.offset / active.bytes.length * 100)}%`);
      if (raw.imported) await api.postMessage({ type: 'received', token: active.token, offset: active.offset });
      if (active.offset === active.bytes.length) { transfer = undefined; await open(active.bytes, String(raw.path)); }
      else if (!raw.imported) { await new Promise(resolve => setTimeout(resolve, 25)); if (transfer === active) await api.postMessage({ offset: active.offset, token: active.token }); }
    } catch (error) { if (transfer === active) { transfer = undefined; loading.hide(); setStatus(String(error)); } }
  });
  addEventListener('pagehide', () => { ++sequence; transfer = undefined; dispose(); observer.disconnect(); unsubscribe(); }, { once: true });
}
