import { parseOffice } from './parser';
import { officeErrors } from './model';

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; extension: string }>) => {
  try { self.postMessage({ result: parseOffice(event.data.bytes, event.data.extension) }); }
  catch (reason) { self.postMessage({ error: reason instanceof Error ? reason.message : officeErrors.invalid }); }
};
