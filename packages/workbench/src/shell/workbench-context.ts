import { provide, proxyRefs, shallowReactive, type InjectionKey, type ShallowUnwrapRef } from 'vue';
import type { useWorkbench } from './use-workbench';

type WorkbenchBundle = ReturnType<typeof useWorkbench>;

export type WorkbenchPrefsContext = ShallowUnwrapRef<WorkbenchBundle['prefs']>;
export type WorkbenchShellContext = ShallowUnwrapRef<WorkbenchBundle['shell']>;
export type WorkbenchDocumentsContext = ShallowUnwrapRef<WorkbenchBundle['documents']>;
export type WorkbenchTreeMenusContext = ShallowUnwrapRef<WorkbenchBundle['treeMenus']>;
export type WorkbenchModalsContext = ShallowUnwrapRef<WorkbenchBundle['modals']>;

export const workbenchPrefsKey: InjectionKey<WorkbenchPrefsContext> = Symbol('tano-workbench-prefs');
export const workbenchShellKey: InjectionKey<WorkbenchShellContext> = Symbol('tano-workbench-shell');
export const workbenchDocumentsKey: InjectionKey<WorkbenchDocumentsContext> = Symbol('tano-workbench-documents');
export const workbenchTreeMenusKey: InjectionKey<WorkbenchTreeMenusContext> = Symbol('tano-workbench-tree-menus');
export const workbenchModalsKey: InjectionKey<WorkbenchModalsContext> = Symbol('tano-workbench-modals');

export function provideWorkbenchContexts(bundle: WorkbenchBundle) {
  const prefs = shallowReactive(proxyRefs(bundle.prefs));
  const shell = shallowReactive(proxyRefs(bundle.shell));
  const documents = shallowReactive(proxyRefs(bundle.documents));
  const treeMenus = shallowReactive(proxyRefs(bundle.treeMenus));
  const modals = shallowReactive(proxyRefs(bundle.modals));

  provide(workbenchPrefsKey, prefs);
  provide(workbenchShellKey, shell);
  provide(workbenchDocumentsKey, documents);
  provide(workbenchTreeMenusKey, treeMenus);
  provide(workbenchModalsKey, modals);

  return { prefs, shell, documents, treeMenus, modals };
}
