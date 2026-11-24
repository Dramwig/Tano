import { expect, test } from '@playwright/test';

test('lays out the reasoning choices and keeps them selectable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.locator('.assistant-launcher').first().click();
  await page.waitForFunction(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    return assistant.connection && !assistant.loading;
  });
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    assistant.connection.kind = 'codex-cli';
    assistant.reasoningEffort = 'medium';
  });
  const trigger = page.getByRole('button', { name: '选择推理强度', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: '当前对话的推理强度', exact: true });
  await expect(menu.getByRole('heading', { name: '推理强度' })).toBeVisible();
  const selected = menu.getByRole('radio', { name: '中', exact: true });
  await expect(selected).toBeChecked();
  await expect(selected).toHaveAccessibleDescription('平衡速度与质量');
  await expect(selected.locator('.assistant-menu-check')).toBeVisible();
  await expect(menu.locator('.assistant-reasoning-help')).toHaveCSS('border-top-width', '1px');
  await menu.getByRole('radio', { name: '低', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveText('低');
});

test('opens model connection settings from the model picker', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.locator('.assistant-launcher').first().click();
  await page.waitForFunction(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    return assistant.connection && !assistant.loading && !assistant.modelsLoading;
  });
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    assistant.demo = false;
    assistant.models = ['gpt-5', ...Array.from({ length: 24 }, (_, index) => `gpt-5-${index}-${'long-model-id-'.repeat(10)}`)];
  });

  const panel = page.locator('.assistant-panel');
  await panel.getByRole('button', { name: '选择助手模型', exact: true }).click();
  const picker = panel.locator('#assistant-model-options');
  const currentConnection = picker.getByRole('button', { name: '选择模型连接', exact: true });
  await expect(currentConnection.locator('.connection-avatar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const searchToggle = picker.getByRole('button', { name: '搜索模型列表', exact: true });
  const searchReveal = picker.locator('.assistant-model-search-reveal');
  await expect(searchReveal).toHaveCSS('transition-property', 'grid-template-rows');
  await expect(searchReveal).toHaveCSS('height', '0px');
  const closedHeight = await picker.evaluate(menu => menu.offsetHeight);
  await searchToggle.click();
  await expect(picker.getByRole('textbox', { name: '搜索模型', exact: true })).toBeFocused();
  await expect.poll(() => picker.evaluate(menu => menu.offsetHeight)).toBeGreaterThan(closedHeight);
  await searchToggle.click();
  await expect(searchToggle).toBeFocused();
  await expect(searchReveal).toHaveCSS('height', '0px');
  const modelList = picker.locator('[aria-label="模型列表"]');
  await expect(modelList).toHaveCSS('overflow-x', 'hidden');
  expect(await modelList.evaluate(list => list.scrollHeight > list.clientHeight)).toBe(true);
  expect(await modelList.evaluate(list => getComputedStyle(list, '::-webkit-scrollbar').width)).toBe('6px');
  const scrollbarRightInset = await modelList.evaluate(list => {
    const menu = list.closest('#assistant-model-options');
    return menu.getBoundingClientRect().right - list.getBoundingClientRect().right - parseFloat(getComputedStyle(menu).borderRightWidth);
  });
  expect(Math.abs(scrollbarRightInset)).toBeLessThan(1);
  const model = picker.getByRole('button', { name: '使用模型 gpt-5', exact: true });
  await expect(model.locator('.assistant-model-icon')).toHaveCSS('width', '12px');
  const centerOffset = await model.evaluate(row => {
    const icon = row.querySelector('.assistant-model-icon').getBoundingClientRect();
    const label = row.querySelector('.assistant-menu-label').getBoundingClientRect();
    return Math.abs(icon.top + icon.height / 2 - (label.top + label.height / 2));
  });
  expect(centerOffset).toBeLessThan(1);
  await modelList.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => modelList.evaluate(list => list.scrollTop)).toBeGreaterThan(0);
  await currentConnection.click();
  await expect(picker.locator('.connection-avatar').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await picker.getByRole('button', { name: '返回模型列表', exact: true }).click();
  await picker.getByRole('button', { name: '手动指定对话模型', exact: true }).click();
  const modelId = picker.getByRole('textbox', { name: '当前对话的模型 ID', exact: true });
  await expect(modelId).toBeFocused();
  await expect(modelId).toHaveCSS('outline-style', 'none');
  await picker.getByRole('button', { name: '返回模型列表', exact: true }).click();
  await picker.getByRole('button', { name: '配置模型连接', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '模型连接', exact: true })).toBeVisible();
});

test('opens model connection settings from the missing connection alert', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.locator('.assistant-launcher').first().click();
  await page.waitForFunction(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    return assistant.session && !assistant.loading;
  });
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    assistant.demo = false;
    assistant.connections = [];
  });

  const composer = page.locator('.assistant-composer textarea');
  await composer.fill('总结这篇笔记');
  await composer.press('Enter');
  const alert = page.locator('.assistant-panel').getByRole('alert');
  await expect(alert).toHaveText('请先配置模型连接');
  const configure = alert.getByRole('button', { name: '配置模型连接', exact: true });
  await expect(configure).toHaveText('配置');
  await configure.click();
  await expect(page.getByRole('heading', { name: '模型连接', exact: true })).toBeVisible();
});

for (const locale of ['zh-CN', 'en-US']) test(`keeps waiting work open and reports partial outcomes in ${locale}`, async ({ page }, testInfo) => {
  await page.addInitScript(value => localStorage.setItem('tano.preference.locale', value), locale);
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.locator('.assistant-launcher').first().click();
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    const content = 'The first edit was saved. Waiting for your answer.';
    assistant.session.messages = [{ id: 'partial-run', role: 'assistant', createdAt: 1, state: 'waiting', content,
      activity: [{ kind: 'text', start: 0, end: content.length, phase: 'working' },
        { kind: 'tool', name: 'edit_document', status: 'succeeded', resultIndex: 0 }],
      toolResults: [{ name: 'edit_document', status: 'succeeded', proposalId: 'applied' }],
      proposals: ['applied', 'ready', 'unknown'].map(status => ({ id: status, runId: 'partial-run', workspaceId: assistant.session.workspaceId,
        kind: 'create', path: `${status}.md`, base: '', content: '# Note', reason: 'requested change', status })),
    }];
  });
  const panel = page.locator('.assistant-panel');
  const process = panel.locator('.assistant-process');
  await expect(process).toHaveAttribute('open');
  await expect(process.locator('summary')).toContainText(locale === 'en-US' ? 'Waiting for your answer' : '等待你的回答');
  await expect(panel.locator('.assistant-run-summary')).toHaveCount(0);
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    const reply = assistant.session.messages[0];
    reply.state = 'failed'; reply.termination = { reason: 'round_limit' };
  });
  await expect(process).not.toHaveAttribute('open');
  const summary = panel.locator('.assistant-run-summary');
  await expect(summary).toContainText(locale === 'en-US' ? 'Request round limit reached' : '已达到请求轮数上限');
  await expect(summary).toContainText(locale === 'en-US' ? 'Saved changes' : '已保存的修改');
  await expect(summary.locator('li')).toHaveText(['applied.md', 'ready.md', 'unknown.md']);
  await expect(panel.locator('.assistant-message-assistant > .assistant-answer')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: locale === 'en-US' ? 'Copy assistant answer' : '复制助手回答', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath(`assistant-incomplete-${locale}.png`) });
});

for (const locale of ['zh-CN', 'en-US']) test(`streams and folds assistant tool work in ${locale}`, async ({ page }, testInfo) => {
  await page.addInitScript(value => localStorage.setItem('tano.preference.locale', value), locale);
  await page.goto('http://127.0.0.1:43845');
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor();
  const original = await editor.innerText();
  await page.locator('.assistant-launcher').first().click();
  const panel = page.locator('.assistant-panel');
  await panel.getByRole('button', { name: locale === 'en-US' ? 'Select assistant model' : '选择助手模型', exact: true }).click();
  await panel.locator('.assistant-model-option').filter({ hasText: '简洁模拟' }).click();
  await page.evaluate(() => {
    window.sawAssistantProcessOpen = false;
    new MutationObserver(() => {
      if (document.querySelector('.assistant-process[open]')) window.sawAssistantProcessOpen = true;
    }).observe(document.body, { childList: true, attributes: true, subtree: true });
  });
  await panel.locator('textarea').fill(locale === 'en-US' ? 'Suggest an edit to this note.' : '请提出润色建议。');
  await panel.locator('.assistant-send').click();
  await expect(panel.locator('.assistant-process')).toHaveCount(1);
  await expect(panel.locator('.assistant-stop')).toHaveCount(0);
  const process = panel.locator('.assistant-process');
  expect(await page.evaluate(() => window.sawAssistantProcessOpen)).toBe(true);
  await expect(process).not.toHaveAttribute('open');
  await expect(panel.locator('.assistant-message-assistant > .assistant-answer')).toContainText(locale === 'en-US'
    ? 'The suggestion has not been written' : '建议尚未写入');
  await expect(process.locator('.assistant-answer')).not.toBeVisible();
  await process.locator('summary').click();
  await expect(process.locator('.assistant-answer')).toBeVisible();
  await expect(process.locator('[data-status="succeeded"]')).toHaveCount(1);
  expect(await editor.innerText()).toBe(original);
  await page.screenshot({ path: testInfo.outputPath(`assistant-process-${locale}.png`) });
  await page.reload();
  await page.locator('.assistant-launcher').first().click();
  await expect(page.locator('.assistant-process')).not.toHaveAttribute('open');
  await expect(page.locator('.assistant-message-assistant > .assistant-answer')).toContainText(locale === 'en-US'
    ? 'The suggestion has not been written' : '建议尚未写入');
  await page.screenshot({ path: testInfo.outputPath(`assistant-summary-${locale}.png`) });
});
