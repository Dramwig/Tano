import { ref, watch, type WatchSource } from 'vue';
import type { SearchHit } from '@tano/protocol';

export interface WorkspaceSearchHost {
  query: WatchSource<string>;
  enabled: WatchSource<boolean>;
  workspace: WatchSource<unknown>;
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>;
}

/** Owns debounce, cancellation and stale-result rejection for the search UI. */
export function useWorkspaceSearch(host: WorkspaceSearchHost) {
  const hits = ref<SearchHit[]>([]), busy = ref(false), error = ref('');
  watch([host.query, host.enabled, host.workspace], ([query, enabled], _old, cleanup) => {
    hits.value = [];
    error.value = '';
    busy.value = enabled && !!query.trim();
    if (!busy.value) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await host.search(query, controller.signal);
        if (!controller.signal.aborted) hits.value = result;
      } catch (cause) {
        if (!controller.signal.aborted) error.value = String(cause);
      } finally {
        if (!controller.signal.aborted) busy.value = false;
      }
    }, 160);
    cleanup(() => { controller.abort(); clearTimeout(timer); });
  });
  return { hits, busy, error };
}
