import { test, expect } from '@playwright/test';

for (const body of ['\n# Body\n\nText\n', '']) {
  test(`opening unsupported first block has no automatic block highlight (${body ? 'with text' : 'only block'})`, async ({ page }) => {
    await page.goto('http://127.0.0.1:43845');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
    const markdown = '+++\ntitle = "TOML"\n+++\n' + body;
    await page.evaluate(async markdown => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create('raw-start.md', false, markdown);
    }, markdown);
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('.tano-unsupported-block')).toBeVisible();
    await expect(editor.locator('.ProseMirror-selectednode, .tano-block-selected')).toHaveCount(0);
    const current = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
    expect(await current()).toBe(markdown);
    await editor.locator('.tano-unsupported-block').hover();
    await page.locator('.tano-block-handle').first().click();
    await expect(editor.locator('.tano-unsupported-block.ProseMirror-selectednode')).toBeVisible();
    expect(await current()).toBe(markdown);
  });
}
