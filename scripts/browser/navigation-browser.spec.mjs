import { buildPlugin } from '../plugin/plugin-build.mjs';
import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

async function selectContext(page, context) {
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  if (context === 'home') await page.locator('#workspace-menu').getByRole('button', { name: '主页', exact: true }).click();
  else await page.locator('#workspace-menu [data-workspace-entry-id]').first().click();
}

test('workspace browsing preserves content and assistant drafts across entry points', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  const editor = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/p\//);
  const original = page.url();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '事件与任务', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await expect(page.getByRole('button', { name: '计划范围', exact: true })).toBeDisabled();
  await selectContext(page, 'home');
  await page.locator('.sidebar-navigation').getByRole('button', { name: '计划', exact: true }).click();
  await expect(page.getByRole('button', { name: '计划范围', exact: true })).toBeEnabled();
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await expect(page.locator('.sidebar-view-header')).toBeHidden();
  await selectContext(page, 'workspace');
  await page.getByRole('button', { name: '切换侧边栏视图：事件与任务', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-new').click();
  await page.locator('.assistant-panel textarea').fill('尚未发送的助手草稿');
  await page.getByRole('button', { name: '切换侧边栏视图：助手', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.locator('.tree-row[title^="01-"]').click();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-session').first().click();
  await expect(page.locator('.assistant-panel textarea')).toHaveValue('尚未发送的助手草稿');
  expect(errors).toEqual([]);
});

test('mobile assistant can reopen navigation and return to a document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  await page.getByRole('group', { name: '文档导航', exact: true }).getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-new').click();
  await expect(page.locator('.assistant-panel textarea')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '工作区侧栏', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：助手', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.locator('.tree-row[title^="01-"]').click();
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('module navigation keeps the main content until a sidebar item is opened', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  const nav = page.locator('.sidebar-navigation');
  const editor = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/p\//);
  const original = page.url();
  const messages = nav.getByRole('button', { name: '消息', exact: true });
  if (await messages.count()) {
    await messages.click();
    await expect(page.locator('.chat-sidebar')).toBeVisible();
    await expect(editor).toBeVisible();
    expect(page.url()).toBe(original);
  }
  await selectContext(page, 'home');
  await nav.getByRole('button', { name: '计划', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await page.locator('#sidebar-plan-panel .sidebar-calendar-day').first().click();
  const calendar = page.locator('.calendar-view');
  await expect(calendar).toBeVisible();
  const content = await calendar.textContent();
  const calendarUrl = page.url();
  await selectContext(page, 'workspace');
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '事件与任务', exact: true }).click();
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveText(content);
  if (await messages.count()) {
    await selectContext(page, 'home');
    await messages.click();
    await expect(calendar).toBeVisible();
    await expect(calendar).toHaveText(content);
  }
  expect(page.url()).toBe(calendarUrl);
  // Logged-out previews have no account conversations to open.
  if (await page.locator('.chat-list-item').count()) {
    await page.locator('.chat-list-item').first().click();
    await expect(calendar).toBeHidden();
    const chatUrl = page.url();
    await selectContext(page, 'workspace');
    expect(page.url()).toBe(chatUrl);
    await expect(calendar).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('legacy plugin navigation opens the merged sidebar', async ({ page }) => {
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  await expect(page.locator('.sidebar-view-header')).toBeVisible();
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    localStorage.setItem('tano.preference.navigationContext', JSON.stringify({ version: 1, context: 'workspace', workspaces: { [store.workspace.id]: { module: 'workspace', view: 'plugins' } } }));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '切换侧边栏视图：插件', exact: true })).toBeVisible();
  const sidebar = page.getByRole('region', { name: '插件', exact: true });
  await expect(sidebar.getByRole('searchbox', { name: '搜索插件' })).toBeVisible();
  const header = await page.locator('.sidebar-view-header').boundingBox();
  const search = await sidebar.getByRole('searchbox', { name: '搜索插件' }).boundingBox();
  expect(search.y).toBeGreaterThanOrEqual(header.y + header.height);
  await expect(sidebar.locator('.group').filter({ hasText: '已安装' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '管理插件', exact: true })).toHaveCount(0);
  await sidebar.getByLabel('更多操作', { exact: true }).click();
  const menuRadius = await page.evaluate(() => document.documentElement.hasAttribute('data-shape-theme') ? getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim() : '8px');
  await expect(sidebar.locator('details[open] .dropdown')).toHaveCSS('border-radius', menuRadius);
  await expect(sidebar.locator('.outline-search')).toHaveCSS('border-radius', '6px');
  await expect(sidebar.locator('details[open] .dropdown')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('plugin-explorer-controls.png') });
  await sidebar.getByRole('button', { name: '插件中心…', exact: true }).click();
  await expect(page.locator('.plugin-center:not(.plugin-center-sidebar)')).toBeVisible();
  await page.getByRole('button', { name: '切换侧边栏视图：插件', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: '插件', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);
  await page.keyboard.press('Escape');

});

test('database creation and saved-view entry points are absent', async ({ page }) => {
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  await expect(page.locator('.tree-row').first()).toBeVisible();
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await expect(page.getByRole('menuitemradio', { name: '数据库与视图', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.tree-row').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /新建数据表|数据库视图/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+P');
  const palette = page.getByRole('dialog', { name: '命令中心', exact: true });
  await expect(palette).toBeVisible();
  for (const query of ['新建数据表', '新建配件选择表', '打开视图：']) {
    await palette.getByRole('combobox', { name: '搜索命令' }).fill(query);
    await expect(palette.getByRole('option')).toHaveCount(0);
  }
});

test('existing table files still open from the file tree', async ({ page }) => {
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  await expect(page.locator('.tree-row').first()).toBeVisible();
  const id = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const id = await store.createDataTable();
    const markdownFile = store.workspace.files.find(file => file.path.endsWith('.md'));
    await store.openFile(markdownFile);
    return id;
  });
  await page.locator(`[data-entry-id="${id}"]`).click();
  await expect(page.getByRole('region', { name: '数据表工作区', exact: true })).toBeVisible();
});

test('plugin explorer opens detail pages and restores independent sidebar views', async ({ page }) => {
 test.setTimeout(90000);
 await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
 await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
 await page.getByRole('menuitemradio', { name:'插件', exact:true }).click();
 const explorer = page.locator('.plugin-explorer');
 await expect(explorer.locator('.row')).toHaveCount(2);
 await expect(explorer.locator('nav')).toHaveCount(0);
 await explorer.locator('.main').first().click();
 await expect(page.locator('.plugin-detail-page')).toContainText('系统插件');
 await expect(page).toHaveURL(/plugin/);
 await page.goBack(); await expect(page.locator('.plugin-detail-page')).toHaveCount(0);
 await page.goForward(); await expect(page.locator('.plugin-detail-page')).toContainText('系统插件');
 await page.reload();
 await expect(page.locator('.plugin-detail-page')).toContainText('系统插件');
 await explorer.getByLabel('更多操作', { exact:true }).click();
 await explorer.getByRole('button', { name:'导入插件…', exact:true }).click();
 const { canonical } = await buildPlugin('examples/plugins/kanban');
 await page.getByRole('textbox', { name:'插件 JSON 清单' }).fill(canonical);
 await page.getByRole('button', { name:'检查清单', exact:true }).click();
 await page.getByRole('button', { name:'安装此插件', exact:true }).click();
 await explorer.getByRole('button', { name:/^任务看板 / }).click();
 await page.locator('.plugin-detail-page').getByRole('button', { name:'权限', exact:true }).click();
 await page.getByRole('button', { name:'授权此版本运行', exact:true }).click();
 await page.getByRole('button', { name:/^切换侧边栏视图：/ }).click();
 await page.getByRole('menuitemradio', { name:'任务看板', exact:true }).click();
 await expect(page.getByRole('region', { name:'任务看板 · 任务看板', exact:true })).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button', { name:'切换侧边栏视图：任务看板', exact:true })).toBeVisible();
 await page.evaluate(async () => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace'); await store.updateWorkspaceSettings(store.workspace.id, { key:'showPlugins', value:false, previous:true }); });
 await page.getByRole('button', { name:/^切换侧边栏视图：/ }).click();
 await expect(page.getByRole('menuitemradio', { name:'插件', exact:true })).toHaveCount(0);
 await expect(page.getByRole('menuitemradio', { name:'任务看板', exact:true })).toBeVisible();
 await page.keyboard.press('Escape');
 await page.evaluate(async () => {
 const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
 await store.changePlugin({ uninstall:'kanban' }, store.workspace.id);
 });
 await expect(page.getByRole('button', { name:'切换侧边栏视图：文件', exact:true })).toBeVisible();
 await expect(page.locator('.plugin-detail-page')).toHaveCount(0);
});
