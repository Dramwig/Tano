// Bundled as text into an isolated Worker. This file never executes in the workbench.
const pending = new Map();
const commands = new Map();
const actions = new Map();
const viewMessages = new Map();
const listeners = new Set();
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...values) => {
    const message = values.map(value => { try { return value instanceof Error ? value.stack || String(value) : typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } }).join(' ').slice(0, 1500);
    postMessage({ type: 'log', level: level === 'error' || level === 'warn' ? level : 'info', message });
  };
}
addEventListener('unhandledrejection', event => { console.error(event.reason); event.preventDefault(); });
let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  if (pending.size >= 32) return reject(new Error('插件请求过多'));
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('插件请求超时')); }, 30000);
  pending.set(id, { resolve, reject, timer });
  postMessage({ type: 'call', id, method, params });
});
const tano = Object.freeze({
  context: () => call('context'),
  attachments: Object.freeze({ read: (fileId, offset = 0, revision) => call('attachments.read', { fileId, offset, revision }) }),
  documents: Object.freeze({
    list: () => call('documents.list'),
    query: options => call('documents.query', { options }),
    search: (query, options) => call('documents.search', { options: { ...options, query } }),
    read: fileId => call('documents.read', { fileId }),
    write: (fileId, content, baseHash) => call('documents.write', { fileId, content, baseHash }),
    edit: (fileId, edits, baseHash) => call('documents.edit', { fileId, edits, baseHash }),
    create: (path, content) => call('documents.create', { path, content }),
    open: fileId => call('documents.open', { fileId }),
  }),
  objects: Object.freeze({ list: () => call('objects.list'), query: options => call('objects.query', { options }), read: objectId => call('objects.read', { objectId }), create: object => call('objects.create', { object }),
    update: (object, baseHash) => call('objects.update', { object, baseHash }) }),
  relations: Object.freeze({ list: () => call('relations.list'), query: options => call('relations.query', { options }), add: relation => call('relations.add', { relation }),
    remove: relation => call('relations.remove', { relation }) }),
  storage: Object.freeze({ get: key => call('storage.get', { key }), set: (key, value) => call('storage.set', { key, value }), remove: key => call('storage.remove', { key }), usage: () => call('storage.usage') }),
  network: Object.freeze({ get: url => call('network.get', { url }) }),
  connections: Object.freeze({ request: (origin, request) => call('connections.request', { origin, request }) }),
  native: Object.freeze({ invoke: (command, args) => call('native.invoke', { command, args }) }),
  commands: Object.freeze({ register: async (id, handler) => {
    if (typeof handler !== 'function') throw new Error('命令必须提供处理函数');
    commands.set(id, handler); await call('commands.register', { id });
  } }),
  views: Object.freeze({ render: (id, tree) => call('views.render', { id, tree }),
    setHeader: (id, header) => call('views.setHeader', { id, header }),
    renderCustom: (id, state) => call('views.renderCustom', { id, state }),
    open: id => call('views.open', { id }),
    onMessage: (id, handler) => { viewMessages.set(id, handler); return () => viewMessages.delete(id); },
    onAction: (id, handler) => { actions.set(id, handler); return () => actions.delete(id); } }),
  events: Object.freeze({ subscribe: (handler, options = {}) => {
    if (typeof handler !== 'function') throw new Error('事件必须提供处理函数');
    const listener = event => {
      if (options.types && !options.types.includes(event.type)) return;
      if (options.ids && event.changes && !event.reset) {
        const changes = event.changes.filter(change => options.ids.includes(change.id));
        if (!changes.length) return;
        return handler({ ...event, changes });
      }
      return handler(event);
    };
    listeners.add(listener); return () => listeners.delete(listener);
  } }),
  notify: message => call('notify', { message }),
});
onmessage = async ({ data }) => {
  if (data?.type === 'result') {
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
  } else if (data?.type === 'invoke') {
    try {
      const handler = data.kind === 'command' ? commands.get(data.name) : data.kind === 'message' ? viewMessages.get(data.name) : actions.get(data.name);
      if (!handler) throw new Error('插件处理函数尚未注册');
      await handler(data.payload);
      postMessage({ type: 'invoked', id: data.id });
    } catch (error) { postMessage({ type: 'invoked', id: data.id, error: String(error) }); }
  } else if (data?.type === 'event') {
    for (const listener of listeners) Promise.resolve().then(() => listener(data.event)).catch(error => postMessage({ type: 'log', error: String(error) }));
  }
};
