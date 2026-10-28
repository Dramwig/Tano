import { officeErrors, type OfficePreview } from './model';

/** Each preview owns its worker: abort and timeout terminate even a stuck third-party parser. */
export function readOffice(bytes: Uint8Array, path: string, signal: AbortSignal): Promise<OfficePreview> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const worker = new Worker(new URL('./office.worker.ts', import.meta.url), { type: 'module' });
    function finish(error?: Error, result?: OfficePreview) {
      clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    }
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(officeErrors.timeout)), 30000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: OfficePreview; error?: string }>) => {
      if (event.data.error || !event.data.result) finish(new Error(event.data.error || officeErrors.invalid));
      else finish(undefined, event.data.result);
    };
    worker.onerror = () => finish(new Error(officeErrors.invalid));
    const copy = Uint8Array.from(bytes);
    worker.postMessage({ bytes: copy, extension: path.split('.').at(-1)?.toLowerCase() ?? '' }, [copy.buffer]);
  });
}
