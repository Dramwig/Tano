import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function createPlugin(target, template = 'vanilla') {
  target = resolve(target);
  const id = basename(target);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('Directory name must be a lowercase plugin ID');
  if (!['vanilla', 'vue', 'react'].includes(template)) throw new Error('Template must be vanilla, vue or react');
  const ui = template !== 'vanilla';
  const manifest = { manifestVersion: 2, apiVersion: 1, id, name: '我的插件', version: '1.0.0', description: '同页文档列表',
    objectTypes: [], relationTypes: [], permissions: ['documents.read', ...(ui ? ['ui'] : [])], networkOrigins: [], nativeCommands: [],
    commands: [{ id: 'refresh', label: '刷新文档列表' }], views: [{ id: 'main', label: '文档列表', location: 'tab' }] };
  const files = new Map();
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  files.set('main.ts', `import type { TanoPluginApi } from '@tano/workbench/plugin-sdk';
export default async function activate(tano: TanoPluginApi) {
  async function refresh() {
    const page = await tano.documents.query({ limit: 50 });
    const files = page.items.map(file => ({ id: file.id, path: file.path }));
    ${ui ? "await tano.views.renderCustom('main', { files, total: page.total ?? files.length });" : "await tano.views.render('main', { type: 'table', columns: ['文档', '身份'], rows: files.map(file => [file.path, file.id]) });"}
  }
  ${ui ? `tano.views.onMessage('main', async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('消息格式无效');
    if (message.action === 'refresh') await refresh();
    else if (message.action === 'open' && typeof message.id === 'string') await tano.documents.open(message.id);
    else throw new Error('不支持此操作');
  });` : ''}
  tano.events.subscribe(refresh, { types: ['documents.changed'] });
  await tano.commands.register('refresh', refresh);
  await refresh();
}
`);
  const dependencies = {}, devDependencies = {};
  const version = async name => JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  devDependencies.typescript = await version('typescript');
  if (template === 'vue') dependencies.vue = await version('vue');
  if (template === 'react') {
    for (const name of ['react', 'react-dom']) dependencies[name] = await version(name);
    for (const name of ['@types/react', '@types/react-dom']) devDependencies[name] = await version(name);
  }
  if (ui) {
    files.set('ui/main.html', '<div id="app"></div>\n');
    files.set('ui/main.css', 'body{font:14px system-ui;margin:24px;color:#22352e;background:#fafcfb}button{font:inherit;cursor:pointer;padding:8px 12px;border:1px solid #ccd8d0;border-radius:6px;background:white;color:inherit}li{margin:8px 0}pre{white-space:pre-wrap;font-size:11px}[role=alert]{color:#b33}\n');
    files.set('state.ts', "export interface State { files: { id: string; path: string }[]; total: number }\n");
    files.set('assets.d.ts', "declare module '*.txt' { const content: string; export default content; }\n");
    const names = template === 'vue' ? ['vue', '@vue/shared', '@vue/reactivity', '@vue/runtime-core', '@vue/runtime-dom'] : ['react', 'react-dom', 'scheduler'];
    const notices = await Promise.all(names.map(async name => `${name}@${await version(name)}\n\n${await readFile(join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`));
    files.set('THIRD_PARTY_NOTICES.txt', notices.join('\n\n') + '\n');
    if (template === 'vue') files.set('ui/main.ts', `import { createApp, h, ref } from 'vue';
import type { PluginJson, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import type { State } from '../state';
import notices from '../THIRD_PARTY_NOTICES.txt';
export default function mount(api: TanoPluginViewApi) {
  const state = ref<State>({ files: [], total: 0 }), error = ref('');
  api.onState(value => { state.value = value as unknown as State; });
  async function send(message: PluginJson) { error.value = ''; try { await api.postMessage(message); } catch (e) { error.value = String(e); } }
  createApp({ setup: () => () => h('main', [h('h1', '工作区文档'), h('p', '显示前 50 篇可见文档'),
    h('button', { onClick: () => send({ action: 'refresh' }) }, '刷新'),
    error.value ? h('p', { role: 'alert' }, error.value) : null,
    h('ul', state.value.files.map(file => h('li', { key: file.id }, [h('button', { onClick: () => send({ action: 'open', id: file.id }) }, file.path)]))),
    h('details', [h('summary', '开源许可'), h('pre', notices)])]) }).mount('#app');
}
`);
    else files.set('ui/main.tsx', `import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginJson, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import type { State } from '../state';
import notices from '../THIRD_PARTY_NOTICES.txt';
function Documents({ api }: { api: TanoPluginViewApi }) {
  const [state, setState] = useState<State>({ files: [], total: 0 }), [error, setError] = useState('');
  useEffect(() => api.onState(value => setState(value as unknown as State)), [api]);
  async function send(message: PluginJson) { setError(''); try { await api.postMessage(message); } catch (e) { setError(String(e)); } }
  return <main><h1>工作区文档</h1><p>显示前 50 篇可见文档</p><button onClick={() => send({ action: 'refresh' })}>刷新</button>
    {error && <p role="alert">{error}</p>}<ul>{state.files.map(file => <li key={file.id}><button onClick={() => send({ action: 'open', id: file.id })}>{file.path}</button></li>)}</ul>
    <details><summary>开源许可</summary><pre>{notices}</pre></details></main>;
}
export default function mount(api: TanoPluginViewApi) { createRoot(document.getElementById('app')!).render(<Documents api={api} />); }
`);
  }
  const sdk = relative(target, root).replaceAll('\\', '/') || '.';
  files.set('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    strict: true, noEmit: true, skipLibCheck: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM'], paths: {
      '@tano/workbench/plugin-sdk': [`${sdk}/packages/workbench/src/plugin-sdk.ts`], '@tano/protocol': [`${sdk}/packages/protocol/src/index.ts`],
    } }, include: ['**/*.ts', '**/*.tsx'] }, null, 2) + '\n');
  files.set('package.json', JSON.stringify({ name: id, private: true, version: '1.0.0', type: 'module', scripts: { check: 'tsc --noEmit' }, dependencies, devDependencies }, null, 2) + '\n');
  files.set('README.md', `# ${id}\n\n${template} 模板，插件 API v1。\n\n在 Tano 仓库根目录运行 npm install 后，可使用 npm run plugin -- pack <此目录> 打包，或 npm run plugin -- watch <此目录> --origin <同页来源> 开发。\n\n在插件目录运行 npm install 和 npm run check 可独立检查类型。tsconfig.json 中的 SDK 路径指向创建模板时的 Tano 源码目录；移动工程后请更新这两个路径。\n\nmain.ts 在 Worker 中使用 SDK；ui/ 在隔离页面中显示数据，只通过 tanoView 消息通信。框架与样式打包进 JSON，不依赖 CDN。\n\n发布前核对权限、升级版本号、选择你自己的源码许可证；若更新框架依赖，请同步 THIRD_PARTY_NOTICES.txt。完整 API、兼容性和迁移说明见 Tano/docs/plugin-api.md。\n`);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target); // Existing projects are never partially overwritten.
  if (ui) await mkdir(join(target, 'ui'));
  for (const [name, content] of files) await writeFile(join(target, name), content, { flag: 'wx' });
  return { id, template };
}
