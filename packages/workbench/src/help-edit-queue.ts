import type { ReferenceTarget } from '@tano/protocol';
import { recordHelpDocumentEdit } from './help-checklist';

/** Keep each accepted transition: adding then removing syntax still counts as use. */
export function createHelpEditQueue() {
  let jobs: { id: string; before: string; after: string; targets: readonly ReferenceTarget[] }[] = [];
  let cancel: (() => void) | undefined;
  function schedule() {
    if (cancel || !jobs.length) return;
    const run = () => {
      cancel = undefined;
      const job = jobs.shift();
      if (job) recordHelpDocumentEdit(job.id, job.before, job.after, job.targets);
      schedule();
    };
    // Never run syntax detection synchronously or in the editor's microtask flush.
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(run, { timeout: 500 });
      cancel = () => cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(run, 32);
      cancel = () => clearTimeout(handle);
    }
  }
  return {
    record(id: string, before: string, after: string, targets: readonly ReferenceTarget[]) {
      if (before === after || typeof window === 'undefined') return;
      jobs.push({ id, before, after, targets });
      schedule();
    },
    dispose() { cancel?.(); cancel = undefined; jobs = []; },
  };
}
