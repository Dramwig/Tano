import workerSource from './worker.js?raw';

export interface PluginSandbox {
  send(message: unknown): void;
  dispose(): void;
}
export type PluginSandboxFactory = (source: string, receive: (message: unknown) => void, failed: (error: string) => void) => PluginSandbox;

/** The outer frame is trusted glue only. Plugin code has no DOM, storage, cookies or IPC. */
export const sandboxBootstrap = `addEventListener('message', function initialize(event) {
  if (event.source !== parent || event.data?.type !== 'tano-plugin-init' || !event.ports[0]) return;
  removeEventListener('message', initialize);
  const port = event.ports[0];
  const url = URL.createObjectURL(new Blob([event.data.source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  port.onmessage = event => worker.postMessage(event.data);
  worker.onmessage = event => port.postMessage(event.data);
  worker.onerror = event => { event.preventDefault(); port.postMessage({ type: 'failed', error: event.message || '插件脚本执行失败' }); };
  addEventListener('pagehide', () => { worker.terminate(); port.close(); });
});`;

export const createPluginSandbox: PluginSandboxFactory = (source, receive, failed) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = '插件隔离运行时';
  frame.style.display = 'none';
  const channel = new MessageChannel();
  let disposed = false;
  channel.port1.onmessage = event => { if (!disposed) receive(event.data); };
  channel.port1.onmessageerror = () => failed('插件消息无法解码');
  frame.onload = () => {
    if (disposed) return;
    frame.contentWindow?.postMessage({ type: 'tano-plugin-init', source: `${workerSource}\n(async () => {\n${source}\n})().then(() => postMessage({ type: 'ready' }), error => postMessage({ type: 'failed', error: String(error) }));` }, '*', [channel.port2]);
  };
  // The frame's opaque origin and its restrictive CSP also apply to the blob Worker.
  // There are no plugin-controlled URLs or HTML in this document.
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-HqAH3w25zKsq8qlxnq/FqwEwwxm4jFIT+lkTXMahrdU=' blob:; worker-src blob:; connect-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script>${sandboxBootstrap}</script>`;
  document.body.append(frame);
  return {
    send(message) { if (!disposed) channel.port1.postMessage(message); },
    dispose() {
      if (disposed) return;
      disposed = true; channel.port1.close(); channel.port2.close(); frame.remove();
    },
  };
};
