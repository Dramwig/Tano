/** Reused unchanged by the browser demo and the production WebView2/native adapter. */
export async function acceptTaskInsights(page, expect, canonical, screenshotPath) {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    for (let i = 0; i < 111; i++) await store.createObject({ type: 'event', name: `统计验收 ${String(i).padStart(3, '0')}`, description: '', archived: i >= 108,
      properties: { checkable: true, completed: i % 3 === 2, kanbanLane: i % 3 === 1 ? 'doing' : 'todo' } });
    await store.createObject({ type: 'event', name: '统计验收 普通事件', description: '', archived: false, properties: { checkable: false } });
  });
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: /命令中心/ }).click();
  await page.getByRole('combobox', { name: '搜索命令' }).fill('打开插件中心');
  await page.getByRole('option').filter({ hasText: '打开插件中心' }).click();
  await page.getByRole('button', { name: '导入插件', exact: true }).click();
  await page.getByRole('textbox', { name: '插件 JSON 清单' }).fill(canonical);
  await page.getByRole('button', { name: '检查清单' }).click();
  await page.getByRole('button', { name: '安装此插件', exact: true }).click();
  await page.getByRole('button', { name: '查看任务统计详情', exact: true }).click();
  await page.getByRole('button', { name: '授权此版本运行', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === 'task-insights')?.status), { timeout: 30000 }).toBe('running');
  await page.getByRole('button', { name: /^切换侧边栏视图：/ }).click();
  await page.getByRole('menuitemradio', { name: '插件工作台', exact: true }).click();
  await page.getByRole('navigation', { name: '插件视图' }).getByRole('button', { name: /^任务统计/ }).click();
  const surface = page.getByRole('region', { name: '任务统计 · 任务统计', exact: true });
  const ui = surface.frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
  await expect(ui.getByRole('heading', { name: '任务统计', exact: true })).toHaveCSS('font-size', '28px');
  await ui.getByRole('textbox', { name: '搜索任务', exact: true }).fill('统计验收');
  await ui.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(ui.getByRole('status')).toHaveText('已统计 108 项任务，匹配 108 项', { timeout: 15000 });
  await expect(ui.getByRole('img')).toHaveAttribute('aria-label', '任务状态分布：待办 36 项，进行中 36 项，已完成 36 项');
  await expect(ui.getByRole('row')).toHaveCount(61); // Header plus 20 previews for each state.
  expect(await ui.locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++;
    return colored;
  })).toBeGreaterThan(5000);
  // The chart library's pointer interaction must reach React, not just paint pixels.
  const bounds = await ui.locator('canvas').boundingBox();
  await ui.locator('canvas').click({ position: { x: bounds.width * .52, y: bounds.height * .55 } });
  await expect(ui.getByRole('button', { name: /^进行中\s*36$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(ui.getByRole('row')).toHaveCount(21);
  await ui.getByRole('button', { name: /^已完成\s*36$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(ui.getByRole('button', { name: /^已完成\s*36$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const record = store.objects.find(row => row.object.name === '统计验收 000');
    await store.updateObject(record, { ...record.object, properties: { ...record.object.properties, completed: true } }, store.workspace.id);
    await store.createObject({ type: 'event', name: '统计验收 新任务', description: '', archived: false, properties: { checkable: true, completed: false } });
  });
  await expect(ui.getByRole('status')).toHaveText('已统计 109 项任务，匹配 109 项', { timeout: 15000 });
  await expect(ui.getByRole('img')).toHaveAttribute('aria-label', '任务状态分布：待办 36 项，进行中 36 项，已完成 37 项');
  await ui.getByRole('checkbox', { name: '包含归档任务' }).check();
  await ui.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(ui.getByRole('status')).toHaveText('已统计 112 项任务，匹配 112 项');
  await ui.getByRole('button', { name: '显示全部状态', exact: true }).click();
  await ui.locator('main').evaluate(node => node.ownerDocument.defaultView.scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const previousFrame = await (await ui.locator('main').elementHandle()).ownerFrame();
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').close('plugin:task-insights:dashboard'));
  await expect.poll(() => previousFrame.isDetached()).toBe(true);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').openPluginView('task-insights', 'dashboard'));
  await expect(ui.getByRole('status')).toHaveText('已统计 112 项任务，匹配 112 项');
  await expect(ui.getByRole('textbox', { name: '搜索任务', exact: true })).toHaveValue('统计验收');
  await expect(ui.getByRole('checkbox', { name: '包含归档任务' })).toBeChecked();
  await ui.getByRole('textbox', { name: '搜索任务', exact: true }).fill('没有匹配的任务');
  await ui.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(ui.getByText('没有符合条件的任务。', { exact: true })).toBeVisible();
  await expect(ui.getByRole('img')).toHaveAttribute('aria-label', '任务状态分布：待办 0 项，进行中 0 项，已完成 0 项');
  const runtime = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.find(row => row.id === 'task-insights'));
  expect(runtime.status).toBe('running');
  expect(runtime.logs.filter(row => row.level === 'error')).toEqual([]);
  await page.getByRole('region', { name: '插件工作台', exact: true }).getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByRole('button', { name: /^已安装/ }).click();
  await page.getByRole('button', { name: '查看任务统计详情', exact: true }).click();
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  await expect(page.getByRole('tab', { name: /任务统计/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').pluginRuntime.some(row => row.id === 'task-insights' && row.status === 'running'))).toBe(false);
}
