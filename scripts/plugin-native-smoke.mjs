// Windows/WebView2 acceptance of the production plugin runtime and actual Rust Git provider.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { buildPlugin } from './plugin-build.mjs';
import { acceptTaskInsights } from './fixtures/task-insights-acceptance.mjs';

if (process.platform !== 'win32') throw new Error('This acceptance test requires Windows and WebView2.');
if (!process.env.npm_execpath) throw new Error('Run npm run test:plugins:native from the repository.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(artifacts, 'plugin-native-smoke-'));
const target = join(root, 'apps/client/src-tauri/target');
const cargoArgs = ['build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--manifest-path', 'apps/client/src-tauri/Cargo.toml'];
const config = { identifier: 'app.tano.plugin-smoke', app: { windows: [{ label: 'main', title: 'Tano Plugin Smoke', visible: false, width: 1280, height: 900, decorations: false }] } };
async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}
const nativeEnvironment = { ...process.env, CARGO_TARGET_DIR: target };
delete nativeEnvironment.TAURI_CONFIG;
let app, browser, page, hostOutput = '';
const oauthConfig = join(process.env.APPDATA, config.identifier, 'plugin-oauth-clients.tano.json');
let originalOAuthConfig, replacedOAuthConfig = false;
async function listenerClosed(redirect) {
  const url = new URL(redirect);
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
try {
  console.log('Building the production frontend and an isolated hidden desktop host.');
  await run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
  await run(process.execPath, [process.env.npm_execpath, 'run', 'mcp:build']);
  await run('cargo', cargoArgs, { env: { ...nativeEnvironment, TAURI_CONFIG: JSON.stringify(config) } });
  const executable = join(directory, 'tano-plugin-smoke.exe');
  await copyFile(join(target, 'release/tano.exe'), executable);
  try { originalOAuthConfig = await readFile(oauthConfig); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(oauthConfig), { recursive: true });
  replacedOAuthConfig = true;
  await writeFile(oauthConfig, JSON.stringify({ version: 1, providers: [{ id: 'native-smoke', label: '本机 OAuth 验收', origin: 'https://api.github.com', scopes: ['read'],
    authorizationEndpoint: 'https://login.example.test/authorize', tokenEndpoint: 'https://login.example.test/token', clientId: 'test-native-client' }] }));
  const workspace = join(directory, 'workspace'), other = join(directory, 'other-workspace');
  await mkdir(workspace); await mkdir(other);
  await writeFile(join(workspace, 'note.md'), '# Native Git\nbase\n');
  const git = args => run('git', args, { cwd: workspace });
  await git(['init']); await git(['add', 'note.md']);
  await git(['-c', 'user.name=Tano Test', '-c', 'user.email=test@example.test', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'Initial']);
  await writeFile(join(workspace, 'note.md'), '# Native Git\nbase\nnative git smoke extra\n');
  const indexBefore = await readFile(join(workspace, '.git/index'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  app = spawn(executable, [], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(directory, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`,
  } });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', bytes => { hostOutput = (hostOutput + bytes.toString()).slice(-128 * 1024); });
  app.on('exit', code => console.log('Isolated desktop host exited:', code));
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(`Desktop host exited (${app.exitCode})`);
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; if (endpoint) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!endpoint) throw new Error('The isolated WebView2 debugging endpoint did not start.');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.has('workspace'));
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.log('WebView page error:', String(error)); });
  page.on('console', message => { if (message.type() === 'error') console.log('WebView console:', message.text()); });
  const open = path => page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').openWorkspace(path), path);
  await open(workspace);
  const identity = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').workspace?.id);
  if (!identity) throw new Error('The native workspace did not open.');
  const insights = await buildPlugin(join(root, 'examples/plugins/task-insights'));
  await acceptTaskInsights(page, expect, insights.canonical, join(artifacts, 'plugin-react-native.png'));
  console.log('React/Chart.js native acceptance passed: pagination, canvas, filters, events and cleanup.');
  const { canonical, integrity } = await buildPlugin(join(root, 'examples/plugins/git-inspector'));
  await page.getByRole('button', { name: '仓库', exact: true }).click();
  await page.getByRole('button', { name: '打开插件标签页', exact: true }).click();
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(canonical);
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件', exact: true }).click();
  await page.getByRole('button', { name: '查看Git 变更详情', exact: true }).click();
  await page.getByRole('button', { name: '授权此版本运行', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await page.getByRole('button', { name: '插件工作台', exact: true }).click();
  await page.getByRole('region', { name: '插件工作台', exact: true }).getByRole('button', { name: /^Git 变更/ }).click();
  const view = page.getByRole('region', { name: 'Git 变更 · Git 变更', exact: true }).frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe');
  await expect(view.getByRole('heading', { name: 'Git 变更', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(view.getByRole('heading', { name: 'Git 变更', exact: true })).toHaveCSS('font-size', '24px');
  await expect.poll(() => page.evaluate(workspaceId => window.__TAURI_INTERNALS__.invoke('load_session', { workspaceId }).then(session => session?.tabs ?? []), identity))
    .toContain('plugin:git-inspector:changes');
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').sessionError)).toBe('');
  await view.getByRole('button', { name: '查看 note.md 工作区差异', exact: true }).click();
  await expect(view.locator('pre')).toContainText('+native git smoke extra', { timeout: 15000 });
  await page.screenshot({ path: join(artifacts, 'plugin-native-webview.png') });
  expect(await readFile(join(workspace, '.git/index'))).toEqual(indexBefore);
  await page.getByRole('button', { name: '仓库', exact: true }).click();
  await page.getByRole('button', { name: '打开插件标签页', exact: true }).click();
  const importer = await buildPlugin(join(root, 'examples/plugins/github-importer'));
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(importer.canonical);
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件', exact: true }).click();
  await expect(page.getByText('GitHub 议题导入 已安装并启用', { exact: true })).toBeVisible();
  // Installation publishes the new row before its completion message. Use its
  // keyboard action after completion so an intervening layout shift cannot lose a pointer click.
  await page.getByRole('button', { name: '查看GitHub 议题导入详情', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: '插件详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '授权此版本运行', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  const connection = page.locator('details[aria-label="插件服务连接"]');
  const expandConnections = async () => {
    // The newly activated Worker inserts a preview above this panel. Wait for its
    // layout before clicking; otherwise it can move the summary between down/up.
    await expect(page.getByRole('button', { name: '读取并预览', exact: true })).toBeVisible();
    await connection.locator('summary').scrollIntoViewIfNeeded();
    if (!await connection.evaluate(node => node.open)) await connection.locator('summary').click();
    await expect(connection).toHaveAttribute('open', '');
  };
  const listConnections = () => page.evaluate(workspaceId => window.__TAURI_INTERNALS__.invoke('plugin_connections_list', { requestId: crypto.randomUUID(), workspaceId }), identity);
  try {
    await expandConnections();
    await connection.getByLabel('连接插件', { exact: true }).selectOption('github-importer');
    await connection.getByLabel('连接允许路径', { exact: true }).fill('/repos/');
    // Deliberately spans all three Windows credential chunks. Never sent to GitHub.
    const synthetic = 'public-native-test-secret-'.repeat(164).slice(0, 4096);
    await connection.getByLabel('插件服务密钥', { exact: true }).fill(synthetic);
    await connection.getByRole('button', { name: '保存并授权此连接', exact: true }).click();
    await expect(connection.getByRole('status')).toContainText('已保存');
    await expect(connection.getByLabel('插件服务密钥', { exact: true })).toHaveValue('');
    const first = (await listConnections())[0];
    expect(first).toMatchObject({ pluginId: 'github-importer', integrity: importer.integrity, hasSecret: true, pathPrefix: '/repos/', methods: ['GET'] });
    expect(JSON.stringify(first)).not.toContain(synthetic);
    console.log('System credential saved; checking renewal after WebView reload.');
    await page.reload();
    // Desktop reload returns to the recent-workspaces screen. Reopen the same
    // directory, then verify credentials survive without re-entering the secret.
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.has('workspace'));
    await open(workspace);
    await page.waitForFunction(id => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace?.id === id, identity);
    await page.getByRole('button', { name: '仓库', exact: true }).click();
    await page.getByRole('button', { name: '打开插件标签页', exact: true }).click();
    await expandConnections();
    await connection.getByLabel('连接插件', { exact: true }).selectOption('github-importer');
    await expect(connection.getByRole('button', { name: '更新并授权当前版本', exact: true })).toBeEnabled();
    await connection.getByRole('button', { name: '更新并授权当前版本', exact: true }).click();
    await expect(connection.getByRole('status')).toContainText('已保存');
    const renewed = (await listConnections())[0]; expect(renewed.version).not.toBe(first.version);
    const denied = await page.evaluate(async ({ workspaceId, integrity }) => {
      const error = async (command, args) => { try { await window.__TAURI_INTERNALS__.invoke(command, args); return ''; } catch (cause) { return String(cause); } };
      return [
        await error('plugin_connections_request', { input: { requestId: crypto.randomUUID(), workspaceId, pluginId: 'github-importer', integrity: 'f'.repeat(64), origin: 'https://api.github.com', request: { path: '/repos/example/repo/issues/1' } } }),
        await error('plugin_connections_request', { input: { requestId: crypto.randomUUID(), workspaceId, pluginId: 'github-importer', integrity, origin: 'https://api.github.com', request: { path: '/repos/example/repo/issues/1', method: 'DELETE' } } }),
      ];
    }, { workspaceId: identity, integrity: importer.integrity });
    expect(denied[0]).toContain('版本已变化'); expect(denied[1]).toContain('未授权');
    await page.screenshot({ path: join(artifacts, 'plugin-native-connections.png') });
    // Exercise real loopback IPC without opening a browser or calling a third-party service.
    const oauth = connection.locator('fieldset.plugin-oauth');
    const startOAuth = async () => {
      await oauth.getByRole('button', { name: '使用账号登录', exact: true }).click();
      const link = oauth.getByRole('link', { name: '前往服务登录', exact: true });
      await expect(link).toBeVisible();
      const url = new URL(await link.getAttribute('href'));
      expect(url.origin).toBe('https://login.example.test');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
      const redirect = new URL(url.searchParams.get('redirect_uri'));
      expect(redirect.hostname).toBe('127.0.0.1');
      expect(redirect.pathname).toBe('/tano/plugins/oauth/native-smoke/callback');
      return { redirect: redirect.href, state: url.searchParams.get('state') };
    };
    const firstFlow = await startOAuth();
    await expect(oauth).toContainText('本地账号连接仅保存在此设备');
    const invalid = await fetch(`${firstFlow.redirect}?state=wrong&error=access_denied`);
    expect(invalid.status).toBe(400); expect(invalid.headers.get('cache-control')).toBe('no-store');
    await expect(oauth.getByRole('link', { name: '前往服务登录', exact: true })).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'plugin-native-oauth.png') });
    const rejected = await fetch(`${firstFlow.redirect}?state=${encodeURIComponent(firstFlow.state)}&error=access_denied`);
    expect(rejected.status).toBe(400); expect(await rejected.text()).not.toContain(firstFlow.state);
    await expect(oauth.getByRole('status')).toContainText('未完成');
    expect(await listConnections()).toEqual([renewed]);
    await expect.poll(() => listenerClosed(firstFlow.redirect)).toBe(true);
    const cancelled = await startOAuth();
    await oauth.getByRole('button', { name: '取消本次连接', exact: true }).click();
    await expect(oauth.getByRole('status')).toContainText('已取消');
    await expect.poll(() => listenerClosed(cancelled.redirect)).toBe(true);
    expect(await listConnections()).toEqual([renewed]);
    await connection.getByRole('button', { name: '撤销 github-importer https://api.github.com 连接', exact: true }).click();
    await expect(connection.getByRole('status').filter({ hasText: '已撤销' })).toBeVisible(); expect(await listConnections()).toEqual([]);
  } finally {
    // Synthetic credentials only; remove this run's entries even if a UI assertion failed.
    for (const entry of await listConnections().catch(() => [])) {
      await page.evaluate(({ workspaceId, entry }) => window.__TAURI_INTERNALS__.invoke('plugin_connections_remove', { requestId: crypto.randomUUID(), workspaceId, pluginId: entry.pluginId, origin: entry.origin, version: entry.version }), { workspaceId: identity, entry });
    }
  }
  await page.getByRole('button', { name: /^已安装/ }).click();
  await page.getByRole('button', { name: '查看Git 变更详情', exact: true }).click();
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Git 变更/ })).toHaveCount(0);
  const switchedFlow = await page.evaluate(({ workspaceId, integrity }) => window.__TAURI_INTERNALS__.invoke('plugin_connections_oauth_start', {
    workspaceId, requestId: crypto.randomUUID(), input: { pluginId: 'github-importer', integrity, origin: 'https://api.github.com', methods: ['GET'], pathPrefix: '/repos/', providerId: 'native-smoke' },
  }), { workspaceId: identity, integrity: importer.integrity });
  await open(other);
  await expect.poll(() => listenerClosed(new URL(switchedFlow.authorizationUrl).searchParams.get('redirect_uri'))).toBe(true);
  const switchedStatus = await page.evaluate(({ workspaceId, flowId }) => window.__TAURI_INTERNALS__.invoke('plugin_connections_oauth_status', { workspaceId, flowId, requestId: crypto.randomUUID() }), { workspaceId: identity, flowId: switchedFlow.id });
  expect(['failed', 'cancelled']).toContain(switchedStatus.status);
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').workspace?.id)).not.toBe(identity);
  const denied = await page.evaluate(async ({ workspaceId, integrity }) => {
    try { await window.__TAURI_INTERNALS__.invoke('plugin_native_request', { request: { requestId: crypto.randomUUID(), workspaceId, pluginId: 'git-inspector', integrity, command: 'git.status', args: {} } }); return ''; }
    catch (error) { return String(error); }
  }, { workspaceId: identity, integrity });
  expect(denied).toContain('已切换'); expect(errors).toEqual([]);
  await writeFile(join(artifacts, 'plugin-native-webview-result.json'), JSON.stringify({ passed: true, workspace: identity, integrity,
    checks: ['production CSP and custom CSS', 'React/Chart.js package with 3-page statistics, canvas pointer and keyboard filters', 'React data refresh after native object edits, archived filtering and empty results', 'React frame teardown, reopen and plugin disable', 'package import and authorization', 'plugin tab session persistence', 'real Rust Git status and diff', 'original index unchanged', 'system credential save with 4096-byte secret', 'credential renewal after reload', 'connection version and method enforcement', 'native OAuth PKCE and loopback callback', 'invalid OAuth state preserves pending flow', 'OAuth denial and cancellation preserve previous connection', 'OAuth listeners close after denial, cancellation and workspace switch', 'credential revocation', 'disable removes UI', 'old workspace IPC denied'],
    directory, completedAt: new Date().toISOString() }, null, 2));
  console.log('Native WebView acceptance passed. Screenshot and result saved in artifacts.');
} catch (error) {
  console.error('Native WebView acceptance failed:', error.message);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifacts, 'plugin-native-webview-failed.png') }).catch(() => {});
    const diagnostic = await page.evaluate(() => {
      const store = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace');
      return { text: document.body.innerText.slice(-5000), plugins: store?.pluginRuntime };
    }).catch(error => ({ error: String(error) }));
    await writeFile(join(directory, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2));
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app && app.exitCode === null) {
    await run('taskkill', ['/PID', String(app.pid), '/T', '/F']).catch(() => { app.kill(); });
  }
  await writeFile(join(directory, 'desktop-host.log'), hostOutput);
  if (replacedOAuthConfig) {
    if (originalOAuthConfig) await writeFile(oauthConfig, originalOAuthConfig);
    else await unlink(oauthConfig);
  }
  // Do not leave a test application identity in the normal release executable.
  console.log('Restoring the normal release host configuration.');
  await run('cargo', cargoArgs, { env: nativeEnvironment });
}
