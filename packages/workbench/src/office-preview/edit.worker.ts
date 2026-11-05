import { editWorkbook } from './edit';
self.onmessage = event => {
  try { const bytes = editWorkbook(event.data.bytes, event.data.extension, event.data.edits, event.data.latest); self.postMessage({ bytes }, { transfer: [bytes.buffer] }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
