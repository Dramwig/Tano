import { createPreviewLoading, paintPreviewLoading } from '../../shared/preview-loading';
import type { TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import { renderWord, cancelWordRender } from '../model';
import notices from '../THIRD_PARTY_NOTICES.txt';
import './document.css';

export default function mount(api: TanoPluginViewApi) {
  const root = document.getElementById('app')!;
  root.innerHTML = '<p id="status" role="status">请选择 DOC/DOCX 文件</p><main tabindex="0" aria-label="Word 文档预览"><div id="paper"></div></main><dialog><button id="close">关闭</button><p id="note"></p><details><summary>开源许可</summary><pre></pre></details></dialog>';
  const loading = createPreviewLoading(root, 'word');
  const status = root.querySelector<HTMLElement>('#status')!, paper = root.querySelector<HTMLElement>('#paper')!, viewport = root.querySelector('main')!;
  const dialog = root.querySelector('dialog')!;
  dialog.querySelector('pre')!.textContent = notices;
  root.querySelector<HTMLButtonElement>('#close')!.onclick = () => dialog.close();
  let rendered: Awaited<ReturnType<typeof renderWord>> | undefined;
  let page = 0, zoom = 1, fit = true, sequence = 0, token = 0, title = 'Word 文档预览';
  let transfer: { token: number; bytes: Uint8Array; offset: number } | undefined;
  let holder: HTMLElement | undefined;
  const publish = () => api.postMessage({ type: 'header', title, token, page: rendered ? page + 1 : 0, count: rendered?.pages.length ?? 0, note: rendered?.note ?? '' });
  const setStatus = (value: string) => { status.textContent = value; status.hidden = !value; };
  function dispose() {
    if (rendered) rendered.dispose(); else if (holder) cancelWordRender(holder);
    rendered = undefined; holder?.remove(); holder = undefined;
    paper.replaceChildren(); paper.style.zoom = '1'; viewport.scrollTop = 0;
  }
  function resize() {
    if (!rendered) return;
    const width = Math.max(...rendered.pages.map(item => item.offsetWidth));
    if (fit) zoom = Math.min(1.5, Math.max(0.05, (viewport.clientWidth - 48) / (width + 48)));
    paper.style.zoom = String(zoom);
  }
  function move(index: number) {
    if (!rendered) return;
    page = Math.max(0, Math.min(rendered.pages.length - 1, index));
    viewport.scrollTop += rendered.pages[page]!.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24;
    void publish();
  }
  async function open(bytes: Uint8Array, name: string) {
    const request = ++sequence; dispose(); title = name; page = 0; fit = true;
    loading.show(); setStatus(`正在渲染 ${name}…`); void publish();
    const target = document.createElement('div'); holder = target; paper.append(target);
    target.style.visibility = 'hidden';
    try {
      await paintPreviewLoading();
      if (request !== sequence) return;
      const result = await renderWord(bytes, target);
      if (request !== sequence) { result.dispose(); target.remove(); return; }
      rendered = result; target.style.visibility = ''; resize();
      dialog.querySelector('#note')!.textContent = result.note;
      loading.hide(); setStatus(''); void publish();
    } catch (error) { if (request === sequence) { dispose(); loading.hide(); setStatus(String(error)); void publish(); } }
  }
  function action(id: string) {
    if (id === 'previous' || id === 'next') move(page + (id === 'next' ? 1 : -1));
    if (id === 'fit') { fit = true; resize(); }
    if (id === 'minus' || id === 'plus') { fit = false; zoom = Math.max(0.1, Math.min(4, zoom + (id === 'plus' ? 0.1 : -0.1))); resize(); }
    if (id === 'license' && !dialog.open) dialog.showModal();
  }
  viewport.onkeydown = event => {
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(page + (event.key === 'ArrowRight' ? 1 : -1)); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); move(event.key === 'Home' ? 0 : (rendered?.pages.length ?? 1) - 1); }
  };
  let scrollFrame = 0;
  viewport.onscroll = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!rendered) return;
      const top = viewport.getBoundingClientRect().top;
      let index = 0, best = -Infinity;
      rendered.pages.forEach((item, i) => {
        const bounds = item.getBoundingClientRect();
        const visible = Math.min(bounds.bottom, top + viewport.clientHeight) - Math.max(bounds.top, top);
        if (visible > best) { best = visible; index = i; }
      });
      if (page !== index) { page = index; void publish(); }
    });
  };
  const observer = new ResizeObserver(resize); observer.observe(viewport);
  const unsubscribe = api.onState(async raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (typeof raw.action === 'string' && raw.chunk === undefined) { action(raw.action); return; }
    if (typeof raw.token === 'number') token = raw.token;
    if (raw.loading) { transfer = undefined; ++sequence; dispose(); loading.show(); setStatus('正在读取文件…'); return; }
    if (raw.idle || typeof raw.error === 'string') {
      transfer = undefined; ++sequence; dispose(); title = 'Word 文档预览';
      loading.hide(); setStatus(typeof raw.error === 'string' ? raw.error : '请选择 DOC/DOCX 文件'); void publish(); return;
    }
    if (typeof raw.chunk !== 'string' || typeof raw.token !== 'number' || typeof raw.total !== 'number' || !Number.isSafeInteger(raw.total) || raw.total > 50 * 1024 * 1024 || raw.total < 0) return;
    if (raw.offset === 0) { transfer = { token: raw.token, bytes: new Uint8Array(raw.total), offset: 0 }; ++sequence; dispose(); loading.show(); title = String(raw.path); void publish(); }
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
  addEventListener('pagehide', () => { ++sequence; transfer = undefined; dispose(); observer.disconnect(); unsubscribe(); cancelAnimationFrame(scrollFrame); }, { once: true });
}
