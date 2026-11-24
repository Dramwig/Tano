import { expect, test } from '@playwright/test';

test('source continuation, empty item exit, fences and automatic pairs', async ({page}) => {
 await page.addInitScript(() => { localStorage.setItem('tano.preference.locale','zh-CN'); localStorage.setItem('tano.preference.markdownAutocomplete', JSON.stringify({listContinuation:true,fenceClosing:true,bracketPairs:true})); });
 await page.goto('http://127.0.0.1:43845');
 await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
 await page.evaluate(async () => { const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace'); await store.create('autocomplete.md',false,'- item'); });
 await page.getByRole('button',{name:'切换源码模式',exact:true}).click();
 const editor=page.locator('.cm-content').first();
 await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
 await expect(editor).toHaveText('- item- ');
 await page.keyboard.press('Enter');
 await page.keyboard.type('```ts'); await page.keyboard.press('Enter');
 await expect(editor).toContainText('```ts');
 await page.keyboard.press('Control+End'); await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Control+a'); await page.keyboard.insertText('plain ');
 await page.keyboard.type('(');
 await expect(editor).toContainText('plain ()');
 await page.keyboard.press('Backspace'); await expect(editor).toHaveText('plain ');
 await page.keyboard.type('()'); await expect(editor).toHaveText('plain ()');
});
