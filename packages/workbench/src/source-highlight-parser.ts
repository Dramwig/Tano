import { IncrementalSourceHighlighter, type SourceHighlightChange, type SourceHighlightUpdate } from '@tano/editor/source-highlight';
import type { DocumentFeatures } from '@tano/editor/runtime';

export interface SourceHighlightRequest {
  id: number;
  baseId: number;
  highlightBaseId: number;
  text: string;
  features?: DocumentFeatures;
  changes?: readonly SourceHighlightChange[];
}

export type SourceHighlightWorkerRequest = Omit<SourceHighlightRequest, 'text'> & { text?: string };

/** Keep the existing Markdown dialect while moving large-file syntax analysis
 * off the input thread. At most one running and one newest request are retained. */
export class SourceHighlightParser {
  private worker?: Worker;
  private queued?: SourceHighlightRequest;
  private running?: SourceHighlightRequest;
  private fallback = new IncrementalSourceHighlighter();
  private fallbackRevision = 0;
  private revision = 0;
  private workerRevision = 0;
  private deliveredRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private failed = false;

  constructor(private ready: (text: string, update: SourceHighlightUpdate) => void) {}

  parse(text: string, features?: DocumentFeatures, changes?: readonly SourceHighlightChange[]): SourceHighlightUpdate | undefined {
    const baseId = this.revision;
    const id = ++this.revision;
    const request = { id, baseId, highlightBaseId: this.deliveredRevision, text, features: features ? { ...features } : undefined, changes };
    clearTimeout(this.timer); this.queued = undefined;
    if (text.length < 64_000 || typeof Worker === 'undefined' || this.failed)
      return this.parseSync(request);
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./source-highlight.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => {
          const request = this.running;
          this.running = undefined;
          if (!this.disposed && request?.id === this.revision && event.data.id === request.id) {
            this.deliveredRevision = request.id;
            this.ready(request.text, event.data.update);
          }
          this.flush();
        };
        this.worker.onerror = () => {
          const latest = this.queued ?? this.running;
          this.worker?.terminate(); this.worker = undefined; this.failed = true;
          this.running = this.queued = undefined;
          if (!this.disposed && latest?.id === this.revision)
            this.ready(latest.text, this.parseSync(latest));
        };
      }
      this.queued = request;
      this.timer = setTimeout(() => this.flush(), 40);
      return undefined;
    } catch {
      this.failed = true;
      return this.parseSync(request);
    }
  }

  private parseSync(request: SourceHighlightRequest) {
    const update = this.fallback.updatePatch(request.text, request.features,
      request.baseId === this.fallbackRevision ? request.changes : undefined,
      request.highlightBaseId !== this.fallbackRevision);
    this.fallbackRevision = request.id;
    this.deliveredRevision = request.id;
    return update;
  }

  private flush() {
    if (this.disposed || this.running || !this.queued || !this.worker) return;
    this.running = this.queued; this.queued = undefined;
    // Consecutive edits transfer only the changed text. Coalesced revisions
    // carry a snapshot so the worker can recover its exact base document.
    const message: SourceHighlightWorkerRequest = { ...this.running };
    if (message.changes && message.baseId === this.workerRevision) delete message.text;
    this.worker.postMessage(message);
    this.workerRevision = this.running.id;
  }

  destroy() {
    this.disposed = true;
    clearTimeout(this.timer); this.worker?.terminate(); this.worker = undefined;
    this.queued = this.running = undefined;
  }
}
