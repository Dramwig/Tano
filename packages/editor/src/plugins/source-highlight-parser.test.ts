import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sourceStyleRanges } from '@tano/editor/source-highlight';
import { SourceHighlightParser } from './source-highlight-parser';

vi.mock('@tano/editor/source-highlight', () => {
  const sourceStyleRanges = vi.fn(() => ({ from: 0, to: 2, ranges: [{ from: 0, to: 2, style: 'strong' }] }));
  return { sourceStyleRanges, IncrementalSourceHighlighter: class { updatePatch = sourceStyleRanges; } };
});
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: { id: number; update: unknown } }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { workers.push(this); }
  finish(id: number) { this.onmessage?.({ data: { id, update: { from: 0, to: 0, ranges: [] } } }); }
}
beforeEach(() => { workers.length = 0; vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const long = 'x'.repeat(64000);

it('runs one parse and retains only the latest edit, discarding stale results', () => {
  const ready = vi.fn(); const parser = new SourceHighlightParser(ready);
  expect(parser.parse(long)).toBeUndefined(); vi.advanceTimersByTime(40);
  const worker = workers[0]!;
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  parser.parse(long + 'a'); parser.parse(long + 'b'); vi.advanceTimersByTime(40);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  worker.finish(1);
  expect(ready).not.toHaveBeenCalled();
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 3, text: long + 'b' }));
  worker.finish(3);
  expect(ready).toHaveBeenCalledExactlyOnceWith(long + 'b', { from: 0, to: 0, ranges: [] });
  expect(sourceStyleRanges).not.toHaveBeenCalled(); parser.destroy();
});

it('invalidates in-flight results when switching to short content and when disposed', () => {
  const ready = vi.fn(); const parser = new SourceHighlightParser(ready);
  parser.parse(long); vi.advanceTimersByTime(40);
  expect(parser.parse('short')!.ranges).toHaveLength(1);
  workers[0]!.finish(1); expect(ready).not.toHaveBeenCalled();
  parser.parse(long); vi.advanceTimersByTime(40); parser.destroy();
  workers[0]!.finish(3); expect(ready).not.toHaveBeenCalled();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('recovers the latest content when the worker fails', () => {
  const ready = vi.fn(); const parser = new SourceHighlightParser(ready);
  parser.parse(long); vi.advanceTimersByTime(40); parser.parse(long + 'latest');
  workers[0]!.onerror!();
  expect(ready).toHaveBeenCalledWith(long + 'latest', expect.objectContaining({ ranges: expect.any(Array) }));
  expect(parser.parse(long + 'retry')!.ranges).toHaveLength(1);
  expect(workers).toHaveLength(1); parser.destroy();
});

it('transfers patches for consecutive edits and snapshots after skipped revisions', () => {
  const parser = new SourceHighlightParser(vi.fn());
  parser.parse(long); vi.advanceTimersByTime(40);
  const worker = workers[0]!;
  worker.finish(1);
  const changes = [{ from: long.length, to: long.length, insert: 'a' }];
  parser.parse(long + 'a', undefined, changes); vi.advanceTimersByTime(40);
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, baseId: 1, highlightBaseId: 1, changes }));
  expect(worker.postMessage.mock.lastCall![0]).not.toHaveProperty('text');
  parser.parse(long + 'ab', undefined, [{ from: long.length + 1, to: long.length + 1, insert: 'b' }]);
  parser.parse(long + 'abc', undefined, [{ from: long.length + 2, to: long.length + 2, insert: 'c' }]);
  worker.finish(2);
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, highlightBaseId: 1, text: long + 'abc' }));
  parser.destroy();
});
