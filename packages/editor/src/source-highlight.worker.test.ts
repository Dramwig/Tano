import { afterEach, expect, it, vi } from 'vitest';
import { sourceStyleRanges } from '@tano/editor/source-highlight';
import { defaultCapabilities } from '@tano/editor/runtime';
import type { SourceHighlightWorkerRequest } from './source-highlight-parser';

afterEach(() => vi.unstubAllGlobals());

it('returns a local highlight delta only when the displayed base matches', async () => {
  vi.resetModules();
  const postMessage = vi.fn();
  vi.stubGlobal('postMessage', postMessage);
  vi.stubGlobal('onmessage', undefined);
  await import('./source-highlight.worker');
  const send = (data: SourceHighlightWorkerRequest) => {
    (globalThis.onmessage as (event: MessageEvent<SourceHighlightWorkerRequest>) => void)(new MessageEvent('message', { data }));
    return postMessage.mock.lastCall![0].update;
  };
  const original = 'ordinary **bold** and ==highlight==\n\n'.repeat(2000);
  expect(send({ id: 1, baseId: 0, highlightBaseId: 0, text: original }).full).toBe(true);
  const from = original.indexOf('ordinary', 10000);
  const update = send({ id: 2, baseId: 1, highlightBaseId: 1, changes: [{ from, to: from, insert: '**new** ' }] });
  expect(update.full).toBeUndefined();
  expect(update.to - update.from).toBeLessThan(300);
  expect(update.ranges).toContainEqual({ from, to: from + 7, style: 'strong' });
  const text = original.slice(0, from) + '**new** ' + original.slice(from);
  // Revision 2 was parsed but discarded by the UI while another edit arrived.
  const recovered = send({ id: 3, baseId: 2, highlightBaseId: 1, changes: [{ from: 0, to: 0, insert: 'prefix ' }] });
  expect(recovered.full).toBe(true);
  expect(recovered.ranges).toEqual(sourceStyleRanges('prefix ' + text));
});

it('keeps worker snapshots, patches, skipped revisions and global references consistent', async () => {
  vi.resetModules();
  const postMessage = vi.fn();
  vi.stubGlobal('postMessage', postMessage);
  vi.stubGlobal('onmessage', undefined);
  await import('./source-highlight.worker');
  const send = (data: Omit<SourceHighlightWorkerRequest, 'highlightBaseId'>, expected: string) => {
    const handle = globalThis.onmessage as (event: MessageEvent<SourceHighlightWorkerRequest>) => void;
    handle(new MessageEvent('message', { data: { ...data, highlightBaseId: -1 } }));
    expect(postMessage).toHaveBeenLastCalledWith({ id: data.id,
      update: { from: 0, to: expected.length, ranges: sourceStyleRanges(expected, data.features), full: true } });
  };
  const original = '[ref]: /target\n\n' + '## Heading\n\n==text== [ref]\n\n'.repeat(100);
  send({ id: 1, baseId: 0, text: original }, original);
  const position = original.indexOf('text', 500);
  const edited = original.slice(0, position) + '**new**' + original.slice(position);
  send({ id: 2, baseId: 1, changes: [{ from: position, to: position, insert: '**new**' }] }, edited);
  // Revision 3 was coalesced away before the worker received it.
  send({ id: 4, baseId: 3, text: original, changes: [{ from: 0, to: 1, insert: '' }] }, original);
  const removed = original.replace('[ref]: /target', 'ordinary');
  send({ id: 5, baseId: 4, changes: [{ from: 0, to: 14, insert: 'ordinary' }] }, removed);
  send({ id: 6, baseId: 5, changes: [], features: { ...defaultCapabilities.features, highlight: false } }, removed);
});
