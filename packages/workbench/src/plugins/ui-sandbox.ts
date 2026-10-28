import { parsePluginJson, pluginRecord, type PluginJson, type PluginUiBundle } from '@tano/protocol';
import outerSource from './ui-outer.js?raw';
import clientSource from './ui-client.js?raw';
import innerSource from './ui-inner.js?raw';

// Keep the hash in desktop CSP in sync using the sandbox hash regression test.
export const uiSandboxBootstrap = outerSource.replaceAll('\r\n', '\n');
export const uiSandboxHash = 'sha256-mttmlt/RorVenHE6uCEgyXxhCOzmzxA4bSqs3JcgTSI=';
export const uiInnerBootstrap = innerSource.replaceAll('\r\n', '\n');
export const uiInnerHash = 'sha256-P5ZdN4WrfG4W8bRc6EVq4b3kO6ADXLEDtdOYQg0IEzE=';
export interface PluginUiSandbox { update(state: PluginJson): void; dispose(): void }
export function createPluginUiSandbox(container: HTMLElement, bundle: PluginUiBundle, state: PluginJson,
  receive: (message: PluginJson) => Promise<void>, failed: (error: string) => void,
  diagnostic?: (level: string, message: string) => void): PluginUiSandbox {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; display-capture 'none'");
  frame.title = '插件界面隔离容器';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
  const channel = new MessageChannel();
  let disposed = false, initialized = false, ready = false, inFlight = 0, calls = 0, windowStart = Date.now();
  let latest = parsePluginJson(state);
  const seen = new Set<number>();
  const dispose = () => { if (disposed) return; disposed = true; clearTimeout(timer); channel.port1.close(); channel.port2.close(); frame.remove(); };
  const fail = (message: string) => { if (!disposed) { dispose(); failed(message.slice(0, 1000)); } };
  const timer = setTimeout(() => fail('插件界面加载超时'), 15000);
  channel.port1.onmessageerror = () => fail('插件界面消息无法解码');
  channel.port1.onmessage = ({ data }) => {
    if (disposed || !pluginRecord(data)) return;
    if (Date.now() - windowStart > 1000) { windowStart = Date.now(); calls = 0; }
    if (++calls > 100) { fail('插件界面消息超过资源限制'); return; }
    if (data.type === 'ready') { ready = true; clearTimeout(timer); channel.port1.postMessage({ type: 'state', state: latest }); return; }
    if (data.type === 'failed') { fail(String(data.error)); return; }
    if (data.type === 'log') { if (typeof data.message === 'string') diagnostic?.(String(data.level), data.message.slice(0, 1500)); return; }
    if (data.type !== 'message' || !Number.isSafeInteger(data.id) || Number(data.id) <= 0 || seen.has(Number(data.id))) return;
    const id = Number(data.id);
    seen.add(id); if (seen.size > 2048) seen.delete(seen.values().next().value!);
    if (inFlight >= 16) { fail('插件界面并发超过资源限制'); return; }
    let payload: PluginJson;
    try { payload = parsePluginJson(data.payload, 16 * 1024); }
    catch (error) { channel.port1.postMessage({ type: 'result', id, error: String(error) }); return; }
    inFlight++;
    void Promise.resolve().then(() => { if (disposed) throw new Error('插件界面已关闭'); return receive(payload); }).then(
      () => { if (!disposed) channel.port1.postMessage({ type: 'result', id }); },
      error => { if (!disposed) channel.port1.postMessage({ type: 'result', id, error: String(error).slice(0, 1000) }); },
    ).finally(() => { inFlight--; });
  };
  frame.onload = () => {
    if (disposed) return;
    if (initialized) { fail('插件界面容器发生了未授权导航'); return; }
    initialized = true;
    // Vue may wrap component props in a Proxy, which structured clone cannot transfer.
    frame.contentWindow?.postMessage({ type: 'tano-view-init', bundle: { html: bundle.html, css: bundle.css, source: bundle.source }, clientSource, innerSource: uiInnerBootstrap, innerHash: uiInnerHash, state: latest }, '*', [channel.port2]);
  };
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${uiSandboxHash}' '${uiInnerHash}' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script>${uiSandboxBootstrap}</script>`;
  container.append(frame);
  return { update(value) { latest = parsePluginJson(value); if (ready && !disposed) channel.port1.postMessage({ type: 'state', state: latest }); }, dispose };
}
