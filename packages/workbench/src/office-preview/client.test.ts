import { afterEach, expect, it, vi } from 'vitest';
import { readOffice } from './client';
import { officeErrors } from './model';

class FakeWorker {
  static last: FakeWorker;
  terminate = vi.fn(); postMessage = vi.fn();
  onmessage?: (event: { data: unknown }) => void; onerror?: () => void;
  constructor() { FakeWorker.last = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('terminates cancelled and timed-out workers and transfers a copy of the attachment bytes', async () => {
  vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers();
  const controller = new AbortController(), bytes = new Uint8Array([1, 2, 3]);
  const promise = readOffice(bytes, 'UPPER.XLSX', controller.signal);
  const worker = FakeWorker.last;
  expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ extension: 'xlsx', bytes });
  expect(worker.postMessage.mock.calls[0][0].bytes).not.toBe(bytes);
  const cancelled = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  const waiting = readOffice(bytes, 'a.doc', new AbortController().signal);
  const timeout = expect(waiting).rejects.toThrow(officeErrors.timeout);
  await vi.advanceTimersByTimeAsync(30000); await timeout;
  expect(FakeWorker.last.terminate).toHaveBeenCalledTimes(1);
});
it('cleans up completed and failed workers', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const success = readOffice(new Uint8Array(), 'a.docx', new AbortController().signal);
  const result = { kind: 'document', pages: [], legacy: false };
  FakeWorker.last.onmessage!({ data: { result } }); await expect(success).resolves.toEqual(result);
  expect(FakeWorker.last.terminate).toHaveBeenCalledTimes(1);
  const failed = readOffice(new Uint8Array(), 'a.docx', new AbortController().signal);
  FakeWorker.last.onerror!(); await expect(failed).rejects.toThrow(officeErrors.invalid);
  expect(FakeWorker.last.terminate).toHaveBeenCalledTimes(1);
});
