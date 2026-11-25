// Bundled as text into an isolated Worker. This file never executes in the workbench.
const pending = new Map();
const commands = new Map();
const actions = new Map();
const viewMessages = new Map();
const assistantTools = new Map();
const assistantContextProviders = new Map();
const services = new Map();
const listeners = new Set();
const deactivators = new Set();
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...values) => {
    const message = values.map(value => { try { return value instanceof Error ? value.stack || String(value) : typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } }).join(' ').slice(0, 1500);
    postMessage({ type: 'log', level: level === 'error' || level === 'warn' ? level : 'info', message });
  };
}
addEventListener('unhandledrejection', event => { console.error(event.reason); event.preventDefault(); });
let sequence = 0;
const call = (method, params = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
  if (pending.size >= 32) return reject(new Error('插件请求过多'));
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('插件请求超时')); }, timeoutMs);
  pending.set(id, { resolve, reject, timer });
  postMessage({ type: 'call', id, method, params });
});
const tano = Object.freeze({
  context: () => call('context'),
  hostInfo: () => call('hostInfo'),
  lifecycle: Object.freeze({
    onDeactivate: handler => {
      if (typeof handler !== 'function') throw new Error('卸载回调必须提供处理函数');
      deactivators.add(handler);
      return () => deactivators.delete(handler);
    },
  }),
  assets: Object.freeze({
    list: () => call('assets.list'),
    read: path => call('assets.read', { path }),
  }),
  attachments: Object.freeze({
    read: (fileId, offset = 0, revision) => call('attachments.read', { fileId, offset, revision }),
    write: request => call('attachments.write', { request }),
  }),
  documents: Object.freeze({
    list: () => call('documents.list'),
    query: options => call('documents.query', { options }),
    search: (query, options) => call('documents.search', { options: { ...options, query } }),
    read: fileId => call('documents.read', { fileId }),
    write: (fileId, content, baseHash) => call('documents.write', { fileId, content, baseHash }),
    edit: (fileId, edits, baseHash) => call('documents.edit', { fileId, edits, baseHash }),
    create: (path, content) => call('documents.create', { path, content }),
    move: (fileId, destination, baseHash) => call('documents.move', { fileId, destination, baseHash }),
    trash: (fileId, baseHash) => call('documents.trash', { fileId, baseHash }),
    open: fileId => call('documents.open', { fileId }),
    frontmatter: Object.freeze({
      read: fileId => call('documents.frontmatter.read', { fileId }),
      update: (fileId, patch, baseHash) => call('documents.frontmatter.update', { fileId, patch, baseHash }),
    }),
  }),
  editor: Object.freeze({
    active: () => call('editor.active'),
    insert: text => call('editor.insert', { text }),
    replaceSelection: text => call('editor.replaceSelection', { text }),
    setDecorations: (fileId, decorations) => call('editor.setDecorations', { fileId, decorations }),
    clearDecorations: fileId => call('editor.clearDecorations', fileId === undefined ? {} : { fileId }),
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
  ui: Object.freeze({
    pick: options => call('ui.pick', { options }, 300000),
    prompt: options => call('ui.prompt', { options }, 300000),
    confirm: options => call('ui.confirm', { options }, 300000),
    toast: (message, tone) => call('ui.toast', tone === undefined ? { message } : { message, tone }),
    setStatusBar: item => call('ui.setStatusBar', { item }),
    removeStatusBar: id => call('ui.removeStatusBar', { id }),
  }),
  ai: Object.freeze({
    complete: request => call('ai.complete', { request }, 65000),
    structured: request => call('ai.structured', { request }, 65000),
  }),
  assistant: Object.freeze({
    registerTool: async (name, handler) => {
      if (typeof handler !== 'function') throw new Error('助手工具必须提供处理函数');
      assistantTools.set(name, handler);
      await call('assistant.registerTool', { name });
    },
    registerContextProvider: async (id, handler) => {
      if (typeof handler !== 'function') throw new Error('助手上下文提供者必须提供处理函数');
      assistantContextProviders.set(id, handler);
      await call('assistant.registerContextProvider', { id });
    },
  }),
  services: Object.freeze({
    register: async (name, handler) => {
      if (typeof handler !== 'function') throw new Error('插件服务必须提供处理函数');
      services.set(name, handler);
      await call('services.register', { name });
    },
    call: (pluginId, service, payload = null) => call('services.call', { pluginId, service, payload }, 20000),
    available: (pluginId, service) => call('services.available', { pluginId, service }),
  }),
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
    if (data.error) {
      const error = new Error(data.error);
      if (typeof data.code === 'string') {
        error.name = 'TanoPluginError';
        error.code = data.code;
        error.retryable = !!data.retryable;
      }
      request.reject(error);
    } else request.resolve(data.result);
  } else if (data?.type === 'deactivate') {
    (async () => {
      for (const handler of [...deactivators]) {
        try { await handler(); } catch (error) { postMessage({ type: 'log', level: 'warn', error: String(error) }); }
      }
      deactivators.clear();
    })().finally(() => postMessage({ type: 'deactivated' }));
  } else if (data?.type === 'invoke') {
    try {
      if (data.kind === 'assistant-tool') {
        const handler = assistantTools.get(data.name);
        if (!handler) throw new Error('插件助手工具处理函数尚未注册');
        const result = await handler(data.payload?.args ?? {}, data.payload?.context ?? {});
        postMessage({ type: 'invoked', id: data.id, result });
      } else if (data.kind === 'assistant-context') {
        const handler = assistantContextProviders.get(data.name);
        if (!handler) throw new Error('插件助手上下文提供者尚未注册');
        const result = await handler(data.payload?.query ?? '', data.payload?.context ?? {});
        postMessage({ type: 'invoked', id: data.id, result });
      } else if (data.kind === 'service') {
        const handler = services.get(data.name);
        if (!handler) throw new Error('插件服务处理函数尚未注册');
        const result = await handler(data.payload?.args ?? null, { pluginId: data.payload?.callerPluginId ?? '' });
        postMessage({ type: 'invoked', id: data.id, result });
      } else {
        const handler = data.kind === 'command' ? commands.get(data.name) : data.kind === 'message' ? viewMessages.get(data.name) : actions.get(data.name);
        if (!handler) throw new Error('插件处理函数尚未注册');
        await handler(data.payload);
        postMessage({ type: 'invoked', id: data.id });
      }
    } catch (error) { postMessage({ type: 'invoked', id: data.id, error: String(error) }); }
  } else if (data?.type === 'event') {
    for (const listener of listeners) Promise.resolve().then(() => listener(data.event)).catch(error => postMessage({ type: 'log', error: String(error) }));
  }
};
