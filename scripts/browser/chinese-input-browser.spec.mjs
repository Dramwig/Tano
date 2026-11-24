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
async function create(page, name, content = '输入：\n') {
  await page.evaluate(async ({ name, content }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create(name, false, content);
  }, { name, content });
}

for (const source of [false, true]) test(`writes input spacing to Markdown (${source ? 'source' : 'visual'})`, async ({ page }) => {
  await open(page);
  await settings(page);
  const spacing = page.getByRole('switch', { name: '输入时自动补空格' });
  await expect(spacing).toHaveAttribute('aria-checked', 'false');
  await spacing.click();
  await page.reload();
  await settings(page);
  await expect(spacing).toHaveAttribute('aria-checked', 'true');
  await page.locator('.settings-close').click();
  await create(page, `补空格-${source}.md`, '保留A1\n\n中文\n');
  if (source) await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const editor = page.locator(source ? '.cm-content' : '.ProseMirror').first();
  await editor.getByText('中文', { exact: true }).click();
  await page.keyboard.press('End');
  // Type between two Han characters. The next key must precede the trailing space.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('Tano2026');
  await expect(editor).toContainText('中 Tano2026 文');
  await page.keyboard.press('Control+z');
  await expect(editor).toContainText('中文');
  await page.keyboard.press('End');
  await page.keyboard.type('$x+1$');
  await expect(editor).toContainText(source ? '中文 $x+1$' : '中文 ');
  await page.keyboard.press('End');
  await page.keyboard.insertText('公式');
  await page.keyboard.press('End');
  await page.keyboard.type('[[页面A]]');
  await page.keyboard.press('End');
  await page.keyboard.insertText('完成');
  await page.keyboard.type('ABC');
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.keyboard.insertText('中文');
  await expect(editor).toContainText('ABC中文');
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
  await expect(editor).toContainText('ABC 中文');
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '原样V2');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor).toContainText('中文原样V2');
  await expect(editor).toContainText('保留A1');
  if (!source) await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  await expect(page.locator('.cm-content').first()).toContainText('中文 $x+1$ 公式 [[页面A]] 完成 ABC 中文原样V2');
});

test('Chinese input settings are separate, off by default, searchable and saved', async ({ page }, testInfo) => {
  await open(page);
  // A section has an accessible region role when it has an accessible name.
  const section = await settings(page);
  await expect(section.getByRole('switch')).toHaveCount(14);
  for (const control of await section.getByRole('switch').all()) await expect(control).toHaveAttribute('aria-checked', /行首|双链|块菜单/.test(await control.getAttribute('aria-label')) ? 'true' : 'false');
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
  for (const control of await section.getByRole('switch').all()) if (await control.getAttribute('aria-checked') === 'false') await control.click();
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
  for (const control of await section.getByRole('switch').all()) if (await control.getAttribute('aria-checked') === 'false') await control.click();
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

for (const source of [false,true]) test(`recognizes Chinese Markdown positions (${source ? 'source' : 'visual'})`, async ({page}) => {
 await open(page); await create(page,`syntax-${source}.md`);
 if (source) await page.getByRole('button',{name:'切换源码模式',exact:true}).click();
 const editor=page.locator(source?'.cm-content':'.ProseMirror').first();
 await editor.click(); await page.keyboard.press('Control+a');
 await page.keyboard.insertText('》'); await page.keyboard.press('Space');
 if (source) { await expect(editor).toHaveText('> '); await page.keyboard.press('Control+z'); await expect(editor).toHaveText('》 '); }
 else { await expect(editor.locator('blockquote')).toHaveCount(1); await page.keyboard.press('Control+z'); await expect(editor).toContainText('》'); }
});

for (const source of [false,true]) for (const [input, selector, output] of [
 ['1。 ', 'ol', '1. '], ['···ts\n', 'pre', '```ts'], ['【【页面】】', '[data-wiki-link]', '[[页面]]'],
]) test(`Chinese syntax ${input} (${source?'source':'visual'})`, async ({page}) => {
 await open(page); await create(page,`syntax-${source}-${input.length}.md`);
 if(source) await page.getByRole('button',{name:'切换源码模式',exact:true}).click();
 const editor=page.locator(source?'.cm-content':'.ProseMirror').first();
 await editor.click(); await page.keyboard.press('Control+a');
 for(const ch of input) { if(ch==='\n') await page.keyboard.press('Enter'); else if(ch===' ') await page.keyboard.press('Space'); else await page.keyboard.insertText(ch); }
 if(source) await expect(editor).toContainText(output);
 else if(selector==='[data-wiki-link]') await expect(editor).not.toContainText(/[【】]/);
 else await expect(editor.locator(selector)).toHaveCount(1);
});

test('Chinese slash opens block menu and highlight stays literal while typing', async ({page}) => {
 await open(page); await create(page,'syntax-slash.md','');
 const editor=page.locator('.ProseMirror').first();
 await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.keyboard.insertText('、');
 await expect(page.locator('.tano-slash-menu')).toBeVisible();
 await page.keyboard.press('Escape'); await editor.click(); await page.keyboard.press('Control+a');
 await page.keyboard.type('==highlight==');
 await expect(editor).toContainText('==highlight==');
 await expect(editor.locator('mark')).toHaveCount(0);
});

for(const source of [false,true]) test(`committed IME syntax (${source?'source':'visual'})`,async({page})=>{
 await open(page); await create(page,`ime-syntax-${source}.md`,'');
 if(source) await page.getByRole('button',{name:'切换源码模式',exact:true}).click();
 const editor=page.locator(source?'.cm-content':'.ProseMirror').first(); await editor.click(); await page.keyboard.press('Control+a');
 await editor.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));
 await page.keyboard.insertText('···');
 await editor.evaluate(async el=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'···'})); await new Promise(resolve=>queueMicrotask(()=>queueMicrotask(resolve)));});
 if(source) await expect(editor).toHaveText('```'); else { await expect(editor).toContainText('```'); await page.keyboard.press('Enter'); await expect(editor.locator('pre')).toHaveCount(1); }
});
