import { test, expect } from '@playwright/test';
import { resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { startPluginWatch } from './plugin-watch.mjs';
import { buildPlugin } from './plugin-build.mjs';
import { createPlugin } from './plugin-create.mjs';
import { preparePluginRelease, buildPluginCatalog } from './plugin-catalog.mjs';
import { acceptTaskInsights } from './fixtures/task-insights-acceptance.mjs';

const origin = process.env.TANO_PLUGIN_TEST_URL ?? 'http://127.0.0.1:43845';
const moduleUrl = `/@fs/${resolve('packages/workbench/src/plugins').replaceAll('\\', '/')}`;

async function openPluginCenter(page) {
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: /命令中心/ }).click();
  await page.getByRole('combobox', { name: '搜索命令' }).fill('打开插件中心');
  await page.getByRole('option').filter({ hasText: '打开插件中心' }).click();
}

for (const template of ['vue', 'react']) test(`runs a newly generated ${template} starter through real document events and UI messages`, async ({ page }) => {
  test.setTimeout(90000);
  const artifacts = resolve('artifacts'); await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(resolve(artifacts, 'plugin-starter-'));
  const id = `${template}-starter`, target = resolve(directory, id), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await createPlugin(target, template);
    const { canonical } = await buildPlugin(target);
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create('000-template-first.md', false, '# Template original\n');
    });
    await openPluginCenter(page);
    await page.getByRole('button', { name: '导入插件', exact: true }).click();
    await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(canonical);
    await page.getByRole('button', { name: '检查清单' }).click();
    await page.getByRole('button', { name: '安装此插件', exact: true }).click();
    await page.getByRole('button', { name: '查看我的插件详情', exact: true }).click();
    await page.getByRole('button', { name: '授权此版本运行', exact: true }).click();
    await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
    await expect.poll(() => page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === id)?.status, id)).toBe('running');
    await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').openPluginView(id, 'main'), id);
    const surface = page.getByRole('region', { name: '我的插件 · 文档列表', exact: true });
    const ui = surface.frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
    await expect(ui.getByRole('heading', { name: '工作区文档', exact: true })).toBeVisible();
    await expect(ui.getByRole('button', { name: '000-template-first.md', exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(ui.getByRole('alert')).toHaveCount(0);
    const instance = await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === id).instanceId, id);
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create('000-template-second.md', false, '# Template event\n');
    });
    await expect.poll(() => page.evaluate(id => {
      const runtime = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === id);
      return runtime?.views.find(view => view.id === 'main')?.custom?.state?.files?.some(file => file.path === '000-template-second.md');
    }, id)).toBe(true);
    await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').openPluginView(id, 'main'), id);
    await expect(ui.getByRole('button', { name: '000-template-second.md', exact: true })).toBeVisible();
    await ui.getByText('开源许可', { exact: true }).click();
    await expect(ui.locator('pre')).toContainText('Permission is hereby granted');
    await page.screenshot({ path: resolve(artifacts, `plugin-starter-${template}.png`), fullPage: true });
    await ui.getByRole('button', { name: '000-template-first.md', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active?.path)).toBe('000-template-first.md');
    const runtime = await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === id), id);
    expect(runtime.instanceId).toBe(instance);
    expect(runtime.logs.filter(row => row.level === 'error')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    if (!resolve(directory).startsWith(artifacts + sep)) throw new Error('Unexpected starter fixture directory');
    await rm(directory, { recursive: true, force: true });
  }
});

test('runs a packaged React chart through pagination, pointer and keyboard filters, live events and cleanup', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const { canonical } = await buildPlugin(resolve('examples/plugins/task-insights'));
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await acceptTaskInsights(page, expect, canonical, 'artifacts/plugin-react-browser.png');
  expect(errors).toEqual([]);
});

test('manages owner-authorized background tasks in the plugin center without activating foreground code', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  let job, execution, webhookToken;
  const { pkg } = await buildPlugin(resolve('examples/plugins/daily-report'));
  await page.route('**/fixture-automations/**', async route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname.split('/').slice(3);
    if (method === 'PUT') {
      job = { ...request.postDataJSON(), id: path[0], version: crypto.randomUUID(), authorizedBy: 'test-owner', needsAuthorization: false, nextAt: null, webhookConfigured: false };
      return route.fulfill({ json: job });
    }
    if (method === 'GET') return route.fulfill({ json: path[1] === 'runs' ? execution ? [execution] : [] : job ? [job] : [] });
    if (path[1] === 'webhook') {
      job = { ...job, version: crypto.randomUUID(), webhookConfigured: method === 'POST' };
      webhookToken = method === 'POST' ? 'synthetic-test-webhook-token'.padEnd(43, 'x') : undefined;
      return route.fulfill({ json: method === 'POST' ? { job, token: webhookToken } : job });
    }
    if (method === 'DELETE') { job = undefined; return route.fulfill({ status: 204 }); }
    if (path.at(-1) === 'cancel') { execution.status = 'cancelled'; return route.fulfill({ status: 204 }); }
    expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
    execution = { id: crypto.randomUUID(), jobId: job.id, trigger: 'manual', status: 'queued', createdAt: new Date().toISOString(), scheduledAt: new Date().toISOString(), startedAt: null, finishedAt: null, errorCode: null, result: null };
    return route.fulfill({ status: 202, json: { id: execution.id } });
  });
  await page.goto(origin);
  await page.evaluate(async ({ url, pkg }) => { window.automationsFixture = await (await import(url)).mountAutomations(pkg); },
    { url: `/@fs/${resolve('scripts/fixtures/plugin-automations-browser.ts').replaceAll('\\', '/')}`, pkg });
  const center = page.locator('#automations-fixture');
  await center.getByText('后台自动化', { exact: true }).click();
  const panel = center.getByRole('group', { name: '后台自动化', exact: true });
  await panel.getByRole('button', { name: '新建后台任务', exact: true }).click();
  await panel.getByRole('combobox', { name: '自动化插件', exact: true }).selectOption('daily-report');
  await expect(panel.getByRole('button', { name: '保存并授权后台任务' })).toBeDisabled();
  await panel.getByRole('textbox', { name: '后台任务名称' }).fill('每日工作区汇总');
  await panel.getByRole('checkbox', { name: '我已核对版本与权限，授权按以上设置执行' }).check();
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await panel.screenshot({ path: 'artifacts/plugin-automations-form.png' });
  await panel.getByRole('button', { name: '保存并授权后台任务' }).click();
  await expect(panel.getByRole('status')).toContainText('已授权后台执行');
  expect(job.expectedRuleHash).toMatch(/^[a-f0-9]{64}$/);
  await panel.getByRole('button', { name: '关闭编辑' }).click();
  await panel.getByRole('button', { name: '运行 每日工作区汇总', exact: true }).click();
  await expect(panel.getByRole('region', { name: '自动化运行记录' })).toContainText('等待执行');
  await panel.getByRole('button', { name: `停止执行 ${execution.id}` }).click();
  await expect(panel.getByRole('region', { name: '自动化运行记录' })).toContainText('已停止');
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await panel.screenshot({ path: 'artifacts/plugin-automations-history.png' });
  const webhook = panel.getByRole('group', { name: '每日工作区汇总 Webhook', exact: true });
  await webhook.getByText('Webhook · 未配置', { exact: true }).click();
  await webhook.getByRole('checkbox', { name: '允许持有触发凭据的服务运行此任务' }).check();
  await webhook.getByRole('button', { name: '生成触发凭据', exact: true }).click();
  const credential = webhook.getByLabel('Webhook 触发凭据', { exact: true });
  await expect(credential).toHaveValue('synthetic-test-webhook-token'.padEnd(43, 'x'));
  await expect(credential).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(webhookToken);
  await webhook.screenshot({ path: 'artifacts/plugin-automation-webhook.png' });
  await webhook.getByText('Webhook · 已配置', { exact: true }).click();
  await expect(credential).toHaveCount(0);
  await webhook.getByText('Webhook · 已配置', { exact: true }).click();
  await expect(credential).toHaveCount(0);
  await webhook.getByRole('button', { name: '撤销触发凭据' }).click();
  await expect(webhook.getByText('Webhook · 未配置', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.automationsFixture.store.installedPlugins[0].authorized)).toBe(false);
  await panel.getByRole('button', { name: '删除 每日工作区汇总', exact: true }).click();
  await panel.getByRole('button', { name: '删除任务与记录' }).click();
  await expect(panel.getByText('还没有后台任务。')).toBeVisible();
  await page.evaluate(() => window.automationsFixture.dispose());
});

test('runs the Git inspector through its real isolated UI, Worker and named native IPC bridge', async ({ page }) => {
  const calls = [];
  await page.route('**/fixture-native', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (body.command === 'plugin_native_cancel') return route.fulfill({ json: null });
    expect(body.command).toBe('plugin_native_request');
    const request = body.args.request;
    if (request.command === 'git.status') return route.fulfill({ json: { branch: 'main', detached: false, entries: [
      { path: '笔记.md', index: 'M', worktree: 'M', originalPath: null }, { path: '新笔记.md', index: '?', worktree: '?', originalPath: null },
    ] } });
    if (request.command === 'git.log') return route.fulfill({ json: { path: null, commits: [
      { id: '1234567890abcdef1234567890abcdef12345678', shortId: '1234567', author: 'Test', date: '2026-10-19T08:00:00+00:00', subject: '初始化笔记' },
    ] } });
    expect(request.command).toBe('git.diff');
    return route.fulfill({ json: { path: request.args.path, staged: request.args.staged, patch: request.args.staged ? '+已暂存内容' : '+工作区内容' } });
  });
  const { pkg } = await buildPlugin(resolve('scripts/fixtures/native-query-plugin'));
  await page.goto(origin);
  await page.evaluate(async ({ url, pkg }) => { window.nativeFixture = await (await import(url)).mountNative(pkg); },
    { url: `/@fs/${resolve('scripts/fixtures/plugin-native-browser.ts').replaceAll('\\', '/')}`, pkg });
  const view = page.frameLocator('#native-fixture iframe').frameLocator('iframe');
  await expect(view.getByRole('heading', { name: '2 项变更' })).toBeVisible();
  await expect(view.getByText('当前分支 · main')).toBeVisible();
  await expect(view.getByText('初始化笔记', { exact: true })).toBeVisible();
  await expect(view.getByRole('button', { name: '查看 新笔记.md 工作区差异' })).toBeDisabled();
  await view.getByRole('button', { name: '查看 笔记.md 工作区差异', exact: true }).click();
  await expect(view.getByText('+工作区内容', { exact: true })).toBeVisible();
  await view.getByRole('button', { name: '查看 笔记.md 暂存差异', exact: true }).click();
  await expect(view.getByText('+已暂存内容', { exact: true })).toBeVisible();
  const integrity = await page.evaluate(() => window.nativeFixture.integrity);
  expect(calls.filter(call => call.command === 'plugin_native_request').every(call => call.args.request.integrity === integrity
    && call.args.request.workspaceId === '81c90c74-1c40-4d24-9440-bb51228e4563' && call.args.request.pluginId === 'native-query-fixture')).toBe(true);
  await page.screenshot({ path: 'artifacts/plugin-native-preview.png' });
  await view.getByRole('button', { name: '刷新状态' }).click();
  await expect(view.getByRole('region', { name: 'Git 文件差异' })).toHaveCount(0);
  await page.evaluate(() => window.nativeFixture.dispose());
});

test('configures a personal credential through the host and uses the real Worker SDK without exposing it', async ({ page }) => {
  let saved, secret;
  const calls = [];
  await page.route('**/fixture-connections/**', async route => {
    const method = route.request().method(), body = route.request().postDataJSON();
    if (method === 'GET') return route.fulfill({ json: saved ? [saved] : [] });
    if (method === 'PUT') {
      secret = body.secret; const { secret: _secret, ...config } = body;
      saved = { ...config, version: 'a30a7aac-8440-41a1-818e-714187212321', hasSecret: true, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: saved });
    }
    if (method === 'DELETE') { saved = undefined; secret = undefined; return route.fulfill({ status: 204 }); }
    calls.push(body);
    if (!saved || saved.integrity !== body.integrity) return route.fulfill({ status: 403, json: { message: '连接尚未授权或已撤销' } });
    return route.fulfill({ json: { status: 200, body: '已通过宿主连接读取服务', contentType: 'text/plain' } });
  });
  await page.goto(origin);
  await page.evaluate(async url => { const fixture = await import(url); window.connectionsFixture = await fixture.mountConnections(); }, `/@fs/${resolve('scripts/fixtures/plugin-connections-browser.ts').replaceAll('\\', '/')}`);
  const center = page.locator('#connections-fixture');
  await center.getByRole('button', { name: '已安装 1' }).click();
  await center.getByRole('button', { name: '查看服务连接示例详情' }).click();
  await center.getByRole('button', { name: '授权此版本运行' }).click();
  await center.getByRole('button', { name: '关闭插件窗口' }).click();
  await center.getByText('服务连接与凭据', { exact: true }).click();
  const connections = center.getByRole('group', { name: '插件服务连接' });
  await connections.getByRole('combobox', { name: '连接插件' }).selectOption('service-example');
  await connections.getByRole('textbox', { name: '连接允许路径' }).fill('/v1/');
  await connections.getByRole('textbox', { name: '插件服务密钥' }).fill('browser-test-secret-only');
  await connections.getByRole('button', { name: '保存并授权此连接' }).click();
  await expect(connections.getByRole('status')).toContainText('已保存');
  await expect(connections.getByRole('textbox', { name: '插件服务密钥' })).toHaveValue('');
  expect(secret).toBe('browser-test-secret-only');
  await center.getByRole('button', { name: '请求服务', exact: true }).click();
  await expect(center.getByText('已通过宿主连接读取服务', { exact: true })).toBeVisible();
  expect(calls[0]).toMatchObject({ pluginId: 'service-example', integrity: saved.integrity, origin: 'https://api.example.com', request: { path: '/v1/items', method: 'GET' } });
  expect(JSON.stringify(calls)).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
  await connections.getByRole('button', { name: '撤销 service-example https://api.example.com 连接' }).click();
  await expect(connections.getByRole('status')).toContainText('连接已撤销');
  await center.getByRole('button', { name: '请求服务', exact: true }).click();
  await expect(center.getByText(/连接尚未授权或已撤销/).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-connections-preview.png' });
  await page.evaluate(() => window.connectionsFixture.dispose());
});

test('connects an OAuth account through host UI and polls the result without exposing tokens to a Worker', async ({ page, context }) => {
  let saved, started, complete = false;
  await context.route('https://login.example.com/authorize', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><a href="https://tano.example.com/oauth/callback">完成测试授权</a>' }));
  await context.route('https://tano.example.com/oauth/callback', route => { complete = true; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><p>测试账号已连接</p>' }); });
  await page.route('**/fixture-connections/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path.endsWith('/oauth/providers')) return route.fulfill({ json: [{ id: 'example', label: '模拟 OAuth 服务', origin: 'https://api.example.com', scopes: ['items.read'] }] });
    if (path.endsWith('/oauth') && method === 'POST') { started = route.request().postDataJSON(); return route.fulfill({ json: { id: 'f'.repeat(43), authorizationUrl: 'https://login.example.com/authorize', expiresAt: new Date(Date.now() + 600000).toISOString() } }); }
    if (path.includes('/oauth/')) {
      if (method === 'DELETE') return route.fulfill({ status: 204 });
      if (complete) { const { providerId, ...input } = started; saved = { ...input, authentication: 'bearer', oauth: { providerId }, version: 'a30a7aac-8440-41a1-818e-714187212321', hasSecret: true, updatedAt: new Date().toISOString() }; }
      return route.fulfill({ json: { status: complete ? 'completed' : 'pending' } });
    }
    if (method === 'GET') return route.fulfill({ json: saved ? [saved] : [] });
    const request = route.request().postDataJSON(); expect(request).not.toHaveProperty('secret');
    expect(request.integrity).toBe(saved.integrity);
    return route.fulfill({ json: { status: 200, body: '通过账号连接读取成功', contentType: 'text/plain' } });
  });
  await page.goto(origin);
  await page.evaluate(async url => { window.connectionsFixture = await (await import(url)).mountConnections(true); }, `/@fs/${resolve('scripts/fixtures/plugin-connections-browser.ts').replaceAll('\\', '/')}`);
  const center = page.locator('#connections-fixture');
  await center.getByRole('button', { name: '已安装 1' }).click();
  await center.getByRole('button', { name: '查看服务连接示例详情' }).click();
  await center.getByRole('button', { name: '授权此版本运行' }).click();
  await center.getByRole('button', { name: '关闭插件窗口' }).click();
  await center.getByText('服务连接与凭据', { exact: true }).click();
  await center.getByRole('combobox', { name: '连接插件' }).selectOption('service-example');
  await center.getByRole('textbox', { name: '连接允许路径' }).fill('/v1/');
  await center.getByRole('button', { name: '使用账号登录', exact: true }).click();
  await expect(center.getByRole('link', { name: '前往服务登录' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-oauth-preview.png' });
  const popupPromise = page.waitForEvent('popup'); await center.getByRole('link', { name: '前往服务登录' }).click();
  const popup = await popupPromise; await popup.getByRole('link', { name: '完成测试授权' }).click();
  await expect(center.getByText(/已连接账号/)).toBeVisible(); await popup.close();
  expect(started).toMatchObject({ providerId: 'example', methods: ['GET'], pathPrefix: '/v1/' });
  await center.getByRole('button', { name: '请求服务', exact: true }).click();
  await expect(center.getByText('通过账号连接读取成功', { exact: true })).toBeVisible();
  await page.evaluate(() => window.connectionsFixture.dispose());
});

test('discovers reviewed releases, installs exact bytes without implicit trust, and rejects withdrawn updates', async ({ page }) => {
  const directory = await mkdtemp(resolve('artifacts/plugin-catalog-'));
  try {
    const pkg = version => ({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'community-test', name: '社区示例', version,
      description: '通过发布目录安装', objectTypes: [], relationTypes: [], permissions: version === '2.0.0' ? ['storage'] : [], commands: [], views: [{ id: 'main', label: '版本内容' }] },
      source: `await tano.views.render('main', { type: 'text', text: '社区代码 ${version} 正在运行' });` });
    const releases = [];
    for (const version of ['1.0.0', '2.0.0']) {
      await writeFile(resolve(directory, 'input.json'), JSON.stringify(pkg(version)));
      releases.push(await preparePluginRelease(resolve(directory, 'input.json'), resolve(directory, version), { publisher: 'author', source: `https://source.example.com/commit/${version}`, license: 'MIT' }));
    }
    await copyFile(resolve(directory, '2.0.0/packages', `${releases[1].integrity}.json`), resolve(directory, '1.0.0/packages', `${releases[1].integrity}.json`));
    const catalog = { catalogVersion: 1, name: '社区测试目录', updatedAt: releases[1].publishedAt,
      publishers: [{ id: 'author', name: '示例发布者', homepage: 'https://source.example.com/author', pluginIds: ['community-test'] }], releases };
    await writeFile(resolve(directory, 'reviewed.json'), JSON.stringify(catalog));
    const output = resolve(directory, 'built');
    await buildPluginCatalog(resolve(directory, 'reviewed.json'), output, { packages: resolve(directory, '1.0.0/packages'), initial: true });
    let indexContent = await readFile(resolve(output, 'index.json'), 'utf8');
    const requests = [];
    await page.route('https://catalog.example.com/**', async route => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: path === '/index.json' ? indexContent : await readFile(resolve(output, path.slice(1)), 'utf8') });
    });
    await page.goto(origin);
    await page.evaluate(async url => { const fixture = await import(url); window.catalogFixture = await fixture.mountCatalog('https://catalog.example.com/index.json'); }, `/@fs/${resolve('scripts/fixtures/plugin-catalog-browser.ts').replaceAll('\\', '/')}`);
    const center = page.locator('#catalog-fixture');
    await center.getByRole('button', { name: '社区目录', exact: true }).click();
    await center.getByRole('button', { name: '查看社区插件 社区示例' }).click();
    await expect(center.getByText('示例发布者', { exact: true })).toBeVisible();
    await center.getByRole('combobox', { name: '目录插件版本' }).selectOption(releases[0].integrity);
    await center.getByRole('button', { name: '安装所选版本' }).click();
    await expect(center.getByRole('dialog').getByRole('status')).toContainText('请在“已安装”详情中核对并授权');
    expect(await page.evaluate(() => window.catalogFixture.store.installedPlugins[0].authorized)).toBe(false);
    await center.getByRole('button', { name: '关闭插件窗口' }).click();
    await center.getByRole('button', { name: '已安装 1' }).click();
    await center.getByRole('button', { name: '查看社区示例详情' }).click();
    await center.getByRole('button', { name: '授权此版本运行' }).click();
    await center.getByRole('button', { name: '关闭插件窗口' }).click();
    await expect(center.getByText('社区代码 1.0.0 正在运行', { exact: true })).toBeVisible();
    await center.getByRole('button', { name: '社区目录', exact: true }).click();
    await center.getByRole('button', { name: '查看社区插件 社区示例' }).click();
    await expect(center.getByText('新增权限：保存插件本机状态')).toBeVisible();
    await page.screenshot({ path: 'artifacts/plugin-catalog-preview.png' });
    releases[1].status = 'withdrawn'; releases[1].reason = '等待修复';
    indexContent = JSON.stringify(catalog);
    await center.getByRole('button', { name: '安装所选版本' }).click();
    await expect(center.getByRole('alert')).toContainText('已撤回或变化');
    expect(requests.filter(path => path.includes(releases[1].integrity))).toHaveLength(0);
    expect(await page.evaluate(() => window.catalogFixture.store.installedPlugins[0].manifest.version)).toBe('1.0.0');
    await center.getByRole('button', { name: '关闭插件窗口' }).click();
    await center.getByRole('button', { name: '刷新目录' }).click();
    await center.getByRole('button', { name: '查看社区插件 社区示例' }).click();
    await center.getByRole('combobox', { name: '目录插件版本' }).selectOption(releases[1].integrity);
    await expect(center.getByText(/此版本已撤回：等待修复/)).toBeVisible();
    await expect(center.getByRole('button', { name: '安装所选版本' })).toBeDisabled();
    await page.evaluate(() => window.catalogFixture.dispose());
  } finally {
    if (!resolve(directory).startsWith(resolve('artifacts/plugin-catalog-'))) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});

test('manages orphan cloud packages, protects pinned versions and surfaces concurrent rule changes', async ({ page }) => {
  const pinned = { integrity: 'a'.repeat(64), pluginId: 'installed', version: '1.0.0', bytes: 1200, state: 'ready', pinned: true, removable: false, createdAt: new Date().toISOString() };
  const orphan = { ...pinned, integrity: 'b'.repeat(64), pluginId: 'uninstalled', pinned: false, removable: true };
  let entries = [pinned, orphan], conflict = true;
  const deleted = [];
  await page.route('**/fixture-packages/**', async route => {
    if (route.request().method() === 'DELETE') {
      if (conflict) { orphan.pinned = true; orphan.removable = false; return route.fulfill({ status: 409, json: { message: '当前或历史规则仍引用此版本' } }); }
      deleted.push(route.request().url()); entries = [pinned]; return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { used: entries.length * 1200, limit: 64 * 1024 * 1024, entryLimit: 1024, entries } });
  });
  await page.goto(origin);
  await page.evaluate(async url => { const fixture = await import(url); window.disposeRepository = await fixture.mountRepository(); }, `/@fs/${resolve('scripts/fixtures/plugin-repository-browser.ts').replaceAll('\\', '/')}`);
  const panel = page.locator('#repository-fixture');
  await panel.getByText('工作区云端包存储', { exact: true }).click();
  await expect(panel.getByRole('button', { name: '回收 installed 1.0.0 aaaaaaaa' })).toBeDisabled();
  const button = panel.getByRole('button', { name: '回收 uninstalled 1.0.0 bbbbbbbb' });
  await button.click(); await expect(panel.getByRole('alert')).toContainText('当前或历史规则仍引用');
  await panel.getByRole('button', { name: '刷新云端容量' }).click(); await expect(button).toBeDisabled();
  conflict = false; orphan.pinned = false; orphan.removable = true;
  await panel.getByRole('button', { name: '刷新云端容量' }).click(); await expect(button).toBeEnabled(); await button.click();
  await expect(panel.getByText('已回收云端版本', { exact: true })).toBeVisible(); await expect(button).toHaveCount(0);
  expect(deleted).toHaveLength(1); expect(deleted[0]).toMatch(/\/fixture-packages\/[^/]+\/b{64}$/);
  await page.evaluate(() => window.disposeRepository());
});

test('watches source edits through developer mode, keeps the last build on compiler errors and stops on new permissions', async ({ page }) => {
  const directory = await mkdtemp(resolve('artifacts/plugin-development-'));
  let watcher;
  const manifest = { manifestVersion: 2, apiVersion: 1, id: 'development-test', name: '自动重载示例', version: '1.0.0',
    description: '', objectTypes: [], relationTypes: [], permissions: [], commands: [], views: [{ id: 'main', label: '构建内容' }] };
  const source = text => `export default async function(tano) { await tano.views.render('main', { type: 'text', text: '${text}' }); }`;
  try {
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(resolve(directory, 'main.ts'), source('开发构建第一版'));
    const built = await buildPlugin(directory);
    watcher = await startPluginWatch(directory, { origin });
    await page.goto(origin);
    await openPluginCenter(page);
    await page.getByRole('button', { name: '导入插件', exact: true }).click();
    await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(built.canonical);
    await page.getByRole('button', { name: '检查清单' }).click();
    await page.getByRole('button', { name: '安装此插件', exact: true }).click();
    await page.getByRole('button', { name: '查看自动重载示例详情' }).click();
    await page.getByRole('button', { name: '授权此版本运行' }).click();
    const maintenance = page.getByRole('region', { name: '插件版本与维护' });
    await maintenance.getByText('开发模式', { exact: true }).click();
    await maintenance.getByRole('textbox', { name: '插件开发地址' }).fill(watcher.url);
    await maintenance.getByRole('checkbox', { name: '信任此开发会话中权限不变的新构建' }).check();
    await maintenance.getByRole('button', { name: '开始自动重载' }).click();
    await expect(maintenance.getByText('正在监听构建变化', { exact: true })).toBeVisible();
    await writeFile(resolve(directory, 'main.ts'), 'export default function BROKEN {');
    await expect(maintenance.getByText(/源码构建失败或尚未就绪/)).toBeVisible();
    await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
    await expect(page.getByText('开发构建第一版', { exact: true })).toBeVisible();
    await writeFile(resolve(directory, 'main.ts'), source('开发构建第二版'));
    await expect(page.getByText('开发构建第二版', { exact: true })).toBeVisible({ timeout: 15000 });
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ ...manifest, permissions: ['storage'] }));
    await page.getByRole('button', { name: '查看自动重载示例详情' }).click();
    await maintenance.getByText('开发模式', { exact: true }).click();
    await expect(maintenance.getByText(/插件身份或权限声明已变化/)).toBeVisible({ timeout: 10000 });
    await expect(maintenance.getByRole('button', { name: '停止自动重载' })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
    await expect(page.getByText('开发构建第二版', { exact: true })).toBeVisible();
  } finally {
    await watcher?.close();
    if (!resolve(directory).startsWith(resolve('artifacts/plugin-development-'))) throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});

test('stores large packages in IndexedDB, migrates legacy bytes, and enforces the cache quota atomically', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async moduleUrl => {
    const { PluginPackageCache, pluginIntegrity } = await import(`${moduleUrl}/packages.ts`);
    const { documentOverviewPlugin } = await import(`${moduleUrl}/example.ts`);
    const cache = new PluginPackageCache();
    const legacyHash = await pluginIntegrity(documentOverviewPlugin);
    localStorage.setItem(`tano.plugin-package.v1.${legacyHash}`, JSON.stringify(documentOverviewPlugin));
    await cache.get(legacyHash);
    const hashes = [];
    let error = '';
    for (let index = 0; index < 17; index++) {
      const pkg = { ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest, version: `1.0.${index}` }, source: '/*' + 'x'.repeat(4 * 1024 * 1024 - 2000) + '*/' };
      try { hashes.push(await cache.put(pkg)); } catch (cause) { error = String(cause); break; }
    }
    const entries = await cache.entries();
    const originalExists = !!await cache.get(hashes[0]);
    await cache.remove(hashes[1]);
    return { error, count: hashes.length, bytes: entries.reduce((sum, row) => sum + row.bytes, 0), originalExists,
      removed: await cache.get(hashes[1]) === null, legacyRemoved: localStorage.getItem(`tano.plugin-package.v1.${legacyHash}`) === null };
  }, moduleUrl);
  expect(result.count).toBe(16); expect(result.error).toContain('64 MiB'); expect(result.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(result.originalExists).toBe(true); expect(result.removed).toBe(true); expect(result.legacyRemoved).toBe(true);
});

test('upgrades, authorizes, inspects logs and rolls back a plugin through its maintenance interface', async ({ page }) => {
  await page.goto(origin);
  const pkg = version => ({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'maintenance-test', name: '维护示例', version,
    description: 'Maintenance integration', objectTypes: [], relationTypes: [], permissions: [], commands: [], views: [{ id: 'main', label: '版本内容' }] },
    source: `console.warn('构建 ${version} 已启动'); await tano.views.render('main', {type: 'text', text: '当前构建 ${version}'});` });
  await openPluginCenter(page);
  const install = async version => {
    await page.getByRole('button', { name: '导入插件', exact: true }).click();
    await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(JSON.stringify(pkg(version)));
    await page.getByRole('button', { name: '检查清单' }).click();
    await page.getByRole('button', { name: /^(安装此插件|更新并启用插件)$/ }).click();
    await page.getByRole('button', { name: '查看维护示例详情' }).click();
    await page.getByRole('button', { name: '授权此版本运行' }).click();
  };
  await install('1.0.0');
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByText('当前构建 1.0.0', { exact: true })).toBeVisible();
  await install('2.0.0');
  const maintenance = page.getByRole('region', { name: '插件版本与维护' });
  await maintenance.getByText(/^运行日志（/).click();
  await expect(maintenance.getByText('构建 2.0.0 已启动', { exact: true })).toBeVisible();
  await maintenance.getByRole('button', { name: '重新加载当前版本' }).click();
  await expect(maintenance.getByText('已重新加载当前版本', { exact: true })).toBeVisible();
  await maintenance.getByText(/^历史版本（/).click();
  await maintenance.getByRole('button', { name: '恢复版本 1.0.0' }).click();
  await expect(page.getByRole('button', { name: '授权此版本运行' })).toBeVisible();
  await page.getByRole('button', { name: '授权此版本运行' }).click();
  await expect(maintenance.getByRole('button', { name: '恢复版本 2.0.0' })).toBeVisible();
  await maintenance.getByRole('button', { name: '清空日志' }).click();
  await expect(maintenance.getByText('运行日志（0）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByText('当前构建 1.0.0', { exact: true })).toBeVisible();
});

for (const desktopCsp of [true, false]) for (const navigation of ['navigation', 'form']) test(`isolates custom UI scripts, styles, network, storage and ${navigation} (${desktopCsp ? 'desktop CSP' : 'web'})`, async ({ page }) => {
  page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
  page.on('pageerror', error => console.log(String(error)));
  const requests = [];
  await page.route('https://plugin-exfil.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const csp = JSON.parse(readFileSync('apps/client/src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  if (desktopCsp) await page.route(origin + '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await page.goto(origin);
  await page.evaluate(async moduleUrl => {
    const { createPluginUiSandbox, uiInnerBootstrap } = await import(`${moduleUrl}/ui-sandbox.ts`);
    const container = document.createElement('div'); container.style.cssText = 'position:fixed;inset:0;height:400px;z-index:99999;background:white'; document.body.append(container);
    window.uiMessages = []; window.uiFailure = ''; window.uiLogs = [];
    window.uiSandbox = createPluginUiSandbox(container, { html: '<h1 id="state"></h1><button id="send">发送界面消息</button><button id="navigate">测试导航</button><button id="form">测试表单</button>',
      css: 'h1{color:rgb(12, 34, 56)}body{font-family:sans-serif}', source: `
        console.warn('界面日志测试');
        tanoView.onState(state => document.querySelector('#state').textContent = state.label);
        document.querySelector('#send').onclick = () => tanoView.postMessage({ action: 'increment' });
        document.querySelector('#navigate').onclick = () => { location.href = 'https://plugin-exfil.invalid/navigation'; };
        const checks = {};
        for (const [key, read] of Object.entries({ parent: () => parent.document, top: () => top.document, cookies: () => document.cookie, storage: () => localStorage.length })) {
          try { read(); checks[key] = 'allowed'; } catch { checks[key] = 'blocked'; }
        }
        try { await fetch('https://plugin-exfil.invalid/fetch'); checks.network = 'allowed'; } catch { checks.network = 'blocked'; }
        try {
          const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'])));
          checks.worker = await new Promise(resolve => { worker.onmessage = () => resolve('allowed'); worker.onerror = event => { event.preventDefault(); resolve('blocked'); }; });
          worker.terminate();
        } catch { checks.worker = 'blocked'; }
        checks.webrtc = typeof RTCPeerConnection;
        const nested = document.createElement('iframe');
        nested.srcdoc = '<script>' + ${JSON.stringify(uiInnerBootstrap)} + '</scr' + 'ipt>';
        const nestedResult = new Promise(resolve => addEventListener('message', event => { if (event.source === nested.contentWindow && event.data?.nested) resolve(event.data.rtc); }));
        nested.onload = () => nested.contentWindow.postMessage({ type: 'tano-view-code', source: 'parent.postMessage({nested: true, rtc: typeof RTCPeerConnection}, "*")' }, '*');
        document.body.append(nested); checks.nestedWebrtc = await nestedResult; nested.remove();
        checks.ipc = typeof window.__TAURI_INTERNALS__;
        document.querySelector('#form').onclick = () => { const form = document.createElement('form'); form.action = 'https://plugin-exfil.invalid/form'; document.body.append(form); form.submit(); };
        document.head.insertAdjacentHTML('beforeend', '<style>body { background-image: url(https://plugin-exfil.invalid/css); }</style>');
        const img = new Image(); img.src = 'https://plugin-exfil.invalid/image'; document.body.append(img);
        await tanoView.postMessage({ checks });
      ` }, { label: '自定义界面已就绪' }, async message => {
        window.uiMessages.push(message);
        if (message.action === 'increment') window.uiSandbox.update({ label: '消息往返成功' });
      }, error => { window.uiFailure = error; }, (level, message) => window.uiLogs.push({ level, message }));
  }, moduleUrl);
  const ui = page.frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
  await expect(ui.getByRole('heading', { name: '自定义界面已就绪' })).toBeVisible();
  await expect(ui.getByRole('heading')).toHaveCSS('color', 'rgb(12, 34, 56)');
  await expect.poll(() => page.evaluate(() => window.uiLogs)).toContainEqual({ level: 'warn', message: '界面日志测试' });
  await expect.poll(() => page.evaluate(() => window.uiMessages.find(message => message.checks))).toEqual({ checks: {
    parent: 'blocked', top: 'blocked', cookies: 'blocked', storage: 'blocked', network: 'blocked', worker: 'blocked', webrtc: 'undefined', nestedWebrtc: 'undefined', ipc: 'undefined',
  } });
  await ui.getByRole('button', { name: '发送界面消息' }).click();
  await expect(ui.getByRole('heading', { name: '消息往返成功' })).toBeVisible();
  await ui.getByRole('button', { name: navigation === 'form' ? '测试表单' : '测试导航' }).click();
  await expect.poll(() => page.evaluate(() => window.uiFailure)).toContain('未授权导航');
  expect(requests).toEqual([]);
  await expect(page.locator('iframe[title="插件界面隔离容器"]')).toHaveCount(0);
});

test('packs and runs the Vue kanban, persists drag and keyboard moves, and tears down its frames', async ({ page }) => {
  execFileSync(process.execPath, ['scripts/plugin.mjs', 'pack', 'examples/plugins/kanban', 'artifacts/kanban.tano-plugin.json']);
  const content = readFileSync('artifacts/kanban.tano-plugin.json', 'utf8');
  const errors = []; page.on('pageerror', error => errors.push(error.stack ?? String(error)));
  await page.goto(origin);
  await openPluginCenter(page);
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(content);
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件' }).click();
  await page.getByRole('button', { name: '查看任务看板详情' }).click();
  await page.getByRole('button', { name: '授权此版本运行' }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  await page.getByRole('navigation', { name: '插件视图' }).getByRole('button', { name: /^任务看板/ }).click();
  const surface = page.getByRole('region', { name: '任务看板 · 任务看板' });
  const ui = surface.frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
  await ui.getByRole('textbox', { name: '新任务名称' }).fill('验证隔离看板');
  await ui.getByRole('button', { name: '添加任务', exact: true }).click();
  const card = ui.getByRole('article', { name: '验证隔离看板', exact: true });
  await expect(ui.getByRole('region', { name: '待办', exact: true }).getByRole('article', { name: '验证隔离看板' })).toBeVisible();
  await card.dragTo(ui.getByRole('region', { name: '进行中', exact: true }));
  await expect(ui.getByRole('region', { name: '进行中', exact: true }).getByRole('article', { name: '验证隔离看板' })).toBeVisible();
  await ui.getByRole('combobox', { name: '移动验证隔离看板', exact: true }).selectOption('done');
  await expect(ui.getByRole('region', { name: '已完成', exact: true }).getByRole('article', { name: '验证隔离看板' })).toBeVisible();
  await ui.getByRole('textbox', { name: '新任务名称' }).fill('整理插件开发文档');
  await ui.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(ui.getByRole('article', { name: '整理插件开发文档' })).toBeVisible();
  await page.reload();
  await expect(ui.getByRole('region', { name: '已完成', exact: true }).getByRole('article', { name: '验证隔离看板' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-kanban.png', fullPage: true });
  await openPluginCenter(page);
  await page.getByRole('button', { name: /^已安装/ }).click();
  await page.getByRole('button', { name: '查看任务看板详情' }).click();
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.locator('iframe[title="插件界面隔离容器"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('runs the SDK in a CSP sandbox and blocks ambient network, cookies and parent access', async ({ page }) => {
  page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
  page.on('pageerror', error => console.log(String(error)));
  const csp = JSON.parse(readFileSync('apps/client/src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  await page.route(origin + '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await page.goto(origin);
  const result = await page.evaluate(async moduleUrl => {
    const { PluginExecutionHost } = await import(`${moduleUrl}/host.ts`);
    const { PluginPackageCache } = await import(`${moduleUrl}/packages.ts`);
    const { documentOverviewPlugin } = await import(`${moduleUrl}/example.ts`);
    const pkg = { ...documentOverviewPlugin, source: `
      const checks = { document: typeof document, localStorage: typeof localStorage, parent: typeof parent };
      try { await fetch('https://example.com/leak'); checks.network = 'allowed'; } catch { checks.network = 'blocked'; }
      try { const open = indexedDB.open('host-data'); await new Promise((resolve, reject) => { open.onsuccess = resolve; open.onerror = reject; }); checks.storage = 'allowed'; } catch { checks.storage = 'blocked'; }
      try { await tano.documents.create('escape.md', 'not allowed'); checks.write = 'allowed'; } catch { checks.write = 'blocked'; }
      await tano.views.render('overview', { type: 'text', text: JSON.stringify(checks) });
      await tano.commands.register('refresh', async () => { await tano.notify('command executed'); });
    ` };
    const cache = new PluginPackageCache();
    const integrity = await cache.put(pkg);
    let states = [];
    const host = new PluginExecutionHost({ call: async () => { throw new Error('unexpected document access'); } }, value => { states = value; });
    const rule = { manifest: pkg.manifest, integrity, mode: 'required', settings: {} };
    host.sync({ id: 'browser-test', path: '/browser-test', name: 'test', files: [] }, [{ manifest: pkg.manifest, rule, enabled: true, authorized: true }]);
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && !['running', 'error'].includes(states[0]?.status)) await new Promise(resolve => setTimeout(resolve, 50));
    if (states[0]?.status !== 'running') { const result = { error: states }; host.dispose(); return result; }
    const checks = JSON.parse(states[0].views[0].tree.text);
    await host.invoke(pkg.manifest.id, 'command', 'refresh');
    const message = states[0].message;
    host.dispose();
    return { checks, message, remainingFrames: document.querySelectorAll('iframe[title="插件隔离运行时"]').length };
  }, moduleUrl);
  expect(result).toEqual({ checks: { document: 'undefined', localStorage: 'undefined', parent: 'undefined', network: 'blocked', storage: 'blocked', write: 'blocked' }, message: 'command executed', remainingFrames: 0 });
});

test('installs, authorizes and runs a plugin through the plugin center', async ({ page }) => {
  await page.goto(origin);
  await openPluginCenter(page);
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('button', { name: '载入文档总览示例' }).click();
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件' }).click();
  await page.getByRole('button', { name: '查看文档总览详情' }).click();
  await page.getByRole('button', { name: '授权此版本运行' }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新文档总览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新文档总览', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^工作区文档 ·/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-center.png', fullPage: true });
});

test('round-trips form values and document writes through the real worker SDK', async ({ page }) => {
  await page.goto(origin);
  const pkg = { packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'notes-form', name: '表单笔记',
    version: '1.0.0', description: 'SDK integration test', objectTypes: [], relationTypes: [], permissions: ['documents.read', 'documents.write'],
    commands: [], views: [{ id: 'form', label: '创建文档' }] }, source: `
      tano.views.onAction('form', async ({ values }) => {
        const file = await tano.documents.create(values.title + '.md', '# Created\\n');
        const before = await tano.documents.read(file.id);
        await tano.documents.write(file.id, '# ' + values.title + '\\n', before.hash);
        const after = await tano.documents.read(file.id);
        if (after.content !== '# ' + values.title + '\\n') throw new Error('write mismatch');
        await tano.documents.edit(file.id, [{ from: after.content.length, to: after.content.length, insert: '\\nPlugin search marker\\n' }], after.hash);
        const page = await tano.documents.query({ query: values.title, limit: 1 });
        if (page.items[0]?.id !== file.id) throw new Error('query mismatch');
        const search = await tano.documents.search('Plugin search marker', { pathPrefix: values.title });
        if (search.items[0]?.id !== file.id) throw new Error('search mismatch');
        await tano.notify('已创建：' + values.title);
      });
      await tano.views.render('form', { type: 'stack', children: [
        { type: 'input', key: 'title', label: '文档标题', value: '插件笔记' },
        { type: 'button', action: 'create', label: '创建插件笔记' }
      ] });
    ` };
  await openPluginCenter(page);
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(JSON.stringify(pkg));
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件' }).click();
  await page.getByRole('button', { name: '查看表单笔记详情' }).click();
  await page.getByRole('button', { name: '授权此版本运行' }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档标题' })).toHaveValue('插件笔记');
  await page.getByRole('textbox', { name: '文档标题' }).fill('自定义标题');
  await page.getByRole('button', { name: '创建插件笔记' }).click();
  await expect(page.getByText('已创建：自定义标题', { exact: true })).toBeVisible();
});

test('uses plugin pages without desktop tabs, sidebar, settings, menus, palette and shortcuts, then removes disabled entries', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin);
  const pkg = { packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'workbench-test', name: '工作台示例',
    version: '1.0.0', description: 'Workbench integration test', objectTypes: [], relationTypes: [], permissions: [],
    commands: [{ id: 'open-board', label: '打开示例看板' }, { id: 'ping', label: '运行示例命令', shortcut: 'Alt+Shift+J', menus: ['workspace', 'document', 'file'] }],
    views: [{ id: 'board', label: '示例看板', location: 'tab' }, { id: 'summary', label: '示例摘要', location: 'sidebar' },
      { id: 'preferences', label: '示例偏好', location: 'settings' }] }, source: `
      let count = 0;
      await tano.commands.register('open-board', () => tano.views.open('board'));
      await tano.commands.register('ping', context => tano.notify('示例命令 ' + (++count) + (context?.fileId ? ' 文档' : ' 工作区')));
      await tano.views.render('board', { type: 'heading', text: '看板已经就绪' });
      await tano.views.render('summary', { type: 'text', text: '侧栏摘要已经就绪' });
      await tano.views.render('preferences', { type: 'stack', children: [
        { type: 'input', key: 'title', label: '示例标题', value: '默认标题' }, { type: 'button', action: 'save', label: '保存示例偏好' }
      ] });
      tano.views.onAction('preferences', ({ values }) => tano.notify('已保存示例偏好：' + values.title));
    ` };
  await openPluginCenter(page);
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(JSON.stringify(pkg));
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件' }).click();
  await page.getByRole('button', { name: '查看工作台示例详情' }).click();
  await page.getByRole('button', { name: '授权此版本运行' }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();

  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  const sidebar = page.getByRole('region', { name: '插件工作台', exact: true });
  await sidebar.getByRole('button', { name: /^示例看板/ }).click();
  await expect(page.locator('.workspace-tabbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '看板已经就绪' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.workspace-tabbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '看板已经就绪' })).toBeVisible();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  await sidebar.getByRole('button', { name: /^示例摘要/ }).click();
  await expect(sidebar.getByText('侧栏摘要已经就绪', { exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: /^示例偏好/ }).click();
  await expect(page.getByRole('textbox', { name: '示例标题', exact: true })).toHaveValue('默认标题');
  await page.getByRole('textbox', { name: '示例标题', exact: true }).fill('工作区偏好');
  await page.getByRole('button', { name: '保存示例偏好', exact: true }).click();
  await expect(page.getByRole('region', { name: '工作台示例 · 示例偏好' }).getByText('已保存示例偏好：工作区偏好')).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await sidebar.getByRole('menuitem', { name: /运行示例命令/ }).click();
  await expect(sidebar.getByText('示例命令 1 工作区', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+Shift+J');
  await expect(sidebar.getByText('示例命令 2 工作区', { exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+P');
  await page.getByRole('combobox', { name: '搜索命令' }).fill('打开示例看板');
  await expect(page.getByRole('option', { selected: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '命令中心' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText('打开示例看板');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '命令中心' })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '看板已经就绪' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/plugin-workbench.png', fullPage: true });

  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.getByRole('treeitem', { name: '01-基础块与行内', exact: true }).click();
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('menuitem', { name: /运行示例命令/ }).click();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  await expect(sidebar.getByText('示例命令 3 文档', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.getByRole('treeitem', { name: '01-基础块与行内', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /运行示例命令/ }).click();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  await expect(sidebar.getByText('示例命令 4 文档', { exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByRole('button', { name: /^已安装/ }).click();
  await page.getByRole('button', { name: '查看工作台示例详情' }).click();
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByRole('tab', { name: /示例看板/ })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: /^示例摘要/ })).toHaveCount(0);
  await expect(sidebar.getByRole('menuitem', { name: /运行示例命令/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
