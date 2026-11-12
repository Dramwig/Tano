import { expect, test } from '@playwright/test';

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
