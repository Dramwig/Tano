import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './scripts', testMatch: '*-browser.spec.mjs', workers: 1, timeout: 45000,
  use: { headless: true, channel: !process.env.CI && process.platform === 'win32' ? 'msedge' : undefined, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -w @tano/client -- --host 127.0.0.1 --port 43845', url: 'http://127.0.0.1:43845', reuseExistingServer: !process.env.CI },
});
