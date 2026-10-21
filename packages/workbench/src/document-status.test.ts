import { expect, it } from 'vitest';
import { documentStatusItems } from './document-status';
import type { OpenDocument } from './document-session';
const doc = (changes: Partial<OpenDocument> = {}): OpenDocument => ({ id: 'a', path: 'a.md', content: 'text', base: { content: 'text', hash: 'h', modified: 1 }, saving: false, missing: false, ...changes });

it('keeps read restrictions alongside save state, and puts errors first', () => {
  expect(documentStatusItems({ document: doc(), locked: true, preview: true, storage: 'local' }).map(item => item.kind)).toEqual(['locked', 'preview', 'saved']);
  const items = documentStatusItems({ document: doc({ error: 'Disk full' }), locked: true, storage: 'local' });
  expect(items.map(item => item.kind)).toEqual(['error', 'locked']);
  expect(items[0]?.detail).toBe('Disk full');
});
it('never reports unsaved changes, missing files or conflicts as saved', () => {
  for (const changes of [{ content: 'changed' }, { creating: true }, { missing: true }, { conflict: { copyPath: 'copy.md', disk: doc().base } }]) {
    expect(documentStatusItems({ document: doc(changes), storage: 'local' }).some(item => item.kind === 'saved')).toBe(false);
  }
  expect(documentStatusItems({ document: doc({ saving: true }), storage: 'local' })[0]?.kind).toBe('saving');
});
it('distinguishes local persistence from cloud confirmation and prioritizes active transfers', () => {
  expect(documentStatusItems({ document: doc(), storage: 'demo' })[0]?.detail).toContain('浏览器');
  expect(documentStatusItems({ document: doc(), storage: 'local' })[0]?.detail).toContain('本机');
  expect(documentStatusItems({ document: doc(), locked: true, sync: { kind: 'pushing', detail: 'Waiting for server' }, storage: 'web' }).map(item => item.kind)).toEqual(['pushing', 'locked']);
  expect(documentStatusItems({ document: doc({ content: 'changed' }), sync: { kind: 'saved', detail: 'Confirmed' }, storage: 'web' })[0]?.kind).toBe('updated');
  expect(documentStatusItems({ document: doc(), sync: { kind: 'offline', detail: 'Offline', readOnly: true }, storage: 'web' }).map(item => item.kind)).toEqual(['offline', 'preview']);
});
it('includes document layout persistence errors even when Markdown is saved', () => {
  const document = doc({ tableLayout: { file: { version: 1, fileId: 'a', tables: [] }, base: null, error: 'Layout save failed' } });
  expect(documentStatusItems({ document, storage: 'local' })[0]).toMatchObject({ kind: 'error', detail: 'Layout save failed' });
});
