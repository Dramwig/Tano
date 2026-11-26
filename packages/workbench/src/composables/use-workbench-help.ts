import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import {
  isDataTableFilePath,
  isMarkdown,
  isWorkspaceInternalPath,
  type WorkspaceAdapter,
} from '@tano/protocol';
import { ASSISTANT_TAB_ID } from '../assistant/navigation';
import type { useAssistantStore } from '../assistant/store';
import { isTableTab } from '../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import type { HelpAvailability, HelpContext } from '../help/help-content';
import { CALENDAR_TAB_ID } from '../plans/calendar';
import { PLUGINS_TAB_ID } from '../plugins/workspace-plugins';
import type { WorkbenchExtensions } from '../runtime';
import { SETTINGS_TAB_ID } from '../settings/settings-tab';
import type { usePlanStore } from '../stores/plans';
import type { useWorkspaceStore } from '../stores/workspace';

export interface WorkbenchHelpDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  plans: ReturnType<typeof usePlanStore>;
  workspaceAdapter: WorkspaceAdapter;
  editing: WorkbenchExtensions['editing'];
  compactPanes: Ref<boolean>;
  sidebarView: Ref<string>;
  activeExtensionView: Ref<unknown>;
  editorReadonly: Ref<boolean>;
  source: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  menu: Ref<boolean>;
  modal: Ref<string>;
  settingsPanel: Ref<boolean>;
  importPanel: Ref<boolean>;
  templateLibraryOpen: Ref<boolean>;
  agentPanel: Ref<boolean>;
  objectDetail: Ref<unknown>;
  planArchiveOpen: Ref<boolean>;
  selectedDiff: Ref<unknown>;
  selectionTodo: Ref<unknown>;
  recyclePanel: Ref<boolean>;
  referenceGraphOpened: Ref<boolean>;
  fileContextMenu: Ref<unknown>;
  directoryContextMenu: Ref<unknown>;
  pageContextMenu: Ref<unknown>;
  outlineContextMenu: Ref<unknown>;
  resizingSidebar: Ref<boolean>;
  draggedEntry: Ref<unknown>;
  updateLock: Ref<boolean>;
}

export function useWorkbenchHelp(deps: WorkbenchHelpDeps) {
  const {
    store,
    assistant,
    plans,
    workspaceAdapter,
    editing,
    compactPanes,
    sidebarView,
    activeExtensionView,
    editorReadonly,
    source,
    workspaceMenu,
    menu,
    modal,
    settingsPanel,
    importPanel,
    templateLibraryOpen,
    agentPanel,
    objectDetail,
    planArchiveOpen,
    selectedDiff,
    selectionTodo,
    recyclePanel,
    referenceGraphOpened,
    fileContextMenu,
    directoryContextMenu,
    pageContextMenu,
    outlineContextMenu,
    resizingSidebar,
    draggedEntry,
    updateLock,
  } = deps;
  const { workspace, active, activeId, fatal, busy } = storeToRefs(store);

  const noteCount = computed(
    () =>
      workspace.value?.files.filter(
        (f) =>
          f.kind === 'file' &&
          !isWorkspaceInternalPath(f.path) &&
          (isMarkdown(f.path) || isDataTableFilePath(f.path)),
      ).length ?? 0,
  );

  const helpContext = computed<HelpContext>(() => {
    if (activeId.value === ASSISTANT_TAB_ID || sidebarView.value === 'assistant')
      return 'assistant';
    if (isTableTab(activeId.value)) return 'tables';
    if (activeId.value === GRAPH_TAB_ID) return 'graph';
    if (activeId.value === PLUGINS_TAB_ID) return 'plugins';
    if (activeId.value === CALENDAR_TAB_ID || sidebarView.value === 'plan') return 'plan';
    if (!active.value) return 'welcome';
    if (editorReadonly.value) return 'reading';
    if (source.value) return 'source';
    return active.value.content.trim() ? 'document' : 'empty-document';
  });

  const helpAvailability = computed<HelpAvailability>(() => ({
    'document-write': !!active.value && !editorReadonly.value,
    'workspace-write': !!workspace.value && !workspace.value.readOnly,
    plans: plans.personalWritable || plans.workspaceWritable,
    comments: !!active.value && !editorReadonly.value,
    templates: !!workspace.value && !workspace.value.readOnly,
    import: !!workspace.value && !workspace.value.readOnly,
    duplicate: !!workspace.value && !workspace.value.readOnly && !!workspaceAdapter.duplicate,
    'folder-home': !!workspace.value && !!store.workspaceSettings.folderHomeFileName,
    'folder-conversion':
      !!workspace.value &&
      !workspace.value.readOnly &&
      store.canConvertFolderDocuments &&
      !!store.workspaceSettings.folderHomeFileName,
    panes: !!workspace.value && !compactPanes.value,
    assistant: !!workspace.value && assistant.available,
    'assistant-configure':
      !!workspace.value && assistant.available && assistant.canConfigure && !assistant.demo,
    suggestions:
      !!active.value && !editorReadonly.value && !editing.isManaging(active.value.id),
    math: !!active.value && !editorReadonly.value && store.capabilities.features.math,
    mermaid: !!active.value && !editorReadonly.value && store.capabilities.features.mermaid,
  }));

  const helpBlocked = computed(
    () =>
      !!(
        activeExtensionView.value ||
        activeId.value === SETTINGS_TAB_ID ||
        activeId.value.startsWith('attachment:') ||
        (assistant.opened && assistant.displayMode === 'fullscreen') ||
        busy.value ||
        fatal.value ||
        store.pending ||
        active.value?.conflict ||
        active.value?.error ||
        workspaceMenu.value ||
        menu.value ||
        modal.value ||
        settingsPanel.value ||
        importPanel.value ||
        templateLibraryOpen.value ||
        agentPanel.value ||
        objectDetail.value ||
        planArchiveOpen.value ||
        selectedDiff.value ||
        selectionTodo.value ||
        recyclePanel.value ||
        referenceGraphOpened.value ||
        fileContextMenu.value ||
        directoryContextMenu.value ||
        pageContextMenu.value ||
        outlineContextMenu.value ||
        resizingSidebar.value ||
        draggedEntry.value ||
        updateLock.value
      ),
  );

  return {
    noteCount,
    helpContext,
    helpAvailability,
    helpBlocked,
  };
}
