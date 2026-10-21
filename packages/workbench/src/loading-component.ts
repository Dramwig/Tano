import { defineAsyncComponent, defineComponent, h, type AsyncComponentLoader, type Component } from 'vue';
import LoadingSkeleton from './components/LoadingSkeleton.vue';

/** Each lazy region owns its placeholder; ready siblings stay mounted. */
export function loadingComponent<T extends Component>(loader: AsyncComponentLoader<T>, variant: 'list' | 'document' | 'editor' | 'shell' = 'list') {
  return defineAsyncComponent({ loader, delay: 0,
    loadingComponent: defineComponent({ setup: () => () => h(LoadingSkeleton, { variant, rows: variant === 'document' || variant === 'editor' ? 10 : 4 }) }),
  });
}
