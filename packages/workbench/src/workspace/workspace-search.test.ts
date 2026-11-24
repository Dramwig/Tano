// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useWorkspaceSearch } from './workspace-search';

afterEach(() => vi.useRealTimers());
it('cancels old requests on input, closing and disposal without publishing stale results', async () => {
  vi.useFakeTimers();
  const scope = effectScope(), query = ref('old'), enabled = ref(false);
  const requests: { signal: AbortSignal; resolve: (hits: []) => void }[] = [];
  const search = vi.fn((_query: string, signal: AbortSignal) =>
    new Promise<[]>((resolve) => requests.push({ signal, resolve })));
  const state = scope.run(() => useWorkspaceSearch({ query, enabled, workspace: () => 'space', search }))!;
  enabled.value = true;
  await nextTick(); await vi.advanceTimersByTimeAsync(160);
  query.value = 'new';
  await nextTick();
  expect(requests[0].signal.aborted).toBe(true);
  requests[0].resolve([]);
  await vi.advanceTimersByTimeAsync(160);
  expect(state.busy.value).toBe(true);
  enabled.value = false;
  await nextTick();
  expect(requests[1].signal.aborted).toBe(true);
  expect(state.busy.value).toBe(false);
  enabled.value = true;
  await nextTick(); await vi.advanceTimersByTimeAsync(160);
  scope.stop();
  expect(requests[2].signal.aborted).toBe(true);
  requests.forEach(request => request.resolve([]));
});
