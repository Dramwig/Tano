// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHelpEditQueue } from './help-edit-queue';
import { readHelpCompleted } from './help-checklist';
import * as links from '@tano/editor/document-links';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('defers parsing, preserves transient formatting and cancels disposed work', async () => {
  vi.useFakeTimers();
  const queue = createHelpEditQueue();
  const parse = vi.spyOn(links, 'parseDocumentMarkdown');
  queue.record('a', '文本', '**文本**', []);
  queue.record('a', '**文本**', '文本', []);
  expect(parse).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(64);
  expect(readHelpCompleted()).toContain('bold');
  queue.record('a', '文本', '# 新标题', []);
  queue.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(readHelpCompleted()).not.toContain('heading');
});

it('uses an idle callback with a deadline and retains the accepted reference context', () => {
  const callbacks: (() => void)[] = [];
  const idle = vi.fn((run: () => void) => { callbacks.push(run); return callbacks.length; });
  const cancel = vi.fn();
  vi.stubGlobal('requestIdleCallback', idle); vi.stubGlobal('cancelIdleCallback', cancel);
  const queue = createHelpEditQueue();
  queue.record('a', '文字', '文字\n\n[[目标]]', [
    { type: 'document', id: 'a', workspace: 'test', path: '正文.md', name: '正文' },
    { type: 'document', id: 'b', workspace: 'test', path: '目标.md', name: '目标' },
  ]);
  expect(readHelpCompleted()).toEqual([]);
  expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
  callbacks.shift()!();
  expect(readHelpCompleted()).toContain('document');
  queue.record('a', '文字', '# 标题', []); queue.dispose();
  expect(cancel).toHaveBeenCalledOnce();
});
