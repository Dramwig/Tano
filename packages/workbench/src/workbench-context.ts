import type { InjectionKey, ShallowUnwrapRef } from 'vue';
import type { useWorkbench } from './use-workbench';

export type WorkbenchContext = ShallowUnwrapRef<ReturnType<typeof useWorkbench>>;
export const workbenchContextKey: InjectionKey<WorkbenchContext> = Symbol('tano-workbench');
