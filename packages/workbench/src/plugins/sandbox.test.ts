import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sandboxBootstrap } from './sandbox';
import { uiSandboxBootstrap, uiSandboxHash, uiInnerBootstrap, uiInnerHash } from './ui-sandbox';

it('keeps the fixed bootstrap authorized by the desktop and frame CSP', () => {
  const hash = `sha256-${createHash('sha256').update(sandboxBootstrap).digest('base64')}`;
  const desktop = JSON.parse(readFileSync(new URL('../../../../apps/client/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  expect(desktop.app.security.csp).toContain(`'${hash}'`);
  const sandbox = readFileSync(new URL('./sandbox.ts', import.meta.url), 'utf8');
  expect(sandbox).toContain(`'${hash}'`);
});

it('authorizes only the fixed UI envelope in desktop CSP', () => {
  const hash = `sha256-${createHash('sha256').update(uiSandboxBootstrap).digest('base64')}`;
  expect(uiSandboxHash).toBe(hash);
  const desktop = JSON.parse(readFileSync(new URL('../../../../apps/client/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  expect(desktop.app.security.csp).toContain(`'${hash}'`);
  expect(uiInnerHash).toBe(`sha256-${createHash('sha256').update(uiInnerBootstrap).digest('base64')}`);
  expect(desktop.app.security.csp).toContain(`'${uiInnerHash}'`);
});
