import { computed, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useDocumentIndex } from './document-index';
import type { OpenDocument } from './document-session';

function document(id: string, content = 'saved'): OpenDocument {
  return { id, path: `${id}.md`, content, base: { content, hash: id, modified: 0 },
    saving: false, missing: false };
}

describe('document index', () => {
  it('keeps membership indexes stable on edits and updates them on rename, removal and replacement', () => {
    const documents = ref([document('a'), document('b')]);
    const index = useDocumentIndex(documents);
    const ids = index.byId.value, paths = index.byPath.value;
    documents.value[0]!.content = 'draft';
    expect(index.byId.value).toBe(ids);
    expect(index.byPath.value).toBe(paths);
    documents.value[0]!.path = 'renamed.md';
    expect(index.byPath.value.has('a.md')).toBe(false);
    expect(index.byPath.value.get('renamed.md')).toBe(documents.value[0]);
    const previous = index.revision(documents.value[0]!);
    documents.value = [document('a')];
    expect(index.byId.value.has('b')).toBe(false);
    expect(index.byId.value.get('a')).toBe(documents.value[0]);
    expect(index.revision(documents.value[0]!)).not.toBe(previous);
  });

  it('tracks save, revert and edits without invalidating unrelated document revisions', () => {
    const documents = ref([document('a'), document('b')]);
    const index = useDocumentIndex(documents);
    const [a, b] = documents.value as [OpenDocument, OpenDocument];
    const original = index.revision(a), other = index.revision(b);
    expect(index.draftRevision(a)).toBe(0);
    a.content = 'draft';
    expect(index.revision(a)).not.toBe(original);
    expect(index.draftRevision(a)).toBe(index.revision(a));
    a.base = { ...a.base, content: a.content };
    expect(index.draftRevision(a)).toBe(0);
    a.content = 'another draft';
    expect(index.draftRevision(a)).not.toBe(0);
    a.content = a.base.content;
    expect(index.draftRevision(a)).toBe(0);
    expect(index.revision(b)).toBe(other);
  });

  it('reads only the changed body when refreshing revisions for 200 large open documents', () => {
    const contents = Array.from({ length: 200 }, () => ref('x'.repeat(100_000)));
    const reads = contents.map(() => 0);
    const documents = ref(contents.map((content, i) => ({
      ...document(String(i)),
      get content() { reads[i]!++; return content.value; },
    })));
    const index = useDocumentIndex(documents);
    const revision = computed(() => documents.value.map(doc => index.revision(doc)));
    const before = revision.value;
    reads.fill(0);
    contents[0]!.value += '!';
    const after = revision.value;
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(reads[0]).toBe(1);
    expect(reads.slice(1).reduce((sum, count) => sum + count, 0)).toBe(0);
  });
});
