import { expect, test } from '@playwright/test';

const selected = '用于测试普通相对链接与 Wiki 链接。';
const markdown = `# 目标文档\n\n前一段保持不变。\n\n${selected}\n\n后一段也保持不变。\n`;

async function prepareSelection(page, locale = 'zh-CN', sourceMode = false) {
  await page.addInitScript(value => localStorage.setItem('tano.preference.locale', value), locale);
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('assistant')?.connections.length);
  await page.evaluate(async markdown => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    await pinia._s.get('workspace').create('inline-context.md', false, markdown);
    await pinia._s.get('assistant').selectModel('简洁模拟');
  }, markdown);
  await expect(page.locator('.milkdown-host .ProseMirror').first()).toContainText(selected);
  if (sourceMode) await page.getByRole('button', { name: locale === 'en-US' ? 'Toggle source mode' : '切换源码模式', exact: true }).click();
  const editor = page.locator(sourceMode ? '.source-editor' : '.milkdown-host').first();
  await expect(editor).toBeVisible();
  await editor.evaluate((element, range) => {
    let component = element.__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    component.exposed.restoreModeSelection(range);
  }, { anchor: markdown.indexOf(selected), head: markdown.indexOf(selected) + selected.length });
  await expect.poll(() => editor.evaluate(element => {
    let component = element.__vueParentComponent;
    while (!component.exposed?.assistantSelection) component = component.parent;
    return component.exposed.assistantSelection()?.spans.map(span => span.text).join('\n');
  })).toBe(selected);
}

async function startInline(page, locale = 'zh-CN') {
  await prepareSelection(page, locale);
  await page.locator('.selection-toolbar').getByRole('button', { name: locale === 'en-US' ? 'Open Tano Assistant' : '打开 Tano 助手', exact: true }).click();
  const inline = page.locator('.inline-assistant');
  await expect(inline.locator('input')).toBeVisible();
  await inline.locator('input').fill(locale === 'en-US' ? 'Explain this sentence.' : '解释这句话。');
  await inline.locator('.inline-assistant-send').click();
  await expect(inline.locator('.inline-assistant-conversation')).toBeVisible();
  // This is the real inline -> panel action, after the editor has lost focus.
  await inline.locator('.inline-assistant-conversation').click();
  await expect(page.locator('.assistant-panel .assistant-selection')).toContainText(selected);
}

for (const locale of ['zh-CN', 'en-US']) test(`keeps the inline selection for a follow-up in ${locale}`, async ({ page }, testInfo) => {
  await startInline(page, locale);
  const panel = page.locator('.assistant-panel');
  await panel.locator('textarea').fill(locale === 'en-US' ? 'Edit this in English.' : '改为英文');
  await panel.locator('.assistant-send').click();
  await expect(panel.locator('.assistant-message-assistant')).toHaveCount(2);
  await expect(panel.locator('.assistant-stop')).toHaveCount(0);
  const result = await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const assistant = pinia._s.get('assistant');
    const reply = assistant.session.messages.at(-1);
    return { selection: reply.sources[0].selection, state: reply.state, proposal: reply.proposals[0], document: pinia._s.get('workspace').active.content };
  });
  expect(result.selection).toEqual({ text: selected, from: markdown.indexOf(selected), to: markdown.indexOf(selected) + selected.length });
  expect(result.state).toBe('completed');
  expect(result.proposal.status).toBe('applied');
  expect(result.document.startsWith(markdown.slice(0, markdown.indexOf(selected)) + selected)).toBe(true);
  expect(result.document.endsWith(markdown.slice(markdown.indexOf(selected) + selected.length))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`inline-follow-up-${locale}.png`) });
});

for (const locale of ['zh-CN', 'en-US']) for (const sourceMode of [false, true])
  test(`attaches the selected sentence from the butterfly launcher (${locale}, source=${sourceMode})`, async ({ page }, testInfo) => {
    await prepareSelection(page, locale, sourceMode);
    await page.locator('.assistant-launcher').click();
    const panel = page.locator('.assistant-panel');
    await expect(panel.locator('.assistant-selection')).toContainText(selected);
    await expect(panel.locator('.assistant-contexts > .assistant-context')).toHaveCount(1);
    await expect(panel.locator('.assistant-selection')).toHaveAttribute('title', `inline-context.md\n${selected}`);
    await expect(page.locator('.inline-assistant')).toHaveCount(0);
    await expect(panel.locator('textarea')).toBeFocused();
    await panel.locator('textarea').fill(locale === 'en-US' ? 'Explain this sentence.' : '解释这句话。');
    await page.screenshot({ path: testInfo.outputPath(`launcher-quote-${locale}-${sourceMode ? 'source' : 'rich'}.png`) });
    await panel.locator('.assistant-send').click();
    await expect(panel.locator('.assistant-message-assistant')).toHaveCount(1);
    await expect(panel.locator('.assistant-stop')).toHaveCount(0);
    const sentQuote = panel.locator('.assistant-message-user').first().locator('.assistant-sent-selection');
    await expect(sentQuote).toHaveText(selected);
    await expect(panel.locator('.assistant-message-user').first().locator('.assistant-attachments button')).toHaveCount(1);
    await expect(sentQuote).toHaveAttribute('data-tooltip', `inline-context.md\n${selected}`);
    await page.screenshot({ path: testInfo.outputPath(`sent-quote-${locale}-${sourceMode ? 'source' : 'rich'}.png`) });
    // Navigate away first: the target editor may need to mount before revealing the quote.
    await page.evaluate(async () => {
      const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await workspace.create('jump-away.md', false, '# Another document\n');
    });
    if (locale === 'en-US') await page.emulateMedia({ reducedMotion: 'reduce' });
    const tabIds = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').tabs.map(tab => tab.id));
    const tabsBeforeJump = await tabIds();
    await sentQuote.click();
    const flash = page.locator('.tano-reference-flash');
    await expect(flash).toHaveText(selected);
    await expect(flash).toBeInViewport();
    expect(await tabIds()).toEqual(tabsBeforeJump);
    await expect(flash).toHaveCSS('animation-name', locale === 'en-US' ? 'none' : 'tano-reference-pulse');
    await page.screenshot({ path: testInfo.outputPath(`quote-jump-${locale}-${sourceMode ? 'source' : 'rich'}.png`) });
    await sentQuote.click();
    await expect(flash).toHaveText(selected);
    expect(await tabIds()).toEqual(tabsBeforeJump);
    await expect(flash).toHaveCount(0, { timeout: 5000 });
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toBe(markdown);
    const snapshot = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant').session.messages.at(-1).sources[0]);
    expect((await snapshot()).selection).toEqual({ text: selected, from: markdown.indexOf(selected), to: markdown.indexOf(selected) + selected.length });
    await panel.locator('.assistant-selection button').click();
    await expect(panel.locator('.assistant-selection')).toHaveCount(0);
    await expect(panel.locator('.assistant-contexts > .assistant-context')).toHaveCount(1);
    await expect(panel.locator('.assistant-contexts > .assistant-context')).toContainText('inline-context.md');
    await expect(sentQuote).toHaveText(selected);
    await panel.locator('textarea').fill(locale === 'en-US' ? 'Summarize the document.' : '总结全文。');
    await panel.locator('.assistant-send').click();
    await expect(panel.locator('.assistant-message-assistant')).toHaveCount(2);
    await expect(panel.locator('.assistant-stop')).toHaveCount(0);
    expect((await snapshot()).selection).toBeUndefined();
    await expect(panel.locator('.assistant-message-user').nth(1).locator('.assistant-sent-selection')).toHaveCount(0);
    await expect(sentQuote).toHaveText(selected);
  });

test('reuses the current duplicate tab and replaces the current page when the quoted document is closed', async ({ page }) => {
  await startInline(page);
  const quote = page.locator('.assistant-sent-selection').first();
  const alias = await page.evaluate(async () => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const file = workspace.workspace.files.find(file => file.id === workspace.active.id);
    await workspace.openFileInNewTab(file);
    return { activeId: workspace.activeId, tabs: workspace.tabs.map(tab => tab.id) };
  });
  await quote.click();
  await expect(page.locator('.tano-reference-flash')).toHaveText(selected);
  expect(await page.evaluate(() => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    return { activeId: workspace.activeId, tabs: workspace.tabs.map(tab => tab.id) };
  })).toEqual(alias);
  const before = await page.evaluate(async () => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const targetId = workspace.active.id;
    await workspace.create('replacement-page.md', false, '# Replacement page\n');
    for (const tab of [...workspace.tabs]) if (tab.document?.id === targetId) await workspace.close(tab.id);
    return { count: workspace.tabs.length, targetId, previousId: workspace.activeId };
  });
  await quote.click();
  await expect(page.locator('.tano-reference-flash')).toHaveText(selected);
  expect(await page.evaluate(() => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    return { count: workspace.tabs.length, targetId: workspace.active.id, tabIds: workspace.tabs.map(tab => tab.id) };
  })).toEqual({ count: before.count, targetId: before.targetId, tabIds: expect.not.arrayContaining([before.previousId]) });
});

test('keeps stale inline context scoped and stops instead of editing another sentence', async ({ page }) => {
  await startInline(page);
  await page.evaluate(() => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    workspace.active.content = workspace.active.content.replace('用于测试普通相对链接与 Wiki 链接。', '这句话已被另一个编辑操作修改。');
  });
  const panel = page.locator('.assistant-panel');
  await panel.locator('textarea').fill('改为英文');
  await panel.locator('.assistant-send').click();
  await expect(panel).toContainText('选区内容已变化，请重新选择后发送');
  await expect(panel.locator('.assistant-message-assistant')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content))
    .toBe(markdown.replace(selected, '这句话已被另一个编辑操作修改。'));
});
