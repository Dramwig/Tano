import { computed, type ComputedRef, type Ref } from 'vue';
import type { OpenDocument } from './document-session';

/** Index membership independently of content; unchanged documents keep their revision. */
export function useDocumentIndex(documents: Ref<OpenDocument[]>) {
  const byId = computed(() => new Map(documents.value.map(doc => [doc.id, doc])));
  const byPath = computed(() => new Map(documents.value.map(doc => [doc.path, doc])));
  const revisions = new WeakMap<OpenDocument, ComputedRef<number>>();
  const drafts = new WeakMap<OpenDocument, ComputedRef<number>>();
  let sequence = 0;
  function revision(doc: OpenDocument) {
    let value = revisions.get(doc);
    if (!value) {
      value = computed(() => {
        // Track content without copying, hashing or serializing it. A new document
        // instance gets a distinct revision even when it reuses a closed tab's ID.
        void doc.content;
        return ++sequence;
      });
      revisions.set(doc, value);
    }
    return value.value;
  }
  function draftRevision(doc: OpenDocument) {
    let value = drafts.get(doc);
    if (!value) {
      value = computed(() => doc.content !== doc.base.content ? revision(doc) : 0);
      drafts.set(doc, value);
    }
    return value.value;
  }
  return { byId, byPath, revision, draftRevision };
}
