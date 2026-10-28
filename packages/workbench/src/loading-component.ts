import { defineAsyncComponent, defineComponent, h, type AsyncComponentLoader, type Component } from 'vue';
import LoadingSkeleton from './components/LoadingSkeleton.vue';
import PreviewSkeleton from './components/PreviewSkeleton.vue';

/** Each lazy region owns its placeholder; ready siblings stay mounted. */
export function loadingComponent<T extends Component>(loader: AsyncComponentLoader<T>, variant: 'list' | 'document' | 'editor' | 'shell' | 'tree' | 'spreadsheet' = 'list') {
  return defineAsyncComponent({ loader, delay: 0,
    loadingComponent: defineComponent({ setup: () => () => variant === 'spreadsheet' ? h(PreviewSkeleton, { kind: 'spreadsheet' })
      : h(LoadingSkeleton, { variant, rows: variant === 'document' || variant === 'editor' ? 10 : 4 }) }),
  });
}
