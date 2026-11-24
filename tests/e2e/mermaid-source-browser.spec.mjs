import { expect, test } from '@playwright/test';

const diagram = [
  'sequenceDiagram',
  '  participant U as 你',
  '  participant C as Codex 程序',
  '  participant M as 模型',
  '  participant T as 读取工具',
  '  U->>C: 读取 README 并总结',
  '  C->>M: 第 1 次请求：问题、历史、可用工具',
  '  M-->>C: 请求调用读取工具',
  '  C->>T: 执行读取',
  '  T-->>C: README 内容',
  '  C->>M: 第 2 次请求：加入工具结果',
  '  M-->>C: 项目启动说明',
  '  C-->>U: 显示回答，本次处理结束',
].join('\n');
const markdown = `## 跟一个完整例子\n\n正文：读取 README，告诉我项目怎么启动。\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n关键点：工具结果进入历史。\n\n后续正文。\n`;

test('leaving Mermaid source restores the complete diagram in one frame', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem('tano.preference.locale', 'zh-CN');
    window.visibleMermaidMeasurements = [];
    new MutationObserver(() => {
      for (const svg of document.querySelectorAll('body svg[id^="tano-diagram-"]')) {
        if (!svg.closest('#app') && getComputedStyle(svg).visibility !== 'hidden')
          window.visibleMermaidMeasurements.push(svg.id);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(process.env.TANO_MERMAID_TEST_URL || 'http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async content => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('Mermaid 切换验证.md', false, content);
  }, markdown);
  const prose = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  const preview = prose.locator('.tano-mermaid-preview');
  await expect(preview.locator('svg')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const initialHeight = await preview.evaluate(element => element.parentElement.getBoundingClientRect().height);
  expect(initialHeight).toBeGreaterThan(250);
  await page.screenshot({ path: testInfo.outputPath('mermaid-preview.png') });

  for (let iteration = 0; iteration < 4; iteration++) {
    await preview.click();
    const source = prose.locator('pre[data-tano-live-source]');
    await expect(source.locator('code')).toHaveText(`\`\`\`mermaid\n${diagram}\n\`\`\``);
    if (!iteration) await page.screenshot({ path: testInfo.outputPath('mermaid-source.png') });
    await page.evaluate(() => {
      window.mermaidFrames = [];
      const sample = () => {
        const block = document.querySelector('.ProseMirror .tano-mermaid');
        if (block) window.mermaidFrames.push({
          svg: !!block.querySelector('.tano-mermaid-preview svg'),
          height: block.getBoundingClientRect().height,
          afterTop: block.nextElementSibling?.getBoundingClientRect().top,
        });
        window.mermaidFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    await prose.locator('p').filter({ hasText: '关键点：' }).click();
    await expect(source).toHaveCount(0);
    const frames = await page.evaluate(async () => {
      for (let frame = 0; frame < 12; frame++) await new Promise(requestAnimationFrame);
      cancelAnimationFrame(window.mermaidFrame);
      return window.mermaidFrames;
    });
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every(frame => frame.svg)).toBe(true);
    expect(frames.every(frame => Math.abs(frame.height - initialHeight) < 1)).toBe(true);
    expect(Math.max(...frames.map(frame => frame.afterTop)) - Math.min(...frames.map(frame => frame.afterTop))).toBeLessThan(1);
  }
  expect(await page.evaluate(() => window.visibleMermaidMeasurements)).toEqual([]);
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toBe(markdown);
  await page.screenshot({ path: testInfo.outputPath('mermaid-restored.png') });
  expect(errors).toEqual([]);
});
