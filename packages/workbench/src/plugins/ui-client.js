// Prepended to the UI bundle and executed as a module inside the nested opaque frame.
// No credentials, host objects or SDK capability handles are exposed here.
const initialization = await new Promise(resolve => {
  addEventListener('message', function initialize(event) {
    if (event.source !== parent || event.data?.type !== 'tano-view-channel' || !event.ports[0]) return;
    removeEventListener('message', initialize);
    resolve({ ...event.data, port: event.ports[0] });
  });
  parent.postMessage({ type: 'tano-view-connect' }, '*');
});
const port = initialization.port;
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...values) => {
    const message = values.map(value => { try { return value instanceof Error ? value.stack || String(value) : typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } }).join(' ').slice(0, 1500);
    port.postMessage({ type: 'log', level: level === 'error' || level === 'warn' ? level : 'info', message });
  };
}
const report = error => port.postMessage({ type: 'failed', error: String(error).slice(0, 1000) });
addEventListener('error', event => { event.preventDefault(); report(event.message); });
addEventListener('unhandledrejection', event => { event.preventDefault(); report(event.reason); });
document.querySelector('#app').innerHTML = initialization.html;
const style = document.createElement('style'); style.textContent = initialization.css; document.head.append(style);
const subscribers = new Set();
const pending = new Map();
let state = initialization.state;
let sequence = 0;
const tanoView = Object.freeze({
  onState(handler) {
    if (typeof handler !== 'function') throw new Error('界面状态需要处理函数');
    subscribers.add(handler);
    queueMicrotask(() => { if (subscribers.has(handler)) { try { handler(state); } catch (error) { report(error); } } });
    return () => subscribers.delete(handler);
  },
  postMessage(payload) {
    return new Promise((resolve, reject) => {
      if (pending.size >= 16) return reject(new Error('界面请求过多'));
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('插件界面请求超时')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ type: 'message', id, payload }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  },
});
port.onmessage = ({ data }) => {
  if (data?.type === 'state') {
    state = data.state;
    for (const handler of subscribers) { try { handler(state); } catch (error) { report(error); } }
  } else if (data?.type === 'result') {
    const call = pending.get(data.id);
    if (!call) return;
    clearTimeout(call.timer); pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve();
  }
};
