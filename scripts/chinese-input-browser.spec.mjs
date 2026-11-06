import { expect, test } from '@playwright/test';

async function open(page) {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.addInitScript(() => {
    if (window.top === window) localStorage.setItem('tano.preference.locale', 'zh-CN');
  });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
}
async function settings(page) {
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-nav').getByRole('button', { name: '编辑器', exact: true }).click();
  return page.getByRole('region', { name: '中文输入优化', exact: true });
}
async function create(page, name) {
  await page.evaluate(async name => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create(name, false, '输入：\n');
  }, name);
}

test('Chinese input settings are separate, off by default, searchable and saved', async ({ page }, testInfo) => {
  await open(page);
  // A section has an accessible region role when it has an accessible name.
  const section = await settings(page);
  await expect(section.getByRole('switch')).toHaveCount(8);
  for (const control of await section.getByRole('switch').all()) await expect(control).toHaveAttribute('aria-checked', 'false');
  await section.getByRole('switch', { name: '中文圆括号', exact: true }).click();
  await section.getByRole('switch', { name: '中文感叹号', exact: true }).click();
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: testInfo.outputPath('chinese-input-settings.png') });
  await page.reload();
  await settings(page);
  await expect(section.getByRole('switch', { name: '中文圆括号', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('switch', { name: '中文感叹号', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('switch', { name: '中文逗号', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('searchbox', { name: '搜索设置' }).fill('中文省略号');
  await expect(page.locator('.settings-nav-setting-results')).toContainText('中文省略号映射为 ^');
});

for (const source of [false, true]) test(`maps typing and committed IME input, preserving paste (${source ? 'source' : 'visual'})`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const section = await settings(page);
  for (const control of await section.getByRole('switch').all()) await control.click();
  await page.locator('.settings-close').click();
  await create(page, `中文输入-${source}.md`);
  if (source) await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const editor = page.locator(source ? '.cm-content' : '.ProseMirror').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('【】（）；，。！……￥');
  await expect(editor).toContainText('输入：[]();,.!^$');
  // WebView2 + Microsoft Pinyin can hide the physical key and submit noncancelable
  // composition text. This path cannot rely on keydown/beforeinput interception.
  await editor.evaluate(element => {
    const key = new KeyboardEvent('keydown', { key: 'Process', code: '', keyCode: 229, bubbles: true, cancelable: true });
    element.dispatchEvent(key);
    if (key.defaultPrevented) throw new Error('Unknown IME key must remain available to Pinyin');
  });
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
  await editor.evaluate(element => {
    const event = new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '……', isComposing: true, bubbles: true, cancelable: false });
    element.dispatchEvent(event);
    if (event.defaultPrevented) throw new Error('Composition update must not be canceled');
  });
  await page.keyboard.insertText('……');
  await expect(editor).toContainText('!^$……');
  const committed = await editor.evaluate(async element => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '……' }));
    await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));
    return element.textContent;
  });
  expect(committed).toContain('!^$^'); // Must already be mapped without yielding to a timer/paint.
  await expect(editor).toContainText('!^$^');
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '【，。】');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor).toContainText('【，。】');
  expect(errors).toEqual([]);
});

for (const source of [false, true]) test(`inserts mapped punctuation without Chinese DOM mutations (${source ? 'source' : 'visual'})`, async ({ page }) => {
  await open(page);
  const section = await settings(page);
  for (const control of await section.getByRole('switch').all()) await control.click();
  await page.locator('.settings-close').click();
  await create(page, `提前映射-${source}.md`);
  if (source) await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const editor = page.locator(source ? '.cm-content' : '.ProseMirror').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await editor.evaluate(element => {
    window.chineseInputMutations = [];
    window.chineseInputObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.oldValue) window.chineseInputMutations.push(record.oldValue);
        for (const node of record.addedNodes) window.chineseInputMutations.push(node.textContent ?? '');
      }
      window.chineseInputMutations.push(element.textContent ?? '');
    });
    window.chineseInputObserver.observe(element, { characterData: true, characterDataOldValue: true, childList: true, subtree: true });
  });
  // Exercise a real, cancelable beforeinput, including target ranges from the browser.
  await page.keyboard.insertText('【】（）；，。！……￥');
  await expect(editor).toContainText('输入：[]();,.!^$');
  const canceled = await editor.evaluate(element => [
    ['BracketLeft', '【'], ['BracketRight', '】'], ['Digit9', '（'], ['Digit0', '）'],
    ['Semicolon', '；'], ['Comma', '，'], ['Period', '。'], ['Digit1', '！'], ['Digit6', '……'], ['Digit4', '￥'],
  ].map(([code, key]) => !element.dispatchEvent(new KeyboardEvent('keydown', {
    key, code, bubbles: true, cancelable: true,
  }))));
  expect(canceled).toEqual(Array(10).fill(true));
  await expect(editor).toContainText('输入：[]();,.!^$[]();,.!^$');
  const mutations = await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    window.chineseInputObserver.disconnect();
    return window.chineseInputMutations;
  });
  expect(mutations.length).toBeGreaterThan(0);
  expect(mutations.filter(value => /[【】（）；，。！…￥]/.test(value))).toEqual([]);
});

for (const source of [false, true]) test(`handles a Pinyin key and its committed composition exactly once (${source ? 'source' : 'visual'})`, async ({ page }) => {
  await open(page);
  const section = await settings(page);
  await section.getByRole('switch', { name: '中文方括号', exact: true }).click();
  await section.getByRole('switch', { name: '中文省略号映射为 ^', exact: true }).click();
  await page.locator('.settings-close').click();
  await create(page, `拼音单次输入-${source}.md`);
  if (source) await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const editor = page.locator(source ? '.cm-content' : '.ProseMirror').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  let expected = '输入：';
  for (const [code, text, output, shiftKey] of [
    ['BracketLeft', '【', '[', false], ['BracketLeft', '【', '[', false],
    ['BracketRight', '】', ']', false], ['Digit6', '……', '^', true],
  ]) {
    // Pinyin may still commit its composition after a Process key was canceled.
    // Deliver both parts of one physical press; do not assume preventDefault stopped the IME.
    await editor.evaluate((element, key) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { ...key, key: 'Process', keyCode: 229, bubbles: true, cancelable: true }));
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    }, { code, shiftKey });
    await page.keyboard.insertText(text);
    const committed = await editor.evaluate(async (element, data) => {
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data }));
      await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));
      return element.textContent;
    }, text);
    expected += output;
    expect(committed).toBe(expected);
    await editor.evaluate((element, code) => element.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Process', code, keyCode: 229, bubbles: true, cancelable: true,
    })), code);
  }
});
