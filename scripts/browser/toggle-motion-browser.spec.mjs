import { test, expect } from '@playwright/test';

test('toggle blocks animate both directions and reverse without losing content', async ({ page }) => {
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('toggle-motion.md', false, '<details>\n<summary>Toggle</summary>\n\nBody paragraph\n\n- One\n- Two\n\n</details>\n\nFollowing paragraph\n');
  });
  const block = page.locator('.tano-toggle');
  await expect(block).toBeVisible();
  const content = block.locator(':scope > .tano-enhanced-content');
  const trigger = block.locator('.tano-toggle-trigger');
  const full = await content.evaluate(el => el.getBoundingClientRect().height);
  expect(full).toBeGreaterThan(30);
  for (const expanded of [false, true]) {
    const { heights, angles } = await block.evaluate(async el => {
      const content = el.querySelector('.tano-enhanced-content');
      const icon = el.querySelector('.tano-toggle-icon');
      el.querySelector('.tano-toggle-trigger').click();
      const heights = [], angles = [], start = performance.now();
      while (performance.now() - start < 800) {
        await new Promise(requestAnimationFrame);
        heights.push(content.getBoundingClientRect().height);
        angles.push(parseFloat(getComputedStyle(icon).rotate));
      }
      return { heights, angles };
    });
    expect(heights.some(height => height > 1 && height < full - 1)).toBe(true);
    expect(angles.some(angle => angle > 1 && angle < 89)).toBe(true);
    expect(angles.at(-1)).toBe(expanded ? 90 : 0);
    await expect(trigger).toHaveAttribute('aria-expanded', String(expanded));
    expect(Math.abs(heights.at(-1) - (expanded ? full : 0))).toBeLessThan(1);
  }
  await block.evaluate(async el => {
    const trigger = el.querySelector('.tano-toggle-trigger');
    trigger.click();
    await new Promise(resolve => setTimeout(resolve, 70));
    trigger.click();
  });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => content.evaluate(el => el.getBoundingClientRect().height)).toBe(full);
  await expect(content).toContainText('Body paragraph');
});
