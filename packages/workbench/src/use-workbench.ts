import { isMouseEvent, isHTMLElement, isElement, ownerWindow } from '@tano/editor/dom-realm';
import { useWindowContext, type WindowContext } from './windows/context';
import { detachedWindowPosition, type DetachedDropPoint } from './windows/position';
import type { SettingsPageId } from './settings-window';
import { useAuxiliaryWindows } from './windows/manager';

import { vSurfaceMotion } from '@tano/editor/surface-motion';

import { installInteractionMotion } from '@tano/editor/motion';

import ShortcutHint from '@tano/editor/shortcut-hint';

import WorkspaceSyncPanel from './components/WorkspaceSyncPanel.vue';

import { vScrollFade } from './scroll-fade';

import { vOutlineMotion } from './outline-motion';

import { HeadingViewport } from './heading-viewport';

import { createWorkspaceSync, syncEvent } from './workspace-sync';

import { uiLocale, t } from './i18n';
import { documentTabLabel } from './tab-label';

import { readSettingsPage } from './settings-preference';

import { focusedOutlineIndices } from './outline-tree';

import AppTooltip from './components/AppTooltip.vue';

import DocumentOutline from './components/DocumentOutline.vue';

import { assistantDiscussionPrompt } from './assistant/language';

import { assistantSourceRange } from './assistant/source-selection';

import type { AssistantSource } from '@tano/protocol';

import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowReactive,
  shallowRef,
  watch,
} from 'vue';

import { storeToRefs } from 'pinia';

import { version as appVersion } from '../package.json';

import {
  BookOpen,
  House,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  FolderPlus,
  FolderOpen,
  FolderSearch,
  FolderTree,
  PanelLeftOpen,
  PanelsTopLeft,
  FileText,
  FilePlus2,
  FileOutput,
  FileSliders,
  FileSymlink,
  Paperclip,
  Eye,
  EyeOff,
  TextCursorInput,
  Route,
  AppWindow,
  Blocks,
  X,
  Check,
  Circle,
  MoreHorizontal,
  ArrowUpRight,
  Archive,
  Clock3,
  History,
  List,
  ListTree,
  ListTodo,
  CircleHelp,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Repeat2,
  Trash2,
  Bot,
  MessageSquare,
  MessageSquareDiff,
  Link,
  CheckCheck,
  CopyPlus,
  LoaderCircle,
  Puzzle,
  GitFork,
  CalendarDays,
  Settings2,
  SquarePen,
  Pin,
  LockKeyhole,
  MoveHorizontal,
  Undo2,
  Redo2,
  ArrowDownToLine,
  Files,
  Table2,
  Database,
} from 'lucide-vue-next';

import MarkdownEditorSkeleton from './components/MarkdownEditorSkeleton.vue';

import DocumentLoading from './components/DocumentLoading.vue';

import { defaultEditorPreferences, normalizeCopyFormat, normalizeMarkdownAutocomplete, normalizeSelectionWrapping, normalizeChineseInput } from '@tano/editor/runtime';

import type { EditorPreferences } from '@tano/editor/runtime';

import { defaultSelectionContext } from '@tano/editor/selection-context';

import type { EditorSelectionContext } from '@tano/editor/selection-context';

import { captureModeViewport, restoreModeViewport } from './editor-mode';

import type { ModeViewport } from './editor-mode';

import AttachmentPreview from './components/AttachmentPreview.vue';

import type { AttachmentStatusUpdate } from './attachment-status';

import FileMetadataPanel from './components/FileMetadataPanel.vue';

import { fileHandlers } from '@tano/protocol';

import PageSearch from './components/PageSearch.vue';

import EmptyEditor from './components/EmptyEditor.vue';

import DocumentStarter from './components/DocumentStarter.vue';

import { documentStarter, templateStarterBody } from './document-starters';

import MarkdownRevealToggle from './components/MarkdownRevealToggle.vue';

import SourceCodeIcon from './components/SourceCodeIcon.vue';

import OpenWorkspaceIcon from './components/OpenWorkspaceIcon.vue';

import DocumentTitle from './components/DocumentTitle.vue';

import { appearanceText } from './document-appearance';

import { useDocumentFavicon } from './document-favicon';

import WorkspaceBreadcrumb from './components/WorkspaceBreadcrumb.vue';

import FolderView from './components/FolderView.vue';

import PluginViewHeader from './components/PluginViewHeader.vue';

import { pluginPreviewStatus, pluginViewHeader } from './plugins/view-header';

import DocumentStatus from './components/DocumentStatus.vue';

import { documentStatusItems, type DocumentSyncStatus } from './document-status';

import DocumentScrollbar from './components/DocumentScrollbar.vue';

import PageDisplayOptions from './components/PageDisplayOptions.vue';

import DocumentGlobalMenu from './components/DocumentGlobalMenu.vue';

import DocumentExportMenu from './components/DocumentExportMenu.vue';

import DocumentPrintButton from './components/DocumentPrintButton.vue';

import type { ImportRecord } from './components/ImportPanel.vue';

import type { DocumentExportFormat, DocumentExportOptions } from './document-export';

// Keep the document layout mounted while only the editor implementation loads.
import DocumentSuggestions from './components/DocumentSuggestions.vue';

import ReferenceGraphPopover from './components/ReferenceGraphPopover.vue';

import { planDocumentSource, selectionTodoSession } from './selection-todo';

import type { SelectionTodoSession } from './selection-todo';

import { documentLinks, referenceInsertionPoint } from '@tano/editor/document-links';

import type { CommentAnchor } from '@tano/protocol';

import { splitFrontmatter, unsupportedMarkdown } from '@tano/editor/syntax';

import { frontmatterProperties } from '@tano/editor/frontmatter-display';

import {
  basename,
  parentPath,
  isMarkdown,
  validatePath,
  isWorkspaceInternalPath,
  resolveWorkspaceReference,
  relativeWorkspaceReference,
  safeRemoteImage,
} from '@tano/protocol';

import type { FileEntry, RecentWorkspace } from '@tano/protocol';

import { useWorkspaceSearch } from './workspace-search';

import {
  nativeAttachments,
  exportAttachment,
  resourceMarkdown,
  openExternalUrl,
  openWorkspaceEntry,
  workspaceEntryPath,
} from './attachments';

import { headings } from '@tano/markdown';

import FileTree from './components/FileTree.vue';

import { indexFolderHomes } from './folder-home';

import { planFolderConversion, type FolderConversionKind } from './folder-conversion';

import DesktopTabs from './components/DesktopTabs.vue';

import WorkspacePanes from './components/WorkspacePanes.vue';

import type { DocumentTab, OpenDocument } from './stores/workspace';

import type { PaneDrop } from './pane-layout';
import { layoutPanes } from './pane-layout';

import { GRAPH_TAB_ID } from './document-graph';

import { PLUGINS_TAB_ID } from './workspace-plugins';

import { CALENDAR_TAB_ID, calendarPeriodTitle, shiftCalendarDate } from './calendar';

import type { CalendarViewMode } from './calendar';

import NewTabPicker from './components/NewTabPicker.vue';

import { parseToolbarMode, toolbarPreferenceKey } from './toolbar-preference';

import AssistantLauncher from './components/AssistantLauncher.vue';

import AssistantButterflyLayer from './components/AssistantButterflyLayer.vue';

import { butterflyScope } from './assistant/butterfly';

import { createButterflyIdleTrigger } from './assistant/butterfly-idle';

import { butterflyPerchDirective, provideButterflyController } from './assistant/butterfly-vue';

import { useAssistantStore, useInlineAssistantStore } from './assistant/store';

import { useAgentInboxController, agentInboxKey } from './assistant/agent-controller';

import { inlineAssistantResult } from './assistant/inline-result';

import { handleMobileVisibility } from './mobile-lifecycle';

import { useViewport } from './viewport';

import { useWorkspaceStore } from './stores/workspace';

import { retainWorkbenchSession } from './workbench-session';

import { useSuggestionStore } from './stores/suggestions';

import { useWorkbenchRuntime, createLocalExtensions } from './runtime';

import type { WorkbenchActions } from './runtime';

import { native } from './adapter';

import { mobile } from './platform';

import WorkspaceIcon from './components/WorkspaceIcon.vue';

import WorkspaceMenuLayout from './components/WorkspaceMenuLayout.vue';

import { workspaceArchive, workspaceArchiveName } from './workspace-export';

import type { ObjectRecord } from './workspace-objects';

import { usePlanStore } from './stores/plans';

import { usePlanSyncStore } from './stores/plan-sync';

import { planKey } from './personal-plans';

import SidebarNavigation from './components/SidebarNavigation.vue';

import WorkspaceSidebar from './components/WorkspaceSidebar.vue';

import HelpLauncher from './components/HelpLauncher.vue';

import SidebarUpdateButton from './components/SidebarUpdateButton.vue';

import type { HelpAvailability, HelpContext } from './help-content';

import { recordHelpCompleted } from './help-checklist';

import WorkspaceViewSwitcher from './components/WorkspaceViewSwitcher.vue';

import { useWorkbenchNavigation, type WorkspaceSidebarView } from './workbench-navigation';

import { ASSISTANT_TAB_ID, openAssistantPage } from './assistant/navigation';

import ButtonVisibilityGroup from './components/ButtonVisibilityGroup.vue';

import type { InlineAssistantAnchor } from './components/InlineAssistantInput.vue';

import { isTableTab, TABLES_TAB_ID, tableFileId } from './data-tables';

import { isDataTableFilePath } from '@tano/protocol';

import PluginView from './components/PluginView.vue';

import PluginSidebar from './components/PluginSidebar.vue';

import PluginMenu from './components/PluginMenu.vue';

import CommandPalette from './components/CommandPalette.vue';

import { editorPaletteCommands } from './command-palette';

import type { WorkbenchCommand } from './command-palette';

import { pluginShortcutCommand } from './plugins/workbench';

import { isObjectPath, referenceMarkdown, referenceUrl, resolveReference } from '@tano/protocol';

import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';

import LoadingSkeleton from './components/LoadingSkeleton.vue';

import { loadingComponent } from './loading-component';

import { useUpdatesStore } from './stores/updates';

import { resolveWikiLink } from './wiki-links';

import { applyFileMovePreview, planFileMovePreview, type FileMovePreview } from './file-move';

import {
  isSidebarToggleShortcut, matchesShortcut, parseShortcutBindings, readShortcutBindings,
  saveShortcutBindings, shortcutLabel, shortcutAriaLabel, shortcutKeys, shortcutPreferenceKey,
} from './shortcuts';

import type { ShortcutId } from './shortcuts';

import { configuredEditorShortcuts } from './configured-editor-shortcuts';

import { selectTreeEntry, topLevelEntries } from './file-selection';

import { isBlankPageTarget } from './page-context-menu';

import { pageRoutePath, pageRouteUrl, parsePageRoute } from './web-navigation';

import { applyTheme } from './theme';

import { AppearanceController } from './appearance';

import LayoutDocumentChrome from './components/LayoutDocumentChrome.vue';

import { FileIconRegistry, fileIconRegistryKey } from './file-icons/registry';

import type { ThemePreference } from './theme';

import { parseVisualFontChoice, sanitizeCustomFontName, parseSplitFontSettings } from './editor-font';

import { useEditorFontFamily } from './use-editor-font';

import type { VisualFontChoice } from './editor-font';

import { emitTo, listen } from '@tauri-apps/api/event';

export interface WorkbenchProps {
  initialWorkspace?: string;
  resolveInitialWorkspace?: () => Promise<string | undefined>;
  createWorkspace?: boolean;
}

export function useWorkbench(props: WorkbenchProps, emit: (event: 'ready') => void) {

const MarkdownEditor = defineAsyncComponent({ loader: () => import('@tano/editor'), delay: 0, loadingComponent: MarkdownEditorSkeleton });
const CalloutIconPicker = defineAsyncComponent(() => import('./components/CalloutIconPicker.vue'));
const SourceEditor = loadingComponent(() => import('./components/SourceEditor.vue'), 'editor');
const ImportPanel = defineAsyncComponent(() => import('./components/ImportPanel.vue'));
const TemplateLibrary = loadingComponent(() => import('./components/TemplateLibrary.vue'), 'document');
// Discussion and annotation surfaces decide their own visibility and loading state.
const DocumentComments = defineAsyncComponent(() => import('./components/DocumentComments.vue'));
const SelectionTodoDialog = defineAsyncComponent(() => import('./components/SelectionTodoDialog.vue'));
type WorkspaceEntry = Pick<RecentWorkspace, 'id' | 'name' | 'path' | 'icon'>;
const RelationGraph = loadingComponent(() => import('./components/RelationGraph.vue'), 'document');
const EditorTools = defineAsyncComponent(() => import('./components/EditorTools.vue'));
const DocumentHistoryPanel = loadingComponent(() => import('./components/DocumentHistoryPanel.vue'));
const AgentPanel = loadingComponent(() => import('./components/AgentPanel.vue'));
// The panel owns its placement (Teleport for floating/fullscreen). A generic
// loading skeleton here would enter the pane's flex row and shrink the editor
// on the first open, then disappear when the panel teleports out.
const AssistantPanel = defineAsyncComponent(() => import('./components/AssistantPanel.vue'));
const DiffDialog = defineAsyncComponent(() => import('./components/DiffDialog.vue'));
const MobileRecycle = defineAsyncComponent(() => import('./components/MobileRecycle.vue'));
const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'));
const ObjectPanel = defineAsyncComponent(() => import('./components/ObjectPanel.vue'));
const PlanDetailPanel = defineAsyncComponent(() => import('./components/PlanDetailPanel.vue'));
const SidebarPlan = loadingComponent(() => import('./components/SidebarPlan.vue'), 'tree');
const SidebarAssistant = loadingComponent(() => import('./components/SidebarAssistant.vue'));
const InlineAssistantInput = defineAsyncComponent(() => import('./components/InlineAssistantInput.vue'));
const CalendarView = loadingComponent(() => import('./components/CalendarView.vue'), 'document');
const DataTablePage = loadingComponent(() => import('./components/DataTablePage.vue'), 'spreadsheet');
const WorkspaceViewTab = loadingComponent(() => import('./components/WorkspaceViewTab.vue'), 'document');
const PluginInstaller = defineAsyncComponent(() => import('./components/PluginInstaller.vue'));



const mainWindow = useWindowContext();
const activeWindow = shallowRef(mainWindow);
const store = useWorkspaceStore();
const auxiliaryWindows = useAuxiliaryWindows(store, async () => {
  await editing.flush();
  return store.flush();
}, context => { activeWindow.value = context; });
const startupPending = ref(true);
const documentSuggestions = useSuggestionStore();
const suggestionModeBusy = ref(false);
async function toggleSuggestionMode(fileId: string) {
  if (suggestionModeBusy.value) return;
  menu.value = false;
  suggestionModeBusy.value = true;
  try { await documentSuggestions.toggle(fileId); }
  catch (error) { store.report(error); }
  finally { suggestionModeBusy.value = false; }
}
const assistant = useAssistantStore();
const agentInbox = useAgentInboxController();
provide(agentInboxKey, agentInbox);
watch(agentInbox.error, error => { if (error) store.report(error); });
// Keep the panel mounted until its closing transition releases the layout space.
const assistantPanelMounted = ref(assistant.opened);
watch(() => assistant.opened, open => { if (open) assistantPanelMounted.value = true; });
const inlineRunner = useInlineAssistantStore();
const butterfly = provideButterflyController();
const vButterflyPerch = butterflyPerchDirective(butterfly);
const paneButterflyScope = (paneId: string, fileId: string) => butterflyScope(store.workspace?.id ?? '', paneId, fileId);
watch(() => [store.workspace?.id, store.activePaneId, store.activeId, assistant.available, assistant.opened, store.documents.length], () => {
  butterfly.setContext(paneButterflyScope(store.activePaneId, store.activeId),
    assistant.available && !assistant.opened && (isTableTab(store.activeId) || !!store.documentForTab(store.activeId)));
}, { immediate: true });
const assistantHosts = shallowReactive(new Map<string, HTMLElement>());
function setAssistantHost(paneId: string, value: unknown) {
  if (value) assistantHosts.set(paneId, value as HTMLElement);
  else assistantHosts.delete(paneId);
}
const assistantTab = computed(() =>
  assistant.opened && assistant.displayMode === 'fullscreen'
    ? {
        id: assistant.fullscreenTabId,
        title: assistant.session?.messages.length ? assistant.session.title : t('Tano 助手'),
      }
    : undefined,
);
const plans = usePlanStore();
usePlanSyncStore();
// Document tabs belong to the desktop app. Mobile and web use page navigation.
const tabsEnabled = native && !mobile;
const { width: viewportWidth, touch: touchLayout, compact: compactPanes } = useViewport(mobile);
const isAuxiliaryWindow = false;
const localNative = native && !store.isWeb;
const attachments =
  useWorkbenchRuntime().attachments ?? (localNative ? nativeAttachments : undefined);
const workspaceAdapter = useWorkbenchRuntime().adapter;
const documentationBaseUrl = useWorkbenchRuntime().documentationBaseUrl;
const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
const extensionViews = extensions.views ?? [];
const sidebarNavigationItems = computed(() => [
  { id: 'plan', get label() { return t('计划'); } },
  ...extensionViews
    .filter((view) => view.sidebar)
    .map((view) => ({ id: view.id, label: view.label })),
]);
const sidebarHeaderItems = computed(() => [
  ...extensionViews
    .filter((view) => view.header)
    .map((view) => ({ id: view.id, label: view.label })),
]);
const repositoryActionItems = computed(() => [
  ...(store.workspaceSettings.showGraph ? [{ id: 'graph', get label() { return t('关系图谱'); } }] : []),
  { id: 'search', get label() { return t('查找文档'); } },
  { id: 'create', get label() { return t('新建文档'); } },
]);
const documentToolItems = [
  { id: 'markdown-reveal', get label() { return t('光标展开源码'); } },
  { id: 'source-mode', get label() { return t('源码模式'); } },
];
const topbarItems = [
  { id: 'breadcrumb', get label() { return t('面包屑'); } },
];
const attachmentStates = ref<Record<string, AttachmentStatusUpdate>>({});
function receiveAttachmentStatus(paneId: string, update: AttachmentStatusUpdate) {
  if (update.state) attachmentStates.value[paneId] = update;
  else if (attachmentStates.value[paneId]?.source === update.source) delete attachmentStates.value[paneId];
}
function currentAttachmentStatus(paneId: string, file?: FileEntry) {
  const update = attachmentStates.value[paneId];
  return update?.documentKey === `${workspace.value?.id}:${file?.id}` ? update.state : undefined;
}
const attachmentStatus = (paneId: string, file?: FileEntry) => currentAttachmentStatus(paneId, file)?.items ?? (attachments?.writeSpreadsheet && file && /\.(xlsx|xls)$/i.test(file.path) && !file.readOnly && !workspace.value?.readOnly
  ? [{ kind: 'preview' as const, label: t('Excel 编辑'), detail: t('支持调整列宽、编辑单元格和新增工作表；修改会自动保存。') }]
  : [{ kind: 'locked' as const, label: t('只读预览'), detail: t('附件以只读方式打开，不会修改原文件。') }]);
const workspaceStatusLabel = computed(() =>
  store.workspace?.readOnly
    ? t('只读权限')
    : store.isDemo
      ? t('浏览器演示')
      : null,
);
const calendarToolItems = [
  { id: 'calendar-period', get label() { return t('日历日期'); } },
  { id: 'calendar-today', get label() { return t('今天'); } },
  { id: 'calendar-previous', get label() { return t('上一时段'); } },
  { id: 'calendar-next', get label() { return t('下一时段'); } },
  { id: 'calendar-mode', get label() { return t('日历视图'); } },
  { id: 'calendar-events', get label() { return t('管理事件'); } },
];
function topbarVisibilityItems(tabId: string, hasDocument: boolean, activePane: boolean) {
  return [
    ...topbarItems.filter(
      (item) => item.id !== 'breadcrumb' || (tabId !== CALENDAR_TAB_ID && tabId !== GRAPH_TAB_ID),
    ),
    ...(hasDocument || tabId.startsWith('attachment:') ? [{ id: 'document-status', get label() { return t('文章状态'); } }] : []),
    ...(activePane && extensions.regions['editing-status']
      ? [{ id: 'editing-status', get label() { return t('同步状态'); } }]
      : []),
    ...(tabId === CALENDAR_TAB_ID ? calendarToolItems : []),
    ...(tabId.startsWith('attachment:') && attachments
      ? [{ id: 'attachment-export', get label() { return t('导出附件'); } }]
      : []),
    ...(hasDocument ? documentToolItems : []),
  ].map((item, index, items) => ({ ...item, separatorBefore: items[index - 1]?.id === 'document-status' }));
}
const SETTINGS_TAB_ID = 'view:settings';
const settingsTabView = { id: SETTINGS_TAB_ID, get label() { return t('设置'); }, icon: Settings2, detachable: true };
store.registerViews([...extensionViews, settingsTabView, { id: ASSISTANT_TAB_ID, label: t('助手'), icon: Bot }]);
store.setBeforeWorkspaceChange(async () => {
  if (!(await auxiliaryWindows.closeAll())) throw new Error(t('还有未保存的修改，请先处理保存错误。'));
  await assistant.settle(); await inlineRunner.settle(); await agentInbox.settle();
});
const activeExtensionView = computed(() =>
  extensionViews.find((view) => view.id === store.activeId),
);
const viewActions = Object.fromEntries(
  extensionViews.map((view) => [
    view.id,
    {
      open: () => {
        openExtensionView(view.id);
        if (compactPanes.value) sidebar.value = false;
      },
      showSidebar: () => {
        selectModule(view.id);
        sidebar.value = true;
      },
    },
  ]),
);
const editing = extensions.editing;
const workbenchSession = retainWorkbenchSession(store, () => {
  void extensions.disconnect().catch(store.report);
  assistant.stop();
  inlineRunner.stop();
  void editing.dispose().catch(store.report);
  store.dispose();
});
let unmounted = false;
assistant.setManaged((id) => editing.isManaging(id));
inlineRunner.setManaged((id) => editing.isManaging(id));
const systemSyncPanel = ref(false);
const workspaceSync = createWorkspaceSync(store, extensions);
function openSystemSync(event?: Event) {
  const id = (event as CustomEvent | undefined)?.detail?.workspaceId;
  if (!native || mobile || !store.workspace || store.isWeb || (id && id !== store.workspace.id)) return;
  workspaceMenu.value = false;
  systemSyncPanel.value = true;
  void workspaceSync.action('status');
}
let syncTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { window.addEventListener(syncEvent, openSystemSync); if (native && !mobile) syncTimer = setInterval(() => { void workspaceSync.tick(); }, 30_000); });
onBeforeUnmount(() => { window.removeEventListener(syncEvent, openSystemSync); clearInterval(syncTimer); workspaceSync.reset(); });
watch(() => store.workspace?.id, () => { systemSyncPanel.value = false; workspaceSync.reset(); });
const extensionActions: WorkbenchActions = {
  closeMenus: () => {
    workspaceMenu.value = false;
    menu.value = false;
  },
  createWorkspace: () => { void createNewWorkspace(); },
  openSettings,
  showDiff: (value) => {
    selectedDiff.value = value;
  },
};
const updates = useUpdatesStore();
const updateLock = computed(() => ['downloading', 'installing'].includes(updates.state.phase));
const historyPanel = ref(false);
const importPanel = ref(false);
const templateLibraryOpen = ref(false);
const templatePaneId = ref('');
const templateSource = ref('');
const templateInitialization = shallowRef<{ title: string; apply: (content: string) => void }>();
watch(templateLibraryOpen, opened => { if (!opened) templateInitialization.value = undefined; });
watch(() => [store.workspace?.id, store.workspace?.path, store.panes.find(pane => pane.id === templatePaneId.value)?.activeId], () => {
  templateLibraryOpen.value = false;
});
function openTemplateLibrary() {
  menu.value = false;
  workspaceMenu.value = false;
  templatePaneId.value = store.activePaneId;
  templateSource.value = store.active?.content ?? '';
  templateInitialization.value = undefined;
  // Let the captured pane settle before showing the page; the editor stays mounted.
  void nextTick(() => { templateLibraryOpen.value = true; });
}
const importRecords = ref<ImportRecord[]>([]);
function openImport() {
  menu.value = false;
  workspaceMenu.value = false;
  importPanel.value = true;
}
const historyPage = ref<'versions' | 'updates'>('versions');
const agentPanel = ref(false);
const recyclePanel = ref(false);
const navigation = useWorkbenchNavigation(() => store.workspace?.id, isAuxiliaryWindow ? undefined : {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
const { context: navigationContext, module: navigationModule, workspaceView, sidebarView } = navigation;
let personalPlanScope: typeof plans.view = 'all';
// Migrate the former workspace plan mode to the workspace view switcher.
watch([navigationContext, navigationModule], ([context, module]) => {
  if (context === 'workspace' && module === 'plan') navigation.selectWorkspaceView('events');
}, { immediate: true });
function selectContext(context: 'home' | 'workspace') {
  rememberCalendar();
  if (navigationContext.value === 'home') personalPlanScope = plans.view;
  navigation.selectContext(context);
  plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
  restoreCalendar();
  workspaceMenu.value = false;
}
watch(navigationContext, context => { plans.view = context === 'home' ? personalPlanScope : 'workspace'; });
function selectWorkspaceView(id: string) {
  rememberCalendar();
  if (navigationContext.value === 'home') personalPlanScope = plans.view;
  navigation.selectWorkspaceView(id as WorkspaceSidebarView);
  restoreCalendar();
  if (id === 'events') plans.view = 'workspace';
}
function selectModule(id: string) {
  rememberCalendar();
  if (navigationContext.value === 'home') personalPlanScope = plans.view;
  if (id === 'plan' && navigationContext.value === 'workspace') navigation.selectWorkspaceView('events');
  else navigation.selectModule(id);
  restoreCalendar();
  plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
  sidebar.value = true;
}
watch(() => store.activePluginSidebar, key => { if (key) { sidebarView.value = 'plugin-views'; sidebar.value = true; } });
watch(() => store.pluginSettingsRequest, request => { if (request) openSettings(request.key); });
const homeContent = ref<string>();
const homeExtension = computed(() => extensionViews.find(view => view.id === homeContent.value));
const calendarDate = ref(new Date());
const sidebarCalendarDate = ref(new Date());
const calendarScope = ref<typeof plans.view>(plans.view);
const calendarMode = ref<CalendarViewMode>('week');
const calendarModeOpen = ref(false);
const calendarLocations = new Map<string, { date: Date; mode: CalendarViewMode }>();
function calendarLocationKey() { return navigationContext.value === 'home' ? 'home-plan' : store.workspace?.id ?? ''; }
function rememberCalendar(key?: string) {
  if (key === undefined && !['workspace', 'plan'].includes(navigationModule.value)) return;
  calendarLocations.set(key ?? calendarLocationKey(), { date: new Date(sidebarCalendarDate.value), mode: calendarMode.value });
}
function restoreCalendar(key?: string) {
  if (key === undefined && !['workspace', 'plan'].includes(navigationModule.value)) return;
  key ??= calendarLocationKey();
  const saved = calendarLocations.get(key);
  sidebarCalendarDate.value = saved ? new Date(saved.date) : new Date();
}
const calendarModeOptions: { mode: CalendarViewMode; label: string }[] = [
  { mode: 'day', get label() { return t('日'); } },
  { mode: 'four-days', get label() { return t('4 天'); } },
  { mode: 'week', get label() { return t('周'); } },
  { mode: 'month', get label() { return t('月'); } },
  { mode: 'year', get label() { return t('年'); } },
  { mode: 'agenda', get label() { return t('日程'); } },
];
const calendarModeLabel = computed(
  () => calendarModeOptions.find((option) => option.mode === calendarMode.value)?.label ?? t('周'),
);
const calendarPeriod = computed(() => calendarPeriodTitle(calendarDate.value, calendarMode.value));
function moveCalendarPeriod(offset: number) {
  calendarDate.value = shiftCalendarDate(calendarDate.value, calendarMode.value, offset);
}
function selectCalendarMode(mode: CalendarViewMode) {
  calendarMode.value = mode;
  calendarModeOpen.value = false;
}
function showCalendarDay(date: Date) {
  calendarDate.value = date;
  calendarMode.value = 'day';
}
function showCalendarMonth(date: Date) {
  calendarDate.value = date;
  calendarMode.value = 'month';
}
function openCalendar(date?: Date) {
  if (sidebarView.value !== 'events' && navigationModule.value !== 'plan') selectModule('plan');
  calendarScope.value = plans.view;
  sidebarCalendarDate.value = date ? new Date(date) : sidebarCalendarDate.value;
  calendarDate.value = new Date(sidebarCalendarDate.value);
  if (!store.workspace) homeContent.value = CALENDAR_TAB_ID;
  else store.openCalendarTab();
  if (compactPanes.value) sidebar.value = false;
}
function openExtensionView(id: string) {
  if (navigationContext.value === 'home') personalPlanScope = plans.view;
  rememberCalendar();
  if (extensionViews.find(view => view.id === id)?.sidebar) navigation.openInHome(id);
  else navigation.selectContext('home');
  restoreCalendar();
  if (!store.workspace) homeContent.value = id;
  else store.openViewTab(id);
  if (compactPanes.value) sidebar.value = false;
}
const selectedDiff = ref<{
  title: string;
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}>();
watch(
  () => store.workspace?.id,
  (id, previous) => {
    agentPanel.value = false;
    selectedDiff.value = undefined;
    recyclePanel.value = false;
    if (navigationModule.value === 'workspace') { if (previous) rememberCalendar(previous); restoreCalendar(id); }
    calendarModeOpen.value = false;
    workspaceMenu.value = false;
    settingsPanel.value = false;
    fileContextMenu.value = null;
    selectedEntryIds.value = new Set();
    selectionAnchorId.value = null;
    pendingTreeOpenIds.clear();
    draggedEntry.value = null;
    draggedSelection.value = [];
    dropFolder.value = null;
    optimisticFileMove.value = null;
  },
);
const { workspace, active, activeId, activities, fatal, busy, openingWorkspace } = storeToRefs(store);
const filesPending = computed(() => store.workspaceLoading.files || (startupPending.value && !workspace.value));
const sessionPending = computed(() => filesPending.value || store.workspaceLoading.session);
const switchingWorkspace = computed(() => store.workspaceLoading.files);
if (!native) useDocumentFavicon(() => workspace.value && active.value ? appearanceText(active.value.content, 'icon') : '');
const webPageRouting = !native && (store.isDemo || store.isWeb);
const initialPageRoute = webPageRouting ? parsePageRoute(window.location.pathname) : null;
const pageRouteStateKey = '__tanoPageRoute';
const pageRouteIndex = ref(0);
const pageRouteMax = ref(0);
let pageRouteReady = false;
let applyingPageRoute = false;
let initialPageRouteSuperseded = false;

function routeStateIndex() {
  const { window } = activeWindow.value;
  const value = (window.history.state as Record<string, unknown> | null)?.[pageRouteStateKey];
  return value &&
    typeof value === 'object' &&
    Number.isInteger((value as { index?: unknown }).index)
    ? Math.max(0, (value as { index: number }).index)
    : 0;
}

function initializePageHistory() {
  if (!webPageRouting) return;
  pageRouteIndex.value = routeStateIndex();
  pageRouteMax.value = pageRouteIndex.value;
  const state =
    window.history.state && typeof window.history.state === 'object'
      ? { ...window.history.state }
      : {};
  window.history.replaceState(
    { ...state, [pageRouteStateKey]: { index: pageRouteIndex.value } },
    '',
    window.location.href,
  );
}

function currentPageRoute() {
  const currentWorkspace = workspace.value;
  if (currentWorkspace && isTableTab(activeId.value)) return pageRoutePath(currentWorkspace.id, activeId.value);
  const pluginView = store.pluginViews.find(view => view.key === activeId.value && view.location === 'tab');
  if (currentWorkspace && pluginView) return pageRoutePath(currentWorkspace.id, pluginView.key);
  const currentFile = currentWorkspace?.files.find(
    (file) => file.id === activeId.value && file.kind === 'file' && isMarkdown(file.path),
  );
  return currentWorkspace && currentFile
    ? pageRoutePath(currentWorkspace.id, currentFile.id)
    : null;
}

function writePageRoute(replace: boolean) {
  const path = currentPageRoute() ??
    (!workspace.value && parsePageRoute(window.location.pathname) ? '/' : null);
  if (!webPageRouting || !path) return;
  const url = new URL(window.location.href);
  if (url.pathname === path) return;
  const nextIndex = replace ? pageRouteIndex.value : pageRouteIndex.value + 1;
  const state =
    window.history.state && typeof window.history.state === 'object'
      ? { ...window.history.state }
      : {};
  const nextState = { ...state, [pageRouteStateKey]: { index: nextIndex } };
  pageRouteIndex.value = nextIndex;
  if (!replace) pageRouteMax.value = nextIndex;
  window.history[replace ? 'replaceState' : 'pushState'](
    nextState,
    '',
    `${path}${url.search}${url.hash}`,
  );
}

function canNavigatePage(direction: -1 | 1) {
  if (native) return store.canNavigateHistory(direction);
  if (!webPageRouting || busy.value) return false;
  return direction < 0 ? pageRouteIndex.value > 0 : pageRouteIndex.value < pageRouteMax.value;
}

function navigatePage(direction: -1 | 1) {
  const { window } = activeWindow.value;
  if (!canNavigatePage(direction)) return;
  if (native) { void store.navigateHistory(direction); return; }
  window.history[direction < 0 ? 'back' : 'forward']();
}

watch([() => workspace.value?.id, activeId], () => {
  if (pageRouteReady && !applyingPageRoute) writePageRoute(false);
});

async function applyPageRoute(fromHistory = false) {
  if (!webPageRouting) return;
  const route = parsePageRoute(window.location.pathname);
  pageRouteIndex.value = routeStateIndex();
  pageRouteMax.value = Math.max(pageRouteMax.value, pageRouteIndex.value);
  if (!route) {
    if (fromHistory && window.location.pathname === '/' && workspace.value) {
      applyingPageRoute = true;
      try { await leaveWorkspace(); }
      finally { applyingPageRoute = false; }
    }
    writePageRoute(true);
    return;
  }
  applyingPageRoute = true;
  try {
    if (workspace.value?.id !== route.workspaceId) await store.openWorkspace(route.workspaceId);
    if (workspace.value?.id !== route.workspaceId) {
      store.report(t('链接中的工作区不存在或你已失去访问权限'));
    } else if (isTableTab(route.fileId)) {
      await store.openDataTable(route.fileId === TABLES_TAB_ID ? undefined : tableFileId(route.fileId));
    } else if (route.fileId.startsWith('plugin:')) {
      const view = store.pluginViews.find(view => view.key === route.fileId && view.location === 'tab');
      if (view) store.openPluginView(view.pluginId, view.id);
      else store.report(t('链接中的插件视图尚未安装或已停用'));
    } else {
      const file = workspace.value.files.find(
        (entry) => entry.id === route.fileId && entry.kind === 'file' && isMarkdown(entry.path),
      );
      if (!file) store.report(t('链接中的文档不存在或已被删除'));
      else if (activeId.value !== file.id) await store.openFile(file);
    }
  } finally {
    applyingPageRoute = false;
  }
  writePageRoute(true);
}

function handlePagePopState() {
  void applyPageRoute(true).catch(store.report);
}

watch(activeId, id => { calendarModeOpen.value = false; if (id === ASSISTANT_TAB_ID && compactPanes.value) sidebar.value = false; });
watch(() => [store.activeId, assistant.loading, store.busy] as const, ([id, loading, switching]) => {
  if (id === ASSISTANT_TAB_ID && !loading && !switching) openAssistantPage(store, assistant);
});
const sidebar = ref(!isAuxiliaryWindow && !compactPanes.value);
watch(activeExtensionView, view => {
  if (view?.collapseSidebarOnOpen) sidebar.value = false;
}, { immediate: true });
const mainColumn = ref<HTMLElement>();
watch(compactPanes, (compact) => { if (compact) sidebar.value = false; });
const sidebarWidth = ref<number | null>(null);
const resizingSidebar = ref(false);
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_COLLAPSE_WIDTH = SIDEBAR_MIN_WIDTH - 80;
let sidebarResizePointerId: number | null = null;
let sidebarResizeCaptureElement: HTMLElement | null = null;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 0;
let sidebarSnapRestoreWidth: number | null = null;
let preferredSidebarWidth: number | null = null;
watch(sidebar, (open) => {
  // Restore on reopening so the closing animation keeps its current width.
  if (open && sidebarSnapRestoreWidth !== null) {
    setSidebarWidth(sidebarSnapRestoreWidth);
    sidebarSnapRestoreWidth = null;
  }
});
const appearanceIcons = new FileIconRegistry();
provide(fileIconRegistryKey, appearanceIcons);
const appearanceController = new AppearanceController(appearanceIcons, useWorkbenchRuntime().plugins?.principal ?? 'device', {
  getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value),
});
const appearance = appearanceController.state;
watch([() => store.workspace?.id ?? '', () => store.installedPlugins, () => store.installedPluginWorkspace], ([id, installed, loadedFor]) => {
  appearanceController.sync(id, id === loadedFor ? installed : []);
}, { immediate: true, deep: true });
onBeforeUnmount(() => appearanceController.dispose());
const theme = computed<ThemePreference>({ get: () => appearance.value.mode,
  set: mode => appearanceController.select({ workspaceId: appearance.value.workspaceId, kind: 'mode', id: mode }) });
const onAppearanceStorage = (event: StorageEvent) => appearanceController.refreshPreferences(event.key);
onMounted(() => window.addEventListener('storage', onAppearanceStorage));
// Delegated press/hover springs for every button in the workbench and its
// teleported surfaces (dialogs, menus, settings).
let disposeInteractionMotion: (() => void) | undefined;
onMounted(() => { disposeInteractionMotion = installInteractionMotion(); });
onBeforeUnmount(() => disposeInteractionMotion?.());
onBeforeUnmount(() => window.removeEventListener('storage', onAppearanceStorage));
const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
const onSystemThemeChange = () => {
  if (theme.value === 'system') applyTheme('system');
};
applyTheme(theme.value);
onMounted(() => systemThemeMedia?.addEventListener('change', onSystemThemeChange));
onBeforeUnmount(() => systemThemeMedia?.removeEventListener('change', onSystemThemeChange));
function readPreference(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(`tano.preference.${key}`);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}
function savePreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(`tano.preference.${key}`, String(value));
  } catch {
    // The setting still works for this session when device storage is unavailable.
  }
}
function readFontSizePreference(key: string, fallback: number): number {
  const { window } = activeWindow.value;
  try {
    const value = Number(window.localStorage.getItem(`tano.preference.${key}`));
    return Number.isInteger(value) && value >= 12 && value <= 24 ? value : fallback;
  } catch {
    return fallback;
  }
}
function saveFontSizePreference(key: string, value: number) {
  const { window } = activeWindow.value;
  try {
    window.localStorage.setItem(`tano.preference.${key}`, String(value));
  } catch {
    // The setting still works for this session when device storage is unavailable.
  }
}
function readTextPreference(key: string): string {
  try {
    return window.localStorage.getItem(`tano.preference.${key}`) ?? '';
  } catch {
    return '';
  }
}
function saveTextPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(`tano.preference.${key}`, value);
  } catch {
    // The setting still works for this session when device storage is unavailable.
  }
}
const savedSidebarWidth = Number(readTextPreference('sidebarWidth'));
if (
  !isAuxiliaryWindow &&
  Number.isInteger(savedSidebarWidth) &&
  savedSidebarWidth >= SIDEBAR_MIN_WIDTH &&
  savedSidebarWidth <= SIDEBAR_MAX_WIDTH
) {
  setSidebarWidth(savedSidebarWidth, true);
}
function sidebarWidthLimit() {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, viewportWidth.value - (viewportWidth.value <= 700 ? 48 : 320)),
  );
}
function defaultSidebarWidth() {
  return viewportWidth.value >= 1600 ? 264 : viewportWidth.value <= 1180 ? 232 : 252;
}
function setSidebarWidth(width: number, preservePreference = false) {
  const { document } = mainWindow;
  const requestedWidth = Math.round(width);
  sidebarWidth.value = Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarWidthLimit(), requestedWidth));
  preferredSidebarWidth = preservePreference ? requestedWidth : sidebarWidth.value;
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth.value}px`);
}
function currentSidebarWidth() {
  const { document } = mainWindow;
  return document.querySelector<HTMLElement>('.sidebar')?.getBoundingClientRect().width ?? defaultSidebarWidth();
}
function startSidebarResize(event: PointerEvent) {
  if (compactPanes.value || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  sidebarResizePointerId = event.pointerId;
  sidebarResizeStartX = event.clientX;
  sidebarResizeStartWidth = currentSidebarWidth();
  resizingSidebar.value = true;
  // The shell stays visible after snapping the sidebar closed, so the same
  // gesture can still expand it again before the pointer is released.
  sidebarResizeCaptureElement = handle.closest<HTMLElement>('.app-shell')!;
  sidebarResizeCaptureElement.setPointerCapture(event.pointerId);
}
function moveSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarResizePointerId) return;
  const width = sidebarResizeStartWidth + event.clientX - sidebarResizeStartX;
  if (width <= SIDEBAR_COLLAPSE_WIDTH) {
    sidebarSnapRestoreWidth = sidebarResizeStartWidth;
    sidebar.value = false;
    workspaceMenu.value = false;
  } else if (sidebar.value || width >= SIDEBAR_MIN_WIDTH) {
    sidebarSnapRestoreWidth = null;
    sidebar.value = true;
    setSidebarWidth(width);
  }
}
function finishSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarResizePointerId) return;
  sidebarResizePointerId = null;
  resizingSidebar.value = false;
  if (sidebarResizeCaptureElement?.hasPointerCapture(event.pointerId))
    sidebarResizeCaptureElement.releasePointerCapture(event.pointerId);
  sidebarResizeCaptureElement = null;
  const width = sidebarSnapRestoreWidth ?? sidebarWidth.value;
  if (width !== null) saveTextPreference('sidebarWidth', String(width));
}
function resizeSidebarWithKeyboard(event: KeyboardEvent) {
  if (compactPanes.value) return;
  const width = sidebarWidth.value ?? currentSidebarWidth();
  const nextWidth =
    event.key === 'ArrowLeft'
      ? width - 10
      : event.key === 'ArrowRight'
        ? width + 10
        : event.key === 'Home'
          ? SIDEBAR_MIN_WIDTH
          : event.key === 'End'
            ? sidebarWidthLimit()
            : null;
  if (nextWidth === null) return;
  event.preventDefault();
  setSidebarWidth(nextWidth);
  saveTextPreference('sidebarWidth', String(sidebarWidth.value));
}
function constrainSidebarToViewport() {
  viewportWidth.value = window.innerWidth;
  if (preferredSidebarWidth !== null) setSidebarWidth(preferredSidebarWidth, true);
}
const defaultSource = ref(readPreference('defaultSource', false));
const revealMarkdown = ref(readPreference('revealMarkdown', true));
const toolbarMode = ref(parseToolbarMode(readTextPreference('toolbarMode')));
const shortcuts = ref(readShortcutBindings());
watch(shortcuts, saveShortcutBindings, { deep: true });
function syncShortcutPreferences(event: StorageEvent) {
  if (event.key === shortcutPreferenceKey || event.key === null) shortcuts.value = readShortcutBindings();
}
onMounted(() => window.addEventListener('storage', syncShortcutPreferences));
onBeforeUnmount(() => window.removeEventListener('storage', syncShortcutPreferences));
function shortcutHint(id: ShortcutId) { const first = shortcutKeys(shortcuts.value[id])[0]; return first ? shortcutLabel(first) : ''; }
provide('tano-shortcut-bindings', shortcuts);
const routeConfiguredEditorShortcut = configuredEditorShortcuts(() => shortcuts.value,
  () => !settingsPanel.value && !modal.value && !commandPaletteOpened.value && !updateLock.value,
  () => paneEditorScrolls.get(store.activePaneId), id => {
    const action = ({ deleteBlock: 'delete', moveBlockUp: 'move-up', moveBlockDown: 'move-down', indentBlock: 'indent', outdentBlock: 'outdent' } as Record<string, string>)[id];
    if (action) paneEditors.get(store.activePaneId)?.blockShortcut(action);
  });
// Register during setup, before child editors install their native capture handlers.
window.addEventListener('keydown', routeConfiguredEditorShortcut, true);
onBeforeUnmount(() => window.removeEventListener('keydown', routeConfiguredEditorShortcut, true));
watch(toolbarMode, (value) => saveTextPreference('toolbarMode', value));
function syncToolbarPreference(event: StorageEvent) {
  if (event.key === toolbarPreferenceKey || event.key === null)
    toolbarMode.value = parseToolbarMode(event.newValue);
}
onMounted(() => window.addEventListener('storage', syncToolbarPreference));
onBeforeUnmount(() => window.removeEventListener('storage', syncToolbarPreference));
const visualFontChoice = ref<VisualFontChoice>(
  parseVisualFontChoice(readTextPreference('visualFontChoice')),
);
const customFontName = ref(sanitizeCustomFontName(readTextPreference('customFontName')));
const savedSplitFontSettings = readTextPreference('splitFontSettings');
const splitFontSettings = ref(savedSplitFontSettings ? parseSplitFontSettings(savedSplitFontSettings, visualFontChoice.value, customFontName.value) : undefined);
const selectedVisualFontFamily = useEditorFontFamily(() => visualFontChoice.value, () => customFontName.value, () => splitFontSettings.value);
watch(splitFontSettings, value => { if (value) saveTextPreference('splitFontSettings', JSON.stringify(value)); }, { deep: true });
watch(visualFontChoice, (value) => saveTextPreference('visualFontChoice', value));
watch(customFontName, (value) => saveTextPreference('customFontName', value));
const visualFontSize = ref(readFontSizePreference('visualFontSize', 16));
const sourceFontSize = ref(readFontSizePreference('sourceFontSize', 14));
watch(visualFontSize, (value) => saveFontSizePreference('visualFontSize', value));
watch(sourceFontSize, (value) => saveFontSizePreference('sourceFontSize', value));
const showPageTitle = ref(readPreference('showPageTitle', true));
const showAllLineNumbers = ref(readPreference('showAllLineNumbers', false));
watch(showAllLineNumbers, (value) => savePreference('showAllLineNumbers', value));
watch(showPageTitle, (value) => savePreference('showPageTitle', value));
const showDocumentProperties = ref(readPreference('showDocumentProperties', true));
watch(showDocumentProperties, (value) => savePreference('showDocumentProperties', value));
const showDocumentDiscussion = ref(readPreference('showDocumentDiscussion', true));
watch(showDocumentDiscussion, (value) => savePreference('showDocumentDiscussion', value));
const limitPageWidth = computed(() => {
  const documentId = active.value?.id;
  return !documentId || store.capabilities.pageWidthLimits[documentId] !== false;
});
const pageWidthWritable = computed(
  () =>
    !!workspace.value &&
    !workspace.value.readOnly &&
    !active.value?.missing &&
    !store.capabilityError,
);
function setLimitPageWidth(value: boolean) {
  const document = active.value;
  if (!document || !pageWidthWritable.value) return;
  void store.updateCapabilities({ pageWidth: { documentId: document.id, limited: value } });
}
try {
  window.localStorage.removeItem('tano.preference.tableSource');
  window.localStorage.removeItem('tano.preference.renderMath');
  window.localStorage.removeItem('tano.preference.showMathSource');
} catch {
  // Device storage may be unavailable in restricted browser contexts.
}
function readSelectionWrapping() {
  try { return normalizeSelectionWrapping(JSON.parse(readTextPreference('selectionWrapping') || 'null')); }
  catch { return normalizeSelectionWrapping(); }
}
function readMarkdownAutocomplete() {
  try { return normalizeMarkdownAutocomplete(JSON.parse(readTextPreference('markdownAutocomplete') || 'null')); } catch { return normalizeMarkdownAutocomplete(); }
}
function readChineseInput() {
  let value: unknown, legacy: unknown;
  try { value = JSON.parse(readTextPreference('chineseInput') || 'null'); } catch { /* Use safe defaults. */ }
  try { legacy = JSON.parse(readTextPreference('selectionWrapping') || 'null'); } catch { /* No legacy preference. */ }
  return normalizeChineseInput(value, legacy);
}
const editorPreferences = ref<EditorPreferences>({
  copyFormat: normalizeCopyFormat(readTextPreference('copyFormat')),
  autoSpacing: readPreference('autoSpacing', defaultEditorPreferences.autoSpacing ?? false),
  previewMathWhileEditing: readPreference(
    'previewMathWhileEditing',
    defaultEditorPreferences.previewMathWhileEditing,
  ),
  previewMermaidWhileEditing: readPreference('previewMermaidWhileEditing', defaultEditorPreferences.previewMermaidWhileEditing ?? true),
  folding: readPreference('folding', defaultEditorPreferences.folding),
  blankBlockAiShortcut: readPreference('blankBlockAiShortcut', defaultEditorPreferences.blankBlockAiShortcut),
  selectionWrapping: readSelectionWrapping(),
  chineseInput: readChineseInput(),
  markdownAutocomplete: readMarkdownAutocomplete(),
  smoothCaret: readPreference('smoothCaret', true),
  typingMotion: readPreference('typingMotion', true),
  blockMotion: readPreference('blockMotion', true),
  blockResizeMotion: readPreference('blockResizeMotion', true),
  sourceRevealMotion: readPreference('sourceRevealMotion', true),
  reduceInterfaceMotion: readPreference('reduceInterfaceMotion', false),
});
watch(
  editorPreferences,
  (preferences) => {
    saveTextPreference('copyFormat', normalizeCopyFormat(preferences.copyFormat));
    savePreference('autoSpacing', preferences.autoSpacing ?? false);
    savePreference('previewMathWhileEditing', preferences.previewMathWhileEditing);
    savePreference('previewMermaidWhileEditing', preferences.previewMermaidWhileEditing !== false);
    savePreference('folding', preferences.folding);
    savePreference('blankBlockAiShortcut', preferences.blankBlockAiShortcut);
    saveTextPreference('selectionWrapping', JSON.stringify(normalizeSelectionWrapping(preferences.selectionWrapping)));
    saveTextPreference('markdownAutocomplete', JSON.stringify(normalizeMarkdownAutocomplete(preferences.markdownAutocomplete)));
    saveTextPreference('chineseInput', JSON.stringify(normalizeChineseInput(preferences.chineseInput)));
    savePreference('smoothCaret', preferences.smoothCaret !== false);
    savePreference('typingMotion', preferences.typingMotion !== false);
    savePreference('blockMotion', preferences.blockMotion !== false);
    savePreference('blockResizeMotion', preferences.blockResizeMotion !== false);
    savePreference('sourceRevealMotion', preferences.sourceRevealMotion !== false);
    savePreference('reduceInterfaceMotion', preferences.reduceInterfaceMotion === true);
  },
  { deep: true },
);
// `data-motion="reduced"` is honoured by the motion helpers and the CSS tokens,
// exactly like the operating-system "reduce motion" setting.
watch(
  () => editorPreferences.value.reduceInterfaceMotion === true,
  (reduced) => {
    if (reduced) document.documentElement.dataset.motion = 'reduced';
    else if (document.documentElement.dataset.motion === 'reduced') delete document.documentElement.dataset.motion;
  },
  { immediate: true },
);
const hoverOutline = window.matchMedia('(hover: hover)').matches;
const sourceModes = shallowReactive<Record<string, boolean>>({});
const paneSource = (id: string) => sourceModes[id] ?? defaultSource.value;
const pendingModeViewports = new Map<string, { fileId: string; source: boolean; viewport: ModeViewport; focus?: boolean }>();
function setPaneSource(id: string, value: boolean, previous = paneSource(id)) {
  if (previous === value) return;
  for (const pane of store.panes.filter(pane => pane.activeId === id)) {
    const target = previous ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
    const scroll = paneScrolls.get(pane.id);
    const pending = pendingModeViewports.get(pane.id);
    const viewport = (target && scroll ? captureModeViewport(target, scroll) : null)
      ?? (pending?.fileId === id ? pending.viewport : null);
    if (viewport) pendingModeViewports.set(pane.id, { fileId: id, source: value, viewport });
  }
  sourceModes[id] = value;
  if (store.documentForTab(id)) recordHelpCompleted('source');
}
const source = computed({
  get: () => paneSource(store.activeId),
  set: (value) => {
    setPaneSource(store.activeId, value);
  },
});
const pageLocked = ref(false);
const workspaceLocked = ref(false);
watch(
  () => workspace.value?.id,
  (id) => { workspaceLocked.value = !!id && readPreference(`workspaceLocked.${id}`, false); },
  { immediate: true },
);
function toggleWorkspaceLock() {
  const id = workspace.value?.id;
  if (!id) return;
  workspaceLocked.value = !workspaceLocked.value;
  savePreference(`workspaceLocked.${id}`, workspaceLocked.value);
}
function pageLockPreferenceKey(workspaceId: string, documentId: string) {
  return `pageLocked.${workspaceId}.${documentId}`;
}
function togglePageLock() {
  const currentWorkspace = workspace.value;
  const document = active.value;
  if (!currentWorkspace || !document || workspaceLocked.value) return;
  pageLocked.value = !pageLocked.value;
  savePreference(pageLockPreferenceKey(currentWorkspace.id, document.id), pageLocked.value);
}
watch(
  [() => workspace.value?.id, activeId],
  ([workspaceId, documentId]) => {
    pageLocked.value =
      !!workspaceId &&
      !!documentId &&
      readPreference(pageLockPreferenceKey(workspaceId, documentId), false);
  },
  { immediate: true },
);
const editorReadonly = computed(
  () =>
    workspaceLocked.value ||
    pageLocked.value ||
    updateLock.value ||
    store.busy ||
    !!workspace.value?.readOnly ||
    !!workspace.value?.files.find((file) => file.id === active.value?.id)?.readOnly ||
    !!active.value?.conflict ||
    editing.activeBusy ||
    !!editing.active?.readOnly,
);
async function renameDocumentTitle(workspaceId: string, id: string, from: string, to: string) {
  if (workspace.value?.id !== workspaceId) throw new Error(t('工作空间已切换，请重新打开文档后重试'));
  if (workspaceLocked.value || updateLock.value || store.busy || workspace.value.readOnly || sessionBlocksFileMutation(id))
    throw new Error(t('当前文档暂时无法重命名'));
  const doc = store.documentForTab(id);
  if (!doc || store.displayPath(doc) !== from) throw new Error(t('文件位置已变化，请重新输入标题'));
  await withFileMutation([id], () => store.rename(doc, to));
}
function sessionBlocksFileMutation(id: string) {
  const documentId = store.documentForTab(id)?.id ?? id;
  return editing.canMutateFile ? !editing.canMutateFile(documentId) : editing.isManaging(documentId);
}
function withFileMutation<T>(ids: string[], mutation: () => Promise<T>): Promise<T> {
  return editing.withFileMutation ? editing.withFileMutation(ids, mutation) : mutation();
}
function fileMutationIds(entries: FileEntry[]): string[] {
  return (workspace.value?.files ?? []).filter(file => file.kind === 'file' && entries.some(entry =>
    entry.id === file.id || (entry.kind === 'directory' && file.path.startsWith(`${entry.path}/`)),
  )).map(file => file.id);
}
watch(
  () => [store.activeId, editing.active?.key] as const,
  ([id, epoch], [previousId, previousEpoch]) => {
    if (id === previousId && epoch !== previousEpoch && !paneSource(id)) {
      const paneId = store.activePaneId;
      const target = paneEditors.get(paneId), scroll = paneScrolls.get(paneId);
      const viewport = target && scroll ? captureModeViewport(target, scroll) : null;
      if (viewport) pendingModeViewports.set(paneId, { fileId: id, source: false, viewport,
        focus: !!scroll?.contains(document.activeElement) && !!document.activeElement?.closest('.ProseMirror') });
    }
    if (epoch && epoch !== 'local') source.value = false;
  },
);
const syntaxIssues = computed(() => unsupportedMarkdown(active.value?.content ?? ''));
const panel = ref<'outline' | 'activity'>('outline');
const showOutline = ref(readPreference('showOutline', true));
const touchOutlineOpen = ref(false);
watch(activeId, () => { touchOutlineOpen.value = false; });
const outlineOnLeft = ref(readPreference('outlineOnLeft', false));
const outlinePinned = ref(readPreference('outlinePinned', false));
const outlineSearchOpen = ref(false);
const outlineAutoCollapse = ref(readPreference('outlineAutoCollapse', false));
watch(outlineAutoCollapse, (enabled) => savePreference('outlineAutoCollapse', enabled));
const outlineSearch = ref('');
const outlineSearchInput = ref<HTMLInputElement>();
watch(showOutline, (visible) => {
  savePreference('showOutline', visible);
  if (!visible) {
    outlineSearchOpen.value = false;
    outlineSearch.value = '';
  } else void nextTick(scheduleActiveHeading);
});
watch(outlineOnLeft, (left) => savePreference('outlineOnLeft', left));
watch(outlinePinned, (pinned) => savePreference('outlinePinned', pinned));
const menu = ref(false);
const referenceGraphOpened = ref(false);
const referenceGraphTarget = shallowRef<Pick<OpenDocument, 'id' | 'path'>>();
const referenceGraphAnchor = shallowRef<HTMLElement>();
watch(
  () => [active.value?.id, active.value?.path] as const,
  ([id, path]) => {
    // Keep the latest document's graph when switching to a non-document tab.
    if (referenceGraphTarget.value && id && path) referenceGraphTarget.value = { id, path };
  },
);
const exportBusy = ref(false);
const printBusy = ref(false);
const documentMenuButton = ref<HTMLButtonElement>();
const documentMenuElement = ref<HTMLElement>();
const workspaceMenu = ref(false);
const workspaceEntryContextMenu = ref<{ item: WorkspaceEntry; x: number; y: number } | null>(null);
const workspaceEntryContextMenuElement = ref<HTMLElement>();
let workspaceEntryContextTrigger: HTMLElement | null = null;
const fileContextMenu = ref<{ file: FileEntry; x: number; y: number } | null>(null);
const fileMetadataTarget = ref<{ fileId: string; workspaceId: string } | null>(null);
const directoryContextMenu = ref<{ parent: string; x: number; y: number } | null>(null);
const pageContextMenu = ref<{ x: number; y: number } | null>(null);
const pageContextMenuElement = ref<HTMLElement>();
const outlineContextMenu = ref<{ x: number; y: number } | null>(null);
const outlineContextMenuElement = ref<HTMLElement>();
const selectedEntryIds = ref<Set<string>>(new Set());
const selectionAnchorId = ref<string | null>(null);
const pendingTreeOpenIds = new Set<string>();
const selectedEntries = computed(
  () => workspace.value?.files.filter((entry) => selectedEntryIds.value.has(entry.id)) ?? [],
);
watch(
  () => workspace.value?.files,
  (files, previousFiles) => {
    const available = new Set(files?.map((file) => file.id));
    const hadSelection = selectedEntryIds.value.size > 0;
    selectedEntryIds.value = new Set([...selectedEntryIds.value].filter((id) => available.has(id)));
    if (selectionAnchorId.value && !available.has(selectionAnchorId.value))
      selectionAnchorId.value = null;
    if (
      !selectedEntryIds.value.size &&
      activeId.value &&
      available.has(activeId.value) &&
      (hadSelection || !previousFiles?.some((file) => file.id === activeId.value))
    ) {
      selectedEntryIds.value = new Set([activeId.value]);
      selectionAnchorId.value = activeId.value;
    }
  },
);
function selectActiveFileInTree() {
  const activeFileId = activeId.value.startsWith('table:') ? tableFileId(activeId.value) : activeId.value;
  const id = folderRowId(activeFileId);
  const available = !!id && workspace.value?.files.some((file) => file.id === id);
  selectedEntryIds.value = available ? new Set([id]) : new Set();
  selectionAnchorId.value = available ? id : null;
}
const contextEntries = computed(() => (fileContextMenu.value ? selectedEntries.value : []));
const multipleContextEntries = computed(() => contextEntries.value.length > 1);
const draggedEntry = ref<{ file: FileEntry; workspaceId: string } | null>(null);
const draggedSelection = ref<FileEntry[]>([]);
const tabFileDrag = computed(() =>
  draggedEntry.value
    ? {
        workspaceId: draggedEntry.value.workspaceId,
        ids: draggedSelection.value.map((file) => file.id),
      }
    : undefined,
);
const dropFolder = ref<string | null>(null);
const moveBusy = ref(false);
const optimisticFileMove = ref<{ workspaceId: string; changes: FileMovePreview[] } | null>(null);
const treeFiles = computed(() => {
  const files = (workspace.value?.files ?? []).filter(
    (file) => !isWorkspaceInternalPath(file.path),
  );
  const preview = optimisticFileMove.value;
  return preview && workspace.value?.id === preview.workspaceId
    ? applyFileMovePreview(files, preview.changes)
    : files;
});
const fileTree = ref<InstanceType<typeof FileTree>>();
const revealedHomeId = ref('');
async function openBreadcrumbDirectory(path: string, newTab = false) {
  const home = folderHomes.value.get(path);
  if (home) await openEntry(home, newTab);
  else await store.openDirectory(path, { newTab });
  if (compactPanes.value) sidebar.value = false;
}
const folderHomes = computed(() => indexFolderHomes(treeFiles.value, store.workspaceSettings.folderHomeFileName));
const homeFolderIds = computed(() => {
  const ids = new Map<string, string>();
  for (const folder of treeFiles.value) {
    const home = folder.kind === 'directory' && folderHomes.value.get(folder.path);
    if (home) ids.set(home.id, folder.id);
  }
  return ids;
});
function folderRowId(id: string) {
  return id === revealedHomeId.value ? id : homeFolderIds.value.get(id) ?? id;
}
watch(() => [workspace.value?.id, store.workspaceSettings.folderHomeFileName], () => { revealedHomeId.value = ''; });
watch([homeFolderIds, revealedHomeId], () => {
  selectedEntryIds.value = new Set([...selectedEntryIds.value].map(folderRowId));
  if (selectionAnchorId.value) selectionAnchorId.value = folderRowId(selectionAnchorId.value);
});
const contextFolderHome = computed(() => fileContextMenu.value?.file.kind === 'directory'
  ? folderHomes.value.get(fileContextMenu.value.file.path) : undefined);
function folderConversionIssue(file: FileEntry, kind: FolderConversionKind) {
  if (!store.canConvertFolderDocuments) return t('当前存储适配器尚不支持安全的文档与文件夹转换');
  if (store.folderConversionBusy) return t('正在转换文档，请稍候');
  try { planFolderConversion(treeFiles.value, file, store.workspaceSettings.folderHomeFileName, kind); return ''; }
  catch (error) { return t(error instanceof Error ? error.message : String(error)); }
}
async function convertDocumentStructure(kind: FolderConversionKind) {
  const file = fileContextMenu.value?.file;
  closeFileContextMenu();
  if (!file) return;
  try {
    const created = await store.convertDocumentStructure(file, kind);
    if (created && kind === 'child') startTreeRename(created);
  } catch (error) { store.report(error); }
}
async function folderHomeContextAction(showFile: boolean) {
  const home = contextFolderHome.value;
  if (!home) return;
  const hideFile = showFile && revealedHomeId.value === home.id;
  closeFileContextMenu(hideFile);
  if (showFile) {
    if (hideFile) {
      revealedHomeId.value = '';
      return;
    }
    revealedHomeId.value = home.id;
    selectedEntryIds.value = new Set([home.id]);
    selectionAnchorId.value = home.id;
  } else await openTreeEntry(home);
}
const treeDocumentIcons = computed(() => Object.fromEntries(
  [
    ...store.documents.map(doc => [doc.id, appearanceText(doc.content, 'icon')]),
    ...store.dataTableRecords.map(record => [record.fileId, record.draft.icon ?? '']),
  ],
));
let documentIconReads: Promise<void> = Promise.resolve();
function loadTreeDocumentIcon(file: FileEntry, signal: AbortSignal): Promise<string> {
  const expected = workspace.value && { id: workspace.value.id, path: workspace.value.path };
  // Join the filesystem queue one read at a time so sidebar work cannot hold up opening a page.
  const read = documentIconReads.then(async () => {
    if (signal.aborted || !expected || workspace.value?.id !== expected.id || workspace.value.path !== expected.path) return '';
    const content = await store.readGraphDocument(expected, { id: file.id });
    return appearanceText(content, 'icon');
  });
  documentIconReads = read.then(() => {}, () => {});
  return read;
}
const managedFilePaths = computed(
  () =>
    workspace.value?.files
      .filter((entry) => entry.kind === 'file' && sessionBlocksFileMutation(entry.id))
      .map((entry) => entry.path) ?? [],
);
let fileContextTrigger: HTMLElement | null = null;
const treeRename = ref<{ fileId: string; workspaceId: string } | null>(null);
watch(() => workspace.value?.id, () => {
  treeRename.value = null;
  closeWorkspaceEntryContextMenu();
});
const settingsPanel = ref(false);
const commandPaletteOpened = ref(false);
const workbenchCommands = computed<WorkbenchCommand[]>(() => {
  const hasDocument = !!active.value;
  const writableWorkspace = !!workspace.value && !workspace.value.readOnly && !busy.value && !updateLock.value;
  const standardEditor = hasDocument && !editing.active && !editing.activeBusy;
  const editable = standardEditor && !editorReadonly.value && !active.value?.missing;
  return [
    { id: 'workbench.search', category: t('文档'), get label() { return t('查找文档'); }, shortcut: shortcuts.value.findDocument, available: !busy.value, run: () => showModal('search') },
    { id: 'workbench.open', category: t('文档'), get label() { return t('打开文档'); }, shortcut: shortcuts.value.openDocument, available: !busy.value, run: () => showModal('newTab') },
    { id: 'workbench.new', category: t('文档'), get label() { return t('新建文档'); }, shortcut: shortcuts.value.newDocument, available: writableWorkspace, run: createNewDocument },
    { id: 'workbench.table.new', category: t('数据表'), get label() { return t('新建数据表'); }, keywords: t('table spreadsheet 表格'), available: writableWorkspace, run: () => store.createDataTable().catch(store.report) },
    { id: 'workbench.table.parts', category: t('数据表'), get label() { return t('新建配件选择表'); }, available: writableWorkspace, run: () => store.createDataTable('parts').catch(store.report) },
    { id: 'workbench.save', category: t('文档'), get label() { return t('立即保存'); }, shortcut: shortcuts.value.save, available: hasDocument && !busy.value && !updateLock.value, run: () => store.flush() },
    { id: 'workbench.saveAs', category: t('文档'), get label() { return t('另存副本'); }, available: standardEditor && writableWorkspace, run: () => showModal('saveAs') },
    { id: 'workbench.folder', category: t('文档'), get label() { return t('新建文件夹'); }, available: writableWorkspace, run: () => createNewEntry('folder') },
    { id: 'workbench.import', category: t('文档'), get label() { return t('导入文档'); }, available: writableWorkspace, run: openImport },
    { id: 'workbench.templates', category: t('文档'), get label() { return t('文档模板'); }, available: writableWorkspace, run: openTemplateLibrary },
    ...(['markdown', 'docx', 'pdf', 'html', 'png'] as const).map(format => ({
      id: `workbench.export.${format}`, category: t('导出'), label: ({ markdown: 'Markdown', docx: 'Word', pdf: 'PDF', html: 'HTML', png: t('图片') })[format],
      keywords: format, available: hasDocument && !exportBusy.value, run: () => exportDocument(format),
    })),
    { id: 'workbench.print', category: t('文档'), get label() { return t('打印文档'); }, shortcut: shortcuts.value.print, available: hasDocument && !printBusy.value, run: printActiveDocument },
    { id: 'workbench.find', category: t('编辑'), get label() { return t('页内搜索'); }, shortcut: shortcuts.value.pageSearch, available: standardEditor, run: () => openPaneSearch() },
    { id: 'workbench.replace', category: t('编辑'), get label() { return t('查找与替换'); }, shortcut: shortcuts.value.pageReplace, available: editable, run: () => openPaneSearch(store.activePaneId, true) },
    { id: 'workbench.undo', category: t('编辑'), get label() { return t('撤销'); }, available: editable && documentUndoAvailable.value, run: undoDocument },
    { id: 'workbench.redo', category: t('编辑'), get label() { return t('重做'); }, available: editable && documentRedoAvailable.value, run: redoDocument },
    ...editorPaletteCommands({ editable: editable && !!editor.value, source: source.value,
      context: paneSelections[store.activePaneId] ?? defaultSelectionContext, features: store.capabilities.features,
      run: (name, value) => editor.value?.command(name, value) }),
    { id: 'workbench.source', category: t('视图'), label: source.value ? t('返回可视化编辑') : t('切换源码模式'), shortcut: shortcuts.value.toggleSource, available: standardEditor, keywords: 'Markdown source', run: () => { source.value = !source.value; } },
    { id: 'workbench.markdown-reveal', category: t('视图'), get label() { return t('光标展开源码'); }, shortcut: shortcuts.value.toggleMarkdownReveal, available: standardEditor && !source.value, keywords: 'Markdown source cursor', run: () => { revealMarkdown.value = !revealMarkdown.value; } },
    { id: 'workbench.assistant', category: t('视图'), get label() { return t('打开或关闭同页助手'); }, shortcut: shortcuts.value.toggleAssistant, available: !!workspace.value && assistant.available, run: toggleAssistant },
    { id: 'workbench.reading', category: t('视图'), label: pageLocked.value ? t('退出阅读模式') : t('进入阅读模式'), available: hasDocument && !workspaceLocked.value, keywords: t('锁定页面 解锁'), run: togglePageLock },
    { id: 'workbench.width', category: t('视图'), label: limitPageWidth.value ? t('展开页面全宽') : t('限制页面宽度'), available: hasDocument && pageWidthWritable.value, run: () => setLimitPageWidth(!limitPageWidth.value) },
    { id: 'workbench.outline', category: t('视图'), label: showOutline.value ? t('隐藏文档目录') : t('显示文档目录'), available: hasDocument, keywords: t('大纲'), run: () => { showOutline.value = !showOutline.value; } },
    { id: 'workbench.properties', category: t('视图'), label: showDocumentProperties.value ? t('隐藏文档属性') : t('显示文档属性'), available: hasDocument, run: () => { showDocumentProperties.value = !showDocumentProperties.value; } },
    { id: 'workbench.discussion', category: t('文档'), get label() { return t('发起讨论'); }, keywords: t('文档讨论 评论'), available: editable, run: openDocumentDiscussion },
    { id: 'workbench.sidebar', category: t('视图'), label: sidebar.value ? t('收起侧栏') : t('展开侧栏'), shortcut: shortcuts.value.toggleSidebar, available: !isAuxiliaryWindow, run: toggleSidebar },
    { id: 'workbench.home', category: t('导航'), get label() { return t('切换到主页'); }, available: !isAuxiliaryWindow, run: () => { selectContext('home'); sidebar.value = true; } },
    { id: 'workbench.switch-workspace', category: t('导航'), get label() { return t('切换工作区'); }, available: !isAuxiliaryWindow, run: () => { sidebar.value = true; toggleWorkspaceMenu(); } },
    ...(extensions.commands ?? []),
    { id: 'workbench.repository', category: t('工作区'), get label() { return t('打开仓库'); }, available: !isAuxiliaryWindow, run: () => { sidebar.value = true; sidebarView.value = 'repository'; } },
    { id: 'workbench.plan', category: t('工作区'), get label() { return t('打开计划'); }, available: !isAuxiliaryWindow && store.workspaceSettings.showPlan, run: () => { sidebar.value = true; selectModule('plan'); } },
    { id: 'workbench.calendar', category: t('工作区'), get label() { return t('打开日历'); }, available: store.workspaceSettings.showPlan, run: () => openCalendar() },
    { id: 'workbench.graph', category: t('工作区'), get label() { return t('打开关系图谱'); }, available: store.workspaceSettings.showGraph, run: () => store.openGraphTab() },
    ...store.workspaceViews.map((record) => ({
      id: `workbench.workspace-view.${record.view.id}`,
      category: t('工作区'),
      get label() { return t('打开视图：{0}', [record.view.name]); },
      available: true,
      run: () => store.openWorkspaceView(record.view.id).catch(store.report),
    })),
    // Dev-only prototype; the native command is compiled out of release builds.
    { id: 'workbench.git', category: t('工作区'), label: 'Git 与同步', keywords: 'Git 状态 差异 提交 历史 同步', available: native && !mobile && !!workspace.value && !store.isWeb, run: () => openSystemSync() },
    { id: 'workbench.plugins', category: t('工作区'), get label() { return t('打开插件中心'); }, available: store.workspaceSettings.showPlugins, run: () => store.openPluginsTab() },
    { id: 'workbench.updates', category: t('历史'), get label() { return t('文档更新历史'); }, available: hasDocument, run: () => { historyPage.value = 'updates'; historyPanel.value = true; } },
    { id: 'workbench.versions', category: t('历史'), get label() { return t('文档版本历史'); }, available: hasDocument && !!extensions.historyEnabled, run: () => { historyPage.value = 'versions'; historyPanel.value = true; } },
    { id: 'workbench.settings', category: t('设置'), get label() { return t('外观设置'); }, keywords: t('打开设置'), run: () => openSettings('appearance') },
    { id: 'workbench.settings.editing', category: t('设置'), get label() { return t('编辑设置'); }, run: () => openSettings('editing') },
    { id: 'workbench.settings.shortcuts', category: t('设置'), get label() { return t('快捷键'); }, run: () => openSettings('shortcuts') },
    { id: 'workbench.settings.workspace', category: t('设置'), get label() { return t('工作区设置'); }, available: navigationContext.value === 'workspace' && !!workspace.value, run: () => openSettings('workspace') },
    { id: 'workbench.settings.about', category: t('设置'), get label() { return t('关于同页'); }, run: () => openSettings('about') },
  ];
});
const settingsPage = ref<SettingsPageId>(readSettingsPage());
// A loaded workspace keeps its session, but only the workspace navigation owns its settings.
const settingsWorkspace = computed(() => navigationContext.value === 'workspace' ? workspace.value : null);
function openSettingsTab(page: SettingsPageId) {
  if (!settingsWorkspace.value) return;
  settingsPage.value = page;
  store.openViewTab(SETTINGS_TAB_ID);
  settingsPanel.value = false;
}
const openingSettingsWindow = ref(false);
async function openSettingsInNewWindow(page: SettingsPageId) {
  if (!native || mobile || !tabsEnabled) return;
  settingsPage.value = page;
  if (openingSettingsWindow.value) return;
  openingSettingsWindow.value = true;
  settingsPanel.value = false;

  try {
    activeWindow.value = (await auxiliaryWindows.open('settings', 'settings', t('设置') + ' — Tano / 同页')).context;
  } catch (error) {
    settingsPanel.value = true;
    store.report(error);
  } finally {
    openingSettingsWindow.value = false;
  }
}
watch(defaultSource, (value, previous) => {
  savePreference('defaultSource', value);
  if (!editing.active && !editing.activeBusy)
    setPaneSource(store.activeId, value, sourceModes[store.activeId] ?? previous);
});
watch(revealMarkdown, (value) => savePreference('revealMarkdown', value));
const modal = ref<'' | 'newTab' | 'search' | 'delete' | 'saveAs'>('');
const modalTarget = ref<FileEntry | null>(null);
const modalDeleteEntries = ref<FileEntry[]>([]);
const modalDeleteContents = ref<FileEntry[]>([]);
const modalDeleteWorkspaceId = ref<string>();
watch(
  () => workspace.value?.files,
  (files) => {
    if (modal.value !== 'delete' || modalBusy.value || !files) return;
    const roots = topLevelEntries(modalDeleteEntries.value);
    if (!roots.length) return;
    const withinSelection = (path: string) =>
      roots.some(
        (root) =>
          path === root.path || (root.kind === 'directory' && path.startsWith(`${root.path}/`)),
      );
    const previous = modalDeleteContents.value.filter((entry) => withinSelection(entry.path));
    const current = files.filter((entry) => withinSelection(entry.path));
    if (
      roots.every((root) =>
        files.some((entry) => entry.id === root.id && entry.path === root.path),
      ) &&
      previous.length === current.length &&
      current.every((entry) =>
        previous.some(
          (old) =>
            old.id === entry.id &&
            old.path === entry.path &&
            (entry.kind === 'directory' ||
              (old.modified === entry.modified && old.size === entry.size)),
        ),
      )
    )
      return;
    modalDeleteEntries.value = roots.flatMap(
      (root) => files.find((entry) => entry.id === root.id) ?? [],
    );
    modalDeleteContents.value = [...files];
    modalError.value = modalDeleteEntries.value.length
      ? t('目录已自动更新，请核对所选条目后再次确认。')
      : t('所选条目已移除，目录已自动更新。请关闭此窗口后重新选择。');
  },
);
const input = ref('');
const modalError = ref('');
const modalBusy = ref(false);
const inputEl = ref<HTMLInputElement>();
const paneEditors = shallowReactive(new Map<string, InstanceType<typeof MarkdownEditor>>());
type InlineAssistantTarget = {
  paneId: string;
  fileId: string;
  text: string;
  sourceSelection: { text: string; from?: number; to?: number };
  anchor: InlineAssistantAnchor;
  blankBlock?: boolean;
  sessionId?: string;
};
type AssistantEditorSelection = { text: string; spans: { from: number; to: number; text: string }[]; from?: number; to?: number };
const inlineAssistant = shallowRef<InlineAssistantTarget>();
const inlineAssistantPrompt = ref('');
const inlineAssistantState = ref<'input' | 'loading' | 'completed' | 'response' | 'error'>('input');
const inlineAssistantError = ref('');
const inlineAssistantMessage = ref('');
let inlineAssistantProposal: import('@tano/protocol').AssistantProposal | undefined;
watch(() => [store.activePaneId, store.activeId, store.workspace?.id, store.workspace?.path], ([paneId, fileId, workspaceId, workspacePath], previous) => {
  if (inlineAssistant.value && (inlineAssistant.value.paneId !== paneId || inlineAssistant.value.fileId !== fileId ||
      workspaceId !== previous[2] || workspacePath !== previous[3]))
    closeInlineAssistant();
});
/** The page owns one lightweight AI task. Keep a running task attached to its card. */
function assistantTaskActive() {
  return inlineAssistantState.value === 'loading' || inlineRunner.busy || inlineRunner.applying;
}
function closeInlineAssistant() {
  inlineAssistant.value?.anchor.dispose();
  inlineAssistant.value = undefined;
  inlineAssistantPrompt.value = '';
  inlineAssistantError.value = '';
  inlineAssistantState.value = 'input';
  inlineAssistantMessage.value = '';
  inlineAssistantProposal = undefined;
}
function openInlineAssistant(paneId: string, fileId: string, text: string, sourceSelection: { text: string; from?: number; to?: number } = { text }, options: { anchor?: InlineAssistantAnchor; blankBlock?: boolean } = {}) {
  const { document } = activeWindow.value;
  if (assistantTaskActive()) {
    options.anchor?.dispose();
    return;
  }
  const anchor = options.anchor ?? paneEditors.get(paneId)?.captureVisualAnchor({ highlight: true });
  if (!anchor || (!text.trim() && !options.blankBlock) || !assistant.connection || !assistant.modelId) {
    anchor?.dispose();
    return openAssistant(paneId, fileId, { forcePanel: true });
  }
  closeInlineAssistant();
  inlineAssistant.value = { paneId, fileId, text, sourceSelection, anchor, ...(options.blankBlock ? { blankBlock: true } : {}) };
  inlineAssistantState.value = 'input';
  void nextTick(() => document.querySelector<HTMLInputElement>(`[aria-label="${t('输入助手任务')}"]`)?.focus());
}
async function submitInlineAssistant() {
  const target = inlineAssistant.value;
  const request = inlineAssistantPrompt.value.trim();
  if (!target || !request || inlineAssistantState.value !== 'input') return;
  inlineAssistantState.value = 'loading';
  inlineAssistantError.value = '';
  try {
    // Keep this one-shot path out of the visible conversation while reusing the
    // same guarded direct-edit execution and conflict checks as the full panel.
    const wholeEmptyDocument = target.blankBlock && target.sourceSelection.from === undefined && target.sourceSelection.to === undefined;
    if (inlineRunner.loading) throw new Error(t('助手正在初始化，请稍后重试'));
    inlineRunner.connections = assistant.connections.map(connection => ({ ...connection }));
    inlineRunner.connectionId = assistant.connectionId;
    inlineRunner.modelId = assistant.modelId;
    inlineRunner.reasoningEffort = assistant.reasoningEffort;
    inlineRunner.newSession();
    target.sessionId = inlineRunner.session?.id;
    inlineRunner.files = [target.fileId];
    inlineRunner.selection = wholeEmptyDocument ? null : { fileId: target.fileId, ...target.sourceSelection };
    inlineRunner.prompt = request;
    const previousReplyId = inlineRunner.session?.messages.at(-1)?.id;
    await inlineRunner.send();
    if (inlineAssistant.value !== target) return;
    const reply = inlineRunner.session?.messages.at(-1);
    const result = inlineAssistantResult(reply && reply.id !== previousReplyId && reply.role === 'assistant' ? reply : undefined, inlineRunner.error);
    inlineAssistantProposal = result.proposal;
    inlineAssistantMessage.value = result.message;
    inlineAssistantError.value = result.state === 'error' ? result.message : '';
    inlineAssistantState.value = result.state;
  } catch (error) {
    if (inlineAssistant.value !== target) return;
    inlineAssistantError.value = error instanceof Error ? error.message : String(error);
    inlineAssistantState.value = 'error';
  }
}
function openBlankBlockAssistant(paneId: string, fileId: string) {
  if (!assistant.available) return;
  const editor = paneEditors.get(paneId) as unknown as {
    assistantBlankBlockSelection?: () => { text: string; from?: number; to?: number } | null;
    captureBlankBlockAnchor?: () => InlineAssistantAnchor | null;
  } | undefined;
  const selection = editor?.assistantBlankBlockSelection?.();
  const anchor = editor?.captureBlankBlockAnchor?.();
  if (!selection || selection.from === undefined || !anchor) {
    anchor?.dispose();
    return;
  }
  const document = store.documentForTab(fileId);
  const target = document?.content === '' ? { text: '' } : selection;
  openInlineAssistant(paneId, fileId, '', target, { anchor, blankBlock: true });
}
async function undoInlineAssistant() {
  if (inlineAssistantProposal) await inlineRunner.undo(inlineAssistantProposal);
  closeInlineAssistant();
}
function continueInlineConversation() {
  const target = inlineAssistant.value;
  if (!target) return;
  const completedSession = inlineRunner.session;
  let capturedSelection: InlineAssistantTarget['sourceSelection'] | undefined;
  if (completedSession && completedSession.id === target.sessionId && !inlineRunner.busy && !inlineRunner.applying) {
    // Transfer a snapshot only after the independent run has finished saving.
    const snapshot = JSON.parse(JSON.stringify(completedSession));
    const index = assistant.sessions.findIndex(session => session.id === completedSession.id);
    if (index < 0) assistant.sessions.unshift(snapshot);
    else assistant.sessions[index] = snapshot;
    if (!assistant.busy && !assistant.applying) {
      assistant.selectSession(completedSession.id);
      // The editor selection has already collapsed when focus moved to the
      // inline input. Carry the original task scope through the panel handoff.
      const selected = inlineRunner.selection;
      if (selected?.fileId === target.fileId)
        capturedSelection = { text: selected.text, from: selected.from, to: selected.to };
    }
    else store.report(t('选区任务已加入会话列表，当前会话结束后可切换继续。'));
  }
  openAssistant(target.paneId, target.fileId, { forcePanel: true, capturedSelection });
  closeInlineAssistant();
}
function captureButterflyTextTarget(paneId: string, fileId: string) {
  if (paneSource(fileId)) return null;
  const anchor = paneEditors.get(paneId)?.captureVisualAnchor();
  if (!anchor) return null;
  const scope = paneButterflyScope(paneId, fileId), id = `text:${scope}:${crypto.randomUUID()}`;
  const registration = butterfly.registerTarget({ id, scope, get label() { return t('所选文字'); }, kind: 'text', temporary: true,
    element: () => anchor.element, rects: anchor.getRects, onDispose: anchor.dispose,
    available: () => !paneSource(fileId) && store.panes.some(pane => pane.id === paneId && pane.activeId === fileId),
  });
  return { id, dispose: registration.dispose };
}
const selectionTodo = shallowRef<SelectionTodoSession>();
const paneSourceSelections = shallowReactive<Record<string, boolean>>({});
function showSourceTodo(paneId: string, doc: OpenDocument) {
  return paneSource(doc.id) &&
    !!paneSourceSelections[paneId] &&
    store.capabilities.features.objectReferences &&
    !paneReadonly(doc) &&
    !editing.isManaging(doc.id);
}
function beginSelectionTodo(paneId: string, fileId: string) {
  const scope = workspace.value;
  const doc = store.documentForTab(fileId);
  if (
    !scope ||
    !doc ||
    paneReadonly(doc) ||
    editing.isManaging(fileId) ||
    !store.capabilities.features.objectReferences
  )
    return;
  const captured = (
    paneSource(fileId) ? paneSourceEditors.get(paneId) : paneEditors.get(paneId)
  )?.captureTodoSelection();
  if (!captured) {
    store.report(t('请先选择要创建任务或事件的文字'));
    return;
  }
  const sourceSpan = paneSource(fileId)
    ? paneSourceEditors.get(paneId)?.assistantSelection()?.spans[0]
    : paneEditors.get(paneId)?.assistantSelection();
  const location = sourceSpan ? { text: sourceSpan.text, from: sourceSpan.from, to: sourceSpan.to } : { text: captured.text };
  const expected = { id: scope.id, path: scope.path, content: doc.content };
  const source: ReferenceTarget = {
    workspace: scope.id,
    type: 'document',
    id: doc.id,
    path: doc.path,
    name: basename(doc.path).replace(/\.(md|markdown)$/i, ''),
  };
  function originalDocument() {
    if (workspace.value?.id !== expected.id || workspace.value.path !== expected.path)
      throw new Error(t('工作区已切换，请返回原工作区后重试'));
    const original = store.documentForTab(fileId);
    if (
      !original ||
      paneReadonly(original) ||
      original.missing ||
      editing.isManaging(fileId) ||
      !store.capabilities.features.objectReferences
    )
      throw new Error(t('原文档已关闭或不可编辑，请重新打开原文档'));
    return original;
  }
  selectionTodo.value = selectionTodoSession(captured.text, source, {
    create: (draft) => {
      if (originalDocument().content !== expected.content)
        throw new Error(t('原文已变化，请重新选择文字'));
      return store.createObject(draft);
    },
    insert: async (record, append) => {
      const original = originalDocument();
      const url = referenceUrl(record.object);
      const alreadyInserted = documentLinks(original.content).some((link) => link.target === url);
      if (!alreadyInserted) {
        if (append)
          store.editDocument(
            fileId,
            `${original.content.replace(/\n*$/, '')}\n\n${referenceMarkdown(record.object, record.object.name)}\n`,
          );
        else {
          if (original.content !== expected.content)
            throw new Error(t('原文或选区已变化，任务已保留；可在原文末尾插入引用'));
          if (!captured.insert(record.object, record.object.name)) {
            const range = assistantSourceRange(original.content, location);
            if (!range) throw new Error(t('原文或选区已变化，任务已保留；可在原文末尾插入引用'));
            const point = referenceInsertionPoint(original.content, range.to);
            const link = `${point.prefix}${referenceMarkdown(record.object, record.object.name)}${point.suffix}`;
            store.editDocument(fileId, original.content.slice(0, point.at) + link + original.content.slice(point.at));
          }
        }
      }
      await nextTick();
      if (!documentLinks(original.content).some((link) => link.target === url))
        throw new Error(t('任务已保留，当前选区不能插入引用；可在原文末尾插入引用'));
      await store.flush();
      if (original.conflict || original.missing || original.error || store.dirty(original))
        throw new Error(t('任务已保留，原文保存发生冲突或失败，请处理文档提示后重试'));
    },
  }, { workspaceName: scope.name, source: { workspaceId: scope.id, fileId: doc.id, selection: location } });
}
const paneComments = shallowReactive(new Map<string, InstanceType<typeof DocumentComments>>());
const commentAnchors = shallowReactive<Record<string, { id: string; anchor: CommentAnchor }[]>>({});
function capturePaneCommentSelection(paneId: string, fileId: string) {
  const selection = paneSource(fileId)
    ? paneSourceEditors.get(paneId)?.commentSelection()
    : paneEditors.get(paneId)?.commentSelection();
  return selection
    ? { ...selection, basis: paneSource(fileId) ? ('source' as const) : ('prose' as const) }
    : null;
}
function openAssistant(paneId = store.activePaneId, fileId = store.activeId,
  options: { forcePanel?: boolean; capturedSelection?: InlineAssistantTarget['sourceSelection'] } = {}) {
  const { window } = activeWindow.value;
  const forcePanel = options.forcePanel;
  const tableId = isTableTab(fileId) ? tableFileId(fileId) : undefined;
  // forcePanel chooses the surface, not the context: the launcher still uses
  // the current selection before the panel takes focus.
  const selected: AssistantEditorSelection | null = (tableId ? null : paneSource(fileId)
    ? paneSourceEditors.get(paneId)?.assistantSelection()
      : paneSelections[paneId]?.textSelected
        ? (paneEditors.get(paneId) as unknown as { assistantSelection?: () => AssistantEditorSelection | null })?.assistantSelection?.() ?? null
        : null) ?? null;
  const text = selected?.spans.map((span) => span.text).join('\n');
  const span = paneSource(fileId) && selected?.spans.length === 1 ? selected.spans[0] : undefined;
  const taskSelection = text ? { text: span?.text ?? selected?.text ?? text,
    ...(span ? { from: span.from, to: span.to } : selected?.from !== undefined ? { from: selected.from, to: selected.to } : {}) } : undefined;
  if (!forcePanel && !tableId && text) {
    openInlineAssistant(paneId, fileId, text, taskSelection!);
    return;
  }
  store.focusPane(paneId);
  assistant.open(
    tableId ?? (store.documentForTab(fileId) ? store.documentForTab(fileId)?.id : undefined),
    options.capturedSelection ?? taskSelection,
  );
  if (window.innerWidth < 1100) sidebar.value = false;
}
function toggleAssistant() {
  if (!workspace.value || !assistant.available) return;
  if (assistant.opened) {
    assistant.opened = false;
    void nextTick(() => {
      if (!assistant.opened) (source.value ? sourceEditor.value : editor.value)?.focus();
    });
  } else openAssistant(store.activePaneId, store.activeId, { forcePanel: true });
}
function initializeDocument(paneId: string, fileId: string, content: string, expected: string) {
  const doc = store.documentForTab(fileId);
  if (!doc || paneReadonly(doc) || doc.missing || doc.conflict || doc.error ||
      (editing.isManaging(doc.id) && (doc.id !== store.active?.id || !editing.active?.extension)) ||
      store.panes.find(pane => pane.id === paneId)?.activeId !== fileId || paneSource(fileId) ||
      doc.content !== expected || !paneEditors.get(paneId)?.initializeBody(content, expected))
    throw new Error(t('文档内容或编辑状态已变化，请回到空白文档后重试。现有内容已保留。'));
  store.focusPane(paneId);
  recordHelpCompleted('use-template');
}
function quickInitialize(paneId: string, fileId: string, kind: 'meeting' | 'weekly' | 'todo') {
  const doc = store.documentForTab(fileId);
  if (!doc) return;
  try { initializeDocument(paneId, fileId, documentStarter(kind, workspace.value?.name ?? ''), doc.content); }
  catch (reason) { store.report(reason); }
}
function chooseInitialTemplate(paneId: string, fileId: string) {
  const doc = store.documentForTab(fileId);
  if (!doc) return;
  store.focusPane(paneId);
  openTemplateLibrary();
  const expected = doc.content, workspaceId = workspace.value?.id;
  templateInitialization.value = {
    title: basename(doc.path).replace(/\.(md|markdown)$/i, ''),
    apply(content) {
      if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
      initializeDocument(paneId, fileId, templateStarterBody(content), expected);
    },
  };
}
function startDocumentDraft(paneId: string, fileId: string) {
  const { window } = activeWindow.value;
  store.focusPane(paneId);
  assistant.startDocumentDraft(fileId);
  if (window.innerWidth < 1100) sidebar.value = false;
}
function discussWithAssistant(
  paneId: string,
  fileId: string,
  request: {
    kind: import('@tano/protocol').CommentKind;
    thread: import('@tano/protocol').CommentThread;
    quote?: string;
  },
) {
  const { window } = activeWindow.value;
  if (assistant.busy || assistant.applying) return;
  const comments = paneComments.get(paneId);
  const epoch = store.assistantEpoch;
  store.focusPane(paneId);
  assistant.open(fileId);
  assistant.setBuiltInPrompt(assistantDiscussionPrompt(request.quote,
    request.thread.messages.map((message) => ({ author: message.authorName, body: message.body }))));
  assistant.replyTarget = {
    label: request.thread.messages[0]?.body.slice(0, 40) ?? t('文档讨论'),
    draft: async (body) => {
      if (
        store.assistantEpoch !== epoch ||
        store.panes.find((pane) => pane.id === paneId)?.activeId !== fileId ||
        paneComments.get(paneId) !== comments ||
        !comments
      )
        throw new Error(t('原讨论页面已变化，请重新打开原讨论'));
      await comments.assistantReply(request.kind, request.thread.id, body);
    },
  };
  if (window.innerWidth < 1100) sidebar.value = false;
}
function focusPaneComment(paneId: string, fileId: string, anchor: CommentAnchor) {
  if (paneSource(fileId)) paneSourceEditors.get(paneId)?.focusComment(anchor);
  else paneEditors.get(paneId)?.focusComment(anchor);
}
function paneCommentGeometry(
  paneId: string,
  fileId: string,
  anchors?: readonly { id: string; anchor: CommentAnchor }[],
) {
  return (
    (paneSource(fileId) ? paneSourceEditors.get(paneId) : paneEditors.get(paneId))?.commentGeometry(
      anchors,
    ) ?? null
  );
}
function setPaneComments(paneId: string, value: unknown) {
  if (value && typeof (value as { showDiscussion?: unknown }).showDiscussion === 'function') paneComments.set(paneId, value as InstanceType<typeof DocumentComments>);
  else paneComments.delete(paneId);
}
const editor = computed(() => paneEditors.get(store.activePaneId));
function setPaneEditor(id: string, value: unknown) {
  // Async component refs may briefly point at their loading placeholder.
  // Only publish the editor after its exposed API is available.
  if (value && typeof (value as { visualSelection?: unknown }).visualSelection === 'function') paneEditors.set(id, value as InstanceType<typeof MarkdownEditor>);
  else paneEditors.delete(id);
}
const objectPanel = ref(false);
// Keep drafts across close/reopen, but don't load the panel until it is first requested.
const objectPanelMounted = ref(false);
watch(objectPanel, open => { if (open) objectPanelMounted.value = true; }, { flush: 'sync' });
const selectedObjectId = ref<string>();
const selectedResourceIdentity = shallowRef<ReferenceIdentity>();
const selectedPersonal = ref(false);
const planDetail = shallowRef<ObjectRecord>();
function showObjects(id?: string) {
  selectedPersonal.value = false;
  selectedResourceIdentity.value = undefined;
  selectedObjectId.value = id;
  objectPanel.value = true;
  workspaceMenu.value = false;
}
function showFileObject(identity: ReferenceIdentity) {
  if (!['document', 'asset'].includes(identity.type)) return;
  selectedPersonal.value = false;
  selectedObjectId.value = undefined;
  selectedResourceIdentity.value = identity;
  objectPanel.value = true;
  workspaceMenu.value = false;
}
function showPlanEvent(key: string) {
  const personal = plans.personal.find((item) => planKey(item) === key);
  const local = store.objects.find(
    (item) => item.object.id === key && ['event', 'task'].includes(item.object.type),
  );
  const record =
    personal ??
    (local && workspace.value
      ? {
          ...local,
          source: {
            scope: 'workspace' as const,
            id: workspace.value.id,
            name: workspace.value.name,
          },
        }
      : undefined);
  if (!record) {
    store.report(t('事项已不存在，请刷新计划后重试'));
    return;
  }
  objectPanel.value = false;
  if (record.source?.scope === 'workspace') selectContext('workspace');
  planDetail.value = record;
  if (compactPanes.value) sidebar.value = false;
}
function managePlanEvents() {
  showObjects();
  selectedPersonal.value = plans.view === 'personal';
}
async function openReference(identity: ReferenceIdentity) {
  const result = resolveReference(store.referenceTargets, identity);
  if (!result.target) {
    store.report(t('当前工作区中引用目标不可用，请检查对象是否被移除或 ID 是否重复'));
    return;
  }
  if (identity.type !== 'document') {
    if (['event', 'task'].includes(identity.type)) showPlanEvent(identity.id);
    else if (['document', 'asset'].includes(identity.type)) showFileObject(identity);
    else showObjects(identity.id);
    return;
  }
  const file = workspace.value?.files.find((file) => file.id === identity.id);
  if (file) await openEntry(file);
}
async function openObjectResource(identity: ReferenceIdentity) {
  const result = resolveReference(store.referenceTargets, identity);
  if (!result.target || !['document', 'asset'].includes(identity.type)) return;
  const file = workspace.value?.files.find(
    (file) => file.id === identity.id && file.path === result.target!.path,
  );
  if (!file) return;
  if (identity.type === 'document') objectPanel.value = false;
  await openEntry(file);
}
async function openObjectReference(identity: ReferenceIdentity) {
  if (identity.type === 'document') objectPanel.value = false;
  await openReference(identity);
}
async function openWorkspaceViewSourceFile(file: FileEntry) {
  if (isMarkdown(file.path) || isDataTableFilePath(file.path)) await openEntry(file);
  else store.openAttachmentInNewTab(file);
}
function openWorkspaceViewSourceObject(identity: ReferenceIdentity) {
  void openObjectReference(identity);
}
async function openPlanReference(identity: ReferenceIdentity) {
  const current = planDetail.value;
  if (current?.source?.scope === 'personal') {
    const record = plans.personal.find(
      (item) => item.object.type === identity.type && item.object.id === identity.id,
    );
    if (record) planDetail.value = record;
    else store.report(t('个人事项引用目标不可用'));
    return;
  }
  const source = planDocumentSource(current?.object.properties.documentSource);
  planDetail.value = undefined;
  await openReference(identity);
  if (source && identity.type === 'document' && identity.id === source.fileId)
    await revealAssistantSelection(source);
}
const assetInput = ref<HTMLInputElement>();
const assetImportBusy = ref(false);
async function importObjectAssets(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const selectedWorkspace = workspace.value;
  if (
    !attachments ||
    !selectedWorkspace ||
    selectedWorkspace.readOnly ||
    !store.capabilities.features.objectReferences ||
    assetImportBusy.value
  )
    return;
  assetImportBusy.value = true;
  try {
    for (const file of files) {
      if (workspace.value?.id !== selectedWorkspace.id)
        throw new Error(t('工作区已切换，已导入的资产保留在原工作区'));
      await attachments.importAttachment(selectedWorkspace.id, '', file, false);
    }
  } catch (error) {
    store.report(error);
  } finally {
    if (workspace.value?.id === selectedWorkspace.id) await store.refresh();
    assetImportBusy.value = false;
  }
}
function assetPreview(target: ReferenceTarget) {
  return attachments &&
    target.type === 'asset' &&
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(target.mime ?? '')
    ? attachments.imageUrl(workspace.value, '', relativeWorkspaceReference('', target.path))
    : null;
}
const paneSelections = shallowReactive<Record<string, EditorSelectionContext>>({});
let butterflyIdle: ReturnType<typeof createButterflyIdleTrigger> | undefined;
onMounted(() => {
  butterflyIdle = createButterflyIdleTrigger({
    selection: () => {
      if (paneSource(store.activeId)) return null;
      const selection = paneEditors.get(store.activePaneId)?.visualSelection();
      return selection ? { ...selection, scope: paneButterflyScope(store.activePaneId, store.activeId) } : null;
    },
    enabled: () => butterfly.state.enabled && butterfly.state.phase === 'docked' && !assistant.busy && !assistant.applying,
    onIdle: () => {
      const target = captureButterflyTextTarget(store.activePaneId, store.activeId);
      if (target) void butterfly.flyTo(target.id);
    },
  });
});
watch(() => [butterfly.state.scope, butterfly.state.enabled, butterfly.state.phase, assistant.busy, assistant.applying,
  paneSource(store.activeId), paneEditors.get(store.activePaneId), paneSelections[store.activePaneId]],
() => butterflyIdle?.refresh(), { flush: 'post' });
onBeforeUnmount(() => butterflyIdle?.dispose());
const paneScrolls = shallowReactive(new Map<string, HTMLElement>());
const paneEditorScrolls = shallowReactive(new Map<string, HTMLElement>());
const paneSourceEditors = shallowReactive(new Map<string, InstanceType<typeof SourceEditor>>());
const pendingTransfers = new Map<string, { source: boolean; state: unknown; viewport: ModeViewport | null }>();
watch(() => store.windowLayouts, (layouts, previous) => {
  const destinations = new Map(Object.values(layouts).flatMap(layout =>
    layoutPanes(layout.layout).flatMap(pane => pane.tabs.map(id => [id, pane.id] as const))));
  for (const layout of Object.values(previous)) {
    for (const pane of layoutPanes(layout.layout)) {
      const destination = destinations.get(pane.activeId);
      if (!destination || destination === pane.id) continue;
      const source = paneSource(pane.activeId);
      const editor = source ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
      if (!editor) continue;
      const scroll = paneScrolls.get(pane.id);
      pendingTransfers.set(pane.activeId, {
        source, state: editor.captureTransferState(),
        viewport: scroll ? captureModeViewport(editor, scroll) : null,
      });
    }
  }
}, { flush: 'sync' });
watch(() => store.documents.map(doc => doc.id), ids => {
  for (const id of pendingTransfers.keys()) if (!ids.includes(id)) pendingTransfers.delete(id);
});
watch(() => store.workspace?.id, () => pendingTransfers.clear());
store.setPluginEditor(async (fileId, before, after) => {
  const pane = store.panes.find(item => item.activeId === fileId);
  if (!pane) return false;
  const target = paneSource(fileId) ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
  if (!target) return false;
  target.applyPluginEdit(before, after);
  await nextTick();
  return true;
});
onBeforeUnmount(() => store.setPluginEditor());
const paneSearches = new Map<string, InstanceType<typeof PageSearch>>();
const paneSearchRevisions = shallowReactive<Record<string, number>>({});
function setPaneSearch(id: string, value: unknown) {
  if (value) paneSearches.set(id, value as InstanceType<typeof PageSearch>);
  else paneSearches.delete(id);
}
function openPaneSearch(id = store.activePaneId, replace = false) {
  menu.value = false;
  if (compactPanes.value) sidebar.value = false;
  void paneSearches.get(id)?.open(replace);
}
const documentScroll = computed(() => paneScrolls.get(store.activePaneId));
const editorScroll = computed(() => paneEditorScrolls.get(store.activePaneId));
const sourceEditor = computed(() => paneSourceEditors.get(store.activePaneId));
let pendingAssistantReveal: { workspaceId: string; paneId: string; tabId: string; fileId: string; from: number; to: number } | undefined;
function revealPendingAssistantSelection() {
  const pending = pendingAssistantReveal;
  if (!pending) return;
  if (store.workspace?.id !== pending.workspaceId || store.activePaneId !== pending.paneId || store.activeId !== pending.tabId || store.active?.id !== pending.fileId) {
    pendingAssistantReveal = undefined;
    return;
  }
  const target = paneSource(pending.tabId) ? paneSourceEditors.get(pending.paneId) : paneEditors.get(pending.paneId);
  if (target?.revealSourceRange(pending)) pendingAssistantReveal = undefined;
}
async function revealAssistantSelection(source: Pick<AssistantSource, 'workspaceId' | 'fileId' | 'selection'>) {
  pendingAssistantReveal = undefined;
  if (store.workspace?.id !== source.workspaceId || store.active?.id !== source.fileId) return;
  const range = assistantSourceRange(store.active.content, source.selection);
  if (!range) { store.report(t('引用原文已变化或无法唯一定位，请在文档中核对')); return; }
  pendingAssistantReveal = { workspaceId: source.workspaceId, paneId: store.activePaneId, tabId: store.activeId, fileId: source.fileId, ...range };
  await nextTick();
  revealPendingAssistantSelection();
}
async function paneEditorReady(paneId: string, fileId: string, sourceMode: boolean) {
  await nextTick();
  paneSearchRevisions[paneId] = (paneSearchRevisions[paneId] ?? 0) + 1;
  const target = sourceMode ? paneSourceEditors.get(paneId) : paneEditors.get(paneId);
  const scroll = paneScrolls.get(paneId);
  const transfer = pendingTransfers.get(fileId);
  if (transfer && target && scroll) {
    pendingTransfers.delete(fileId);
    if (transfer.source === sourceMode) {
      target.restoreTransferState(transfer.state);
      if (transfer.viewport) pendingModeViewports.set(paneId, { fileId, source: sourceMode, viewport: transfer.viewport });
    }
  }
  const pending = pendingModeViewports.get(paneId);
  if (!pending || pending.fileId !== fileId || pending.source !== sourceMode || !target || !scroll) { revealPendingAssistantSelection(); return; }
  const current = () => pendingModeViewports.get(paneId) === pending && paneSource(fileId) === sourceMode
    && store.panes.some(pane => pane.id === paneId && pane.activeId === fileId)
    && (sourceMode ? paneSourceEditors.get(paneId) : paneEditors.get(paneId)) === target;
  try {
    await restoreModeViewport(target, scroll, pending.viewport, pending.focus ?? paneId === store.activePaneId, current);
  } finally {
    if (pendingModeViewports.get(paneId) === pending) pendingModeViewports.delete(paneId);
    revealPendingAssistantSelection();
  }
}
function setPaneElement(kind: 'scroll' | 'editor' | 'source', id: string, value: unknown) {
  if (kind === 'source') {
    if (value && typeof (value as { commentSelection?: unknown }).commentSelection === 'function') paneSourceEditors.set(id, value as InstanceType<typeof SourceEditor>);
    else {
      paneSourceEditors.delete(id);
      delete paneSourceSelections[id];
    }
  } else {
    const map = kind === 'scroll' ? paneScrolls : paneEditorScrolls;
    if (value) map.set(id, value as HTMLElement);
    else map.delete(id);
  }
}
function paneReadonly(doc: OpenDocument) {
  return (
    workspaceLocked.value ||
    updateLock.value ||
    store.busy ||
    !!workspace.value?.readOnly ||
    !!workspace.value?.files.find((file) => file.id === doc.id)?.readOnly ||
    !!doc.conflict ||
    (doc.id === store.active?.id
      ? editorReadonly.value
      : readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false) ||
        editing.isManaging(doc.id))
  );
}
function paneDocumentStatus(doc: OpenDocument) {
  const locked = workspaceLocked.value || (doc.id === store.active?.id ? pageLocked.value
    : readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false));
  let sync: DocumentSyncStatus | undefined = extensions.documentStatus?.(doc.id);
  if (!sync && workspaceSync.state.value.backend === 'git') {
    if (workspaceSync.state.value.conflicts.includes(doc.path)) sync = { kind: 'error', detail: t('当前文章存在 Git 同步冲突。') };
    else if (workspaceSync.error.value) sync = { kind: 'error', detail: workspaceSync.error.value };
    else if (workspaceSync.operation.value === 'run') sync = { kind: 'syncing', detail: t('工作区正在进行 Git 同步。') };
  }
  return documentStatusItems({ document: doc, locked,
    preview: updateLock.value || !!workspace.value?.readOnly || !!workspace.value?.files.find(file => file.id === doc.id)?.readOnly,
    sync,
    storage: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
  });
}
const documentUndoAvailable = ref(false);
const documentRedoAvailable = ref(false);
function refreshDocumentHistoryAvailability() {
  documentUndoAvailable.value = !editorReadonly.value &&
    (source.value ? !!sourceEditor.value?.canUndo() : !!editor.value?.canUndo());
  documentRedoAvailable.value = !editorReadonly.value &&
    (source.value ? !!sourceEditor.value?.canRedo() : !!editor.value?.canRedo());
}
watch(commandPaletteOpened, opened => { if (opened) refreshDocumentHistoryAvailability(); });
function showReferenceGraph(paneId: string, document: OpenDocument) {
  referenceGraphTarget.value = { id: document.id, path: document.path };
  referenceGraphAnchor.value = paneScrolls.get(paneId);
  referenceGraphOpened.value = true;
  menu.value = false;
}
async function toggleDocumentMenu(event: MouseEvent) {
  documentMenuButton.value = event.currentTarget as HTMLButtonElement;
  // Focusing another pane closes its predecessor's menu in the activeId watcher.
  await nextTick();
  menu.value = !menu.value;
  if (!menu.value) {
    documentUndoAvailable.value = false;
    documentRedoAvailable.value = false;
    return;
  }
  await nextTick();
  refreshDocumentHistoryAvailability();
}
function documentMenuTriggerKeydown(event: KeyboardEvent) {
  if (!menu.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
      []),
  ];
  if (!items.length) return;
  event.preventDefault();
  items[event.key === 'ArrowUp' || event.key === 'End' ? items.length - 1 : 0]?.focus();
}
function documentMenuKeydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    menu.value = false;
    documentMenuButton.value?.focus({ preventScroll: true });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
      []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : current < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
function undoDocument() {
  if (editorReadonly.value || !documentUndoAvailable.value) return;
  const changed = source.value
    ? sourceEditor.value?.undoLastChange()
    : editor.value?.undoLastChange();
  if (!changed) return;
  menu.value = false;
  documentUndoAvailable.value = false;
  documentRedoAvailable.value = false;
}
function redoDocument() {
  if (editorReadonly.value || !documentRedoAvailable.value) return;
  const changed = source.value
    ? sourceEditor.value?.redoLastChange()
    : editor.value?.redoLastChange();
  if (!changed) return;
  menu.value = false;
  documentUndoAvailable.value = false;
  documentRedoAvailable.value = false;
}
function insertBlockBelowTitle(workspaceId: string, documentId: string) {
  if (
    workspace.value?.id !== workspaceId ||
    active.value?.id !== documentId ||
    editorReadonly.value ||
    active.value.missing
  )
    return;
  if (source.value) sourceEditor.value?.insertBlockAtStart();
  else editor.value?.insertBlockAtStart();
}
const activeHeading = ref(0);
const outlineCoverBottom = ref(0);
const outlinePosition = computed(() => {
  if (!outlineCoverBottom.value) return undefined;
  const top = `max(var(--inspector-top), ${outlineCoverBottom.value}px)`;
  return { top, maxHeight: `calc(100% - ${top} - var(--inspector-bottom, 12px))` };
});
let headingFrame: number | undefined;
let headingWindow: Window | undefined;
async function dragPaneWindow(event: MouseEvent) {
  if (event.button !== 0 || event.detail !== 1) return;
  await activeWindow.value.native?.startDragging();
}
async function maximizePaneWindow() {
  await activeWindow.value.native?.toggleMaximize();
}
const attachmentBusy = ref(false);
const resourceRevision = computed(
  () =>
    `${attachments?.revision ?? 0}:${active.value?.path}:${workspace.value?.files
      .filter((file) => !isMarkdown(file.path))
      .map((file) => `${file.path}:${file.modified}:${file.size}`)
      .join('|')}`,
);
async function uploadFile(file: File, requireImage: boolean, doc = active.value) {
  const currentWorkspace = workspace.value;
  if (!attachments || !currentWorkspace || !doc) throw new Error(t('当前工作区不支持导入附件'));
  const result = await attachments.importAttachment(
    currentWorkspace.id,
    doc.path,
    file,
    requireImage,
  );
  if (
    workspace.value?.id !== currentWorkspace.id ||
    !store.documents.some((item) => item.id === doc.id)
  )
    throw new Error(t('附件已保存到原工作空间的 assets；文档已切换，请重新插入链接'));
  await store.refresh();
  if (
    workspace.value?.id !== currentWorkspace.id ||
    !store.documents.some((item) => item.id === doc.id)
  )
    throw new Error(t('附件已导入，原文档已关闭'));
  return { ...result, url: relativeWorkspaceReference(doc.path, result.path) };
}
async function insertSourceFiles(
  files: File[],
  position: number,
  requireImage: boolean,
  doc = active.value,
  paneId = store.activePaneId,
) {
  if (!doc || doc.conflict || attachmentBusy.value) return;
  const id = doc.id,
    before = doc.content;
  const targetEditor = paneSourceEditors.get(paneId);
  attachmentBusy.value = true;
  try {
    const links: string[] = [];
    for (const file of files.slice(0, 10))
      links.push(resourceMarkdown(await uploadFile(file, requireImage, doc)));
    if (!store.documents.includes(doc)) return;
    // Preserve typing that happened while the bytes were being imported.
    const content = doc.content;
    const at = content === before ? position : content.length;
    const text = `\n${links.join('\n')}\n`;
    // Local insertions belong to editor history; incoming model updates do not.
    if (
      targetEditor &&
      paneSourceEditors.get(paneId) === targetEditor &&
      store.panes.find((pane) => pane.id === paneId)?.activeId === id
    ) {
      targetEditor.insertText(text, at);
    } else store.editDocument(id, `${content.slice(0, at)}${text}${content.slice(at)}`);
  } catch (error) {
    store.report(error);
  } finally {
    attachmentBusy.value = false;
  }
}

async function openEntry(file: FileEntry, newTab = false) {
  newTab = newTab && tabsEnabled;
  if (file.kind === 'directory') {
    await openBreadcrumbDirectory(file.path, newTab);
    return;
  }
  const handler = fileHandlers.resolve(file.path);
  if (isObjectPath(file.path)) {
    const record = store.objects.find((item) => item.path === file.path);
    if (record) showObjects(record.object.id);
    else store.report(t('对象文件不可用，请在工作区对象面板检查格式或重复 ID'));
    return;
  }
  if (handler.preview === 'markdown' || handler.preview === 'table') {
    if (newTab) await store.openFileInNewTab(file);
    else await store.openFile(file);
    if (store.activePaneId === templatePaneId.value && store.activeId === file.id) templateLibraryOpen.value = false;
    if (compactPanes.value) sidebar.value = false;
    return;
  }
  if (workspace.value) {
    store.openAttachmentInNewTab(file);
    if (compactPanes.value) sidebar.value = false;
    return;
  }
}
async function openTreeEntry(file: FileEntry) {
  pendingTreeOpenIds.add(file.id);
  try {
    await openEntry(file);
  } finally {
    await nextTick();
    pendingTreeOpenIds.delete(file.id);
  }
}
function closeFileContextMenu(restoreFocus = false) {
  fileContextMenu.value = null;
  if (restoreFocus) void nextTick(() => fileContextTrigger?.focus({ preventScroll: true }));
}
function closeDirectoryContextMenu() {
  directoryContextMenu.value = null;
}
function closeWorkspaceEntryContextMenu(restoreFocus = false) {
  workspaceEntryContextMenu.value = null;
  if (restoreFocus)
    void nextTick(() => workspaceEntryContextTrigger?.focus({ preventScroll: true }));
}
function openWorkspaceEntryContextMenu(item: WorkspaceEntry, event: MouseEvent) {
  const { window, document } = activeWindow.value;
  event.preventDefault();
  closeFileContextMenu();
  closeDirectoryContextMenu();
  closePageContextMenu();
  closeOutlineContextMenu();
  workspaceEntryContextTrigger = event.currentTarget as HTMLElement | null;
  workspaceEntryContextMenu.value = {
    item,
    x: Math.max(8, event.clientX),
    y: Math.max(8, event.clientY),
  };
  void nextTick(() => {
    const contextMenu = document.querySelector<HTMLElement>('.workspace-entry-context-menu');
    if (!contextMenu || !workspaceEntryContextMenu.value) return;
    workspaceEntryContextMenu.value.x = Math.max(
      8,
      Math.min(workspaceEntryContextMenu.value.x, window.innerWidth - contextMenu.offsetWidth - 8),
    );
    workspaceEntryContextMenu.value.y = Math.max(
      8,
      Math.min(workspaceEntryContextMenu.value.y, window.innerHeight - contextMenu.offsetHeight - 8),
    );
    contextMenu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });
}
function workspaceDropdownContextMenu(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-workspace-entry-id]');
  const id = target?.dataset.workspaceEntryId;
  const item = id ? store.recent.find((entry) => entry.id === id) : undefined;
  if (item) openWorkspaceEntryContextMenu(item, event);
}
function workspaceEntryContextKeydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeWorkspaceEntryContextMenu(true);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(workspaceEntryContextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : current < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}
function workspaceEntryContextAction(action: 'open' | 'reveal') {
  const item = workspaceEntryContextMenu.value?.item;
  if (!item) return;
  closeWorkspaceEntryContextMenu();
  if (action === 'open') {
    workspaceMenu.value = false;
    if (item.id === workspace.value?.id) selectContext('workspace');
    else void store.openWorkspace(item.path);

  } else if (action === 'reveal') {
    void store.reveal();
  }
}
function selectFileTreeEntry(file: FileEntry, event: MouseEvent) {
  const visibleIds = fileTree.value?.getVisibleIds() ?? [];
  const next = selectTreeEntry(
    { ids: selectedEntryIds.value, anchor: selectionAnchorId.value },
    file.id,
    visibleIds,
    event,
  );
  selectedEntryIds.value = next.ids;
  selectionAnchorId.value = next.anchor;
  closeFileContextMenu();
}
function openFileContextMenu(file: FileEntry, event: MouseEvent | KeyboardEvent) {
  const { window, document } = activeWindow.value;
  closeDirectoryContextMenu();
  closeOutlineContextMenu();
  closePageContextMenu();
  if (!selectedEntryIds.value.has(file.id)) {
    selectedEntryIds.value = new Set([file.id]);
    selectionAnchorId.value = file.id;
  }
  const trigger = event.currentTarget as HTMLElement | null;
  fileContextTrigger = trigger;
  const rect = trigger?.getBoundingClientRect();
  const x = isMouseEvent(event) ? event.clientX : (rect?.left ?? 0) + 24;
  const y = isMouseEvent(event) ? event.clientY : (rect?.bottom ?? 0);
  menu.value = false;
  workspaceMenu.value = false;
  fileContextMenu.value = {
    file,
    x: Math.max(8, x),
    y: Math.max(8, y),
  };
  void nextTick(() => {
    const contextMenu = document.querySelector<HTMLElement>('.file-context-menu');
    if (!contextMenu || fileContextMenu.value?.file !== file) return;
    fileContextMenu.value.x = Math.max(
      8,
      Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8),
    );
    fileContextMenu.value.y = Math.max(
      8,
      Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8),
    );
    contextMenu.focus({ preventScroll: true });
  });
}
function openDirectoryContextMenu(parent: string, event: MouseEvent) {
  const { window, document } = activeWindow.value;
  event.preventDefault();
  closeFileContextMenu();
  closeOutlineContextMenu();
  closePageContextMenu();
  const trigger = event.currentTarget as HTMLElement | null;
  const rect = trigger?.getBoundingClientRect();
  const x = event.clientX || (rect?.left ?? 0) + 24;
  const y = event.clientY || (rect?.top ?? 0) + 24;
  directoryContextMenu.value = {
    parent,
    x: Math.max(8, x),
    y: Math.max(8, y),
  };
  void nextTick(() => {
    const contextMenu = document.querySelector<HTMLElement>('.directory-context-menu');
    if (!contextMenu || !directoryContextMenu.value) return;
    directoryContextMenu.value.x = Math.max(
      8,
      Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8),
    );
    directoryContextMenu.value.y = Math.max(
      8,
      Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8),
    );
    contextMenu.focus({ preventScroll: true });
  });
}
async function directoryContextAction(
  action: 'document' | 'folder' | 'table' | 'database' | 'import' | 'duplicate' | 'copy' | 'rename' | 'delete',
) {
  const parent = directoryContextMenu.value?.parent ?? '';
  const target = parent
    ? workspace.value?.files.find((entry) => entry.kind === 'directory' && entry.path === parent)
    : undefined;
  closeDirectoryContextMenu();
  if (action === 'import') {
    openImport();
    return;
  }
  if (parent && !target) return;
  if (action === 'database') {
    try { await store.createFileDatabase(parent); } catch (error) { store.report(error); }
    return;
  }
  if (action === 'copy') {
    if (!parent) return;
    try {
      await navigator.clipboard.writeText(parent);
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'duplicate') {
    if (!target || !canDuplicateEntry(target) || fileMutationDisabled(target)) return;
    try {
      await store.duplicateEntry(target, workspace.value?.id);
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'rename') {
    if (!target || fileMutationDisabled(target) || directoryHasManagedFile(target)) return;
    startTreeRename(target);
    return;
  }
  if (action === 'delete') {
    if (!target || fileDeleteDisabled(target)) return;
    void removeDocument(target);
    return;
  }
  void createNewEntry(action, parent);
}
function directoryContextRenameDisabled() {
  const target = directoryContextMenu.value?.parent
    ? workspace.value?.files.find(
        (entry) => entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
      )
    : undefined;
  return !target || fileMutationDisabled(target) || directoryHasManagedFile(target);
}
function directoryContextDuplicateDisabled() {
  const target = directoryContextMenu.value?.parent
    ? workspace.value?.files.find(
        (entry) => entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
      )
    : undefined;
  return !target || !canDuplicateEntry(target) || fileMutationDisabled(target);
}
function directoryContextDeleteDisabled() {
  const target = directoryContextMenu.value?.parent
    ? workspace.value?.files.find(
        (entry) => entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
      )
    : undefined;
  return !target || fileDeleteDisabled(target);
}
function closePageContextMenu() {
  pageContextMenu.value = null;
}
function closeButtonVisibilityMenus() {
  closeFileContextMenu();
  closeDirectoryContextMenu();
  closePageContextMenu();
  closeOutlineContextMenu();
  menu.value = false;
  workspaceMenu.value = false;
  calendarModeOpen.value = false;
}
function openPageContextMenu(event: MouseEvent) {
  const { window } = activeWindow.value;
  if (event.defaultPrevented || !isBlankPageTarget(event.target)) {
    closePageContextMenu();
    return;
  }
  event.preventDefault();
  closeFileContextMenu();
  closeDirectoryContextMenu();
  closeOutlineContextMenu();
  pageContextMenu.value = { x: Math.max(8, event.clientX), y: Math.max(8, event.clientY) };
  void nextTick(() => {
    const element = pageContextMenuElement.value;
    if (!element || !pageContextMenu.value) return;
    pageContextMenu.value = {
      x: Math.min(
        pageContextMenu.value.x,
        Math.max(8, window.innerWidth - element.offsetWidth - 8),
      ),
      y: Math.min(
        pageContextMenu.value.y,
        Math.max(8, window.innerHeight - element.offsetHeight - 8),
      ),
    };
    element.focus({ preventScroll: true });
  });
}
function openDocumentDiscussion() {
  menu.value = false;
  closePageContextMenu();
  return paneComments.get(store.activePaneId)?.showDiscussion();
}
const canAddDocumentProperty = computed(() => {
  const document = active.value;
  if (!document || editorReadonly.value || editing.active || editing.activeBusy) return false;
  const prefix = splitFrontmatter(document.content).prefix;
  return !prefix || frontmatterProperties(prefix) !== null;
});
async function addDocumentProperty() {
  if (!canAddDocumentProperty.value) return;
  const fileId = store.activeId;
  const paneId = store.activePaneId;
  menu.value = false;
  closePageContextMenu();
  showDocumentProperties.value = true;
  setPaneSource(fileId, false);
  // The property input is the destination; restoring the prose caret would dismiss its draft.
  pendingModeViewports.delete(paneId);
  await nextTick();
  if (store.activeId === fileId && store.activePaneId === paneId)
    await paneEditors.get(paneId)?.addDocumentProperty();
}
function togglePageOption(option: 'title' | 'properties' | 'outline' | 'lineNumbers' | 'autoSpacing') {
  if (option === 'autoSpacing') editorPreferences.value = { ...editorPreferences.value, autoSpacing: !editorPreferences.value.autoSpacing };
  if (option === 'title') showPageTitle.value = !showPageTitle.value;
  if (option === 'properties') showDocumentProperties.value = !showDocumentProperties.value;
  if (option === 'outline') showOutline.value = !showOutline.value;
  if (option === 'lineNumbers') showAllLineNumbers.value = !showAllLineNumbers.value;
  closePageContextMenu();
}
function pageContextKeydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    closePageContextMenu();
    editorScroll.value?.focus({ preventScroll: true });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(pageContextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : current < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
function fileMutationDisabled(file: FileEntry) {
  return (
    !!workspace.value?.readOnly ||
    !!file.readOnly ||
    store.busy ||
    updateLock.value ||
    sessionBlocksFileMutation(file.id)
  );
}
function canDuplicateEntry(file: FileEntry) {
  return !mobile && !!workspaceAdapter.duplicate && (localNative || store.isWeb);
}
function directoryHasManagedFile(file: FileEntry) {
  return (
    file.kind === 'directory' &&
    managedFilePaths.value.some((path) => path.startsWith(`${file.path}/`))
  );
}
function startTreeRename(file: FileEntry) {
  if (
    !workspace.value || fileMutationDisabled(file) || directoryHasManagedFile(file)
  ) return;
  closeFileContextMenu();
  treeRename.value = { fileId: file.id, workspaceId: workspace.value.id };
}
function finishTreeRename(file: FileEntry) {
  if (treeRename.value?.fileId === file.id) treeRename.value = null;
}
async function renameTreeEntry(file: FileEntry, name: string) {
  if (treeRename.value?.workspaceId !== workspace.value?.id)
    throw new Error(t('工作区已切换，请重新选择后重试'));
  const current = workspace.value?.files.find((entry) => entry.id === file.id);
  if (!current || current.path !== file.path)
    throw new Error(t('文件位置已变化，请按 Esc 取消后重新选择'));
  if (fileMutationDisabled(current) || directoryHasManagedFile(current))
    throw new Error(t('当前条目暂时无法重命名，请检查权限或实时协作状态'));
  name = name.trim().normalize('NFC');
  if (!name) throw new Error(t('请填写一个名称'));
  if (/[\/\\]/.test(name)) throw new Error(t('名称不能包含路径分隔符'));
  if (file.kind === 'file' && isMarkdown(file.path) && !isMarkdown(name))
    name += file.name.match(/\.(md|markdown)$/i)?.[0] ?? '.md';
  if (isDataTableFilePath(file.path) && !/\.table\.json$/i.test(name)) name += '.table.json';
  const folder = parentPath(file.path);
  const path = `${folder ? `${folder}/` : ''}${name}`;
  const error = validatePath(path);
  if (error) throw new Error(error);
  if (path !== file.path) await withFileMutation(fileMutationIds([file]), () => store.renameEntry(file, path));
}
function fileDeleteDisabled(file: FileEntry) {
  return (
    fileMutationDisabled(file) ||
    (mobile && file.kind === 'directory') ||
    directoryHasManagedFile(file)
  );
}
const selectionDeleteDisabled = computed(() => contextEntries.value.some(fileDeleteDisabled));
function canDragEntry(file: FileEntry) {
  if (
    !workspace.value ||
    workspace.value.readOnly ||
    busy.value ||
    updateLock.value ||
    moveBusy.value
  )
    return false;
  return file.kind === 'directory'
    ? !managedFilePaths.value.some((path) => path.startsWith(`${file.path}/`))
    : !sessionBlocksFileMutation(file.id);
}
function planDropIn(folder: string): FileMovePreview[] | null {
  const drag = draggedEntry.value;
  if (
    !drag ||
    !workspace.value ||
    drag.workspaceId !== workspace.value.id ||
    !draggedSelection.value.length ||
    !draggedSelection.value.every(canDragEntry)
  )
    return null;
  try {
    return planFileMovePreview(draggedSelection.value, folder, workspace.value.files);
  } catch {
    return null;
  }
}
function fileDragStart(file: FileEntry, event: DragEvent) {
  const selection = selectedEntryIds.value.has(file.id)
    ? topLevelEntries(selectedEntries.value)
    : [file];
  if (!selection.every(canDragEntry) || !workspace.value || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  if (!selectedEntryIds.value.has(file.id)) {
    selectedEntryIds.value = new Set([file.id]);
    selectionAnchorId.value = file.id;
  }
  fileContextMenu.value = null;
  draggedEntry.value = { file, workspaceId: workspace.value.id };
  draggedSelection.value = selection;
  dropFolder.value = null;
  event.dataTransfer.setData('application/x-tano-entry-references', JSON.stringify({
    workspace: workspace.value.id,
    ids: store.referenceTargets.filter(target => selection.some(entry =>
      entry.id === target.id || (entry.kind === 'directory' && target.path.startsWith(`${entry.path}/`)),
    )).map(target => target.id),
  }));
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData(
    'application/x-tano-entry',
    selection.map((entry) => entry.id).join(','),
  );
}
function fileDragEnd() {
  draggedEntry.value = null;
  draggedSelection.value = [];
  dropFolder.value = null;
}
function fileDragOver(folder: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  const valid = planDropIn(folder) !== null;
  if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  dropFolder.value = valid ? folder : null;
}
function fileDragLeave(folder: string, event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (target?.contains(event.relatedTarget as Node | null)) return;
  if (dropFolder.value === folder) dropFolder.value = null;
}
async function fileDrop(folder: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  const drag = draggedEntry.value;
  const entries = draggedSelection.value;
  const preview = planDropIn(folder);
  fileDragEnd();
  if (!preview || !drag) return;
  moveBusy.value = true;
  optimisticFileMove.value = { workspaceId: drag.workspaceId, changes: preview };
  try {
    await withFileMutation(fileMutationIds(entries), async () => {
      for (const entry of entries) await store.moveEntry(entry, folder, drag.workspaceId);
    });
  } catch (error) {
    store.report(error);
  } finally {
    optimisticFileMove.value = null;
    moveBusy.value = false;
  }
}
async function fileContextAction(
  action:
    | 'open'
    | 'open-new-tab'
    | 'document'
    | 'folder'
    | 'table'
    | 'database'
    | 'rename'
    | 'delete'
    | 'copy'
    | 'copy-link'
    | 'copy-full-path'
    | 'duplicate'
    | 'open-default'
     | 'object'
    | 'metadata'
    | 'export'
    | 'reveal-entry',
) {
  const { window } = activeWindow.value;
  const file = fileContextMenu.value?.file;
  if (!file) return;
  const entries = contextEntries.value;
  closeFileContextMenu();
  if (entries.length > 1) {
    if (action === 'delete') {
      await removeDocuments(entries);
      return;
    }
    if (action === 'copy' || action === 'copy-full-path') {
      try {
        const paths = await Promise.all(
          entries.map((entry) =>
            action === 'copy-full-path' && workspace.value
              ? workspaceEntryPath(workspace.value.id, entry.path)
              : Promise.resolve(entry.path),
          ),
        );
        await navigator.clipboard.writeText(paths.join('\n'));
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'duplicate' && localNative && !mobile) {
      try {
        for (const entry of topLevelEntries(entries))
          await store.duplicateEntry(entry, workspace.value?.id);
      } catch (error) {
        store.report(error);
      }
    }
    return;
  }
  if (action === 'open' || action === 'open-new-tab') {
    await openEntry(file, action === 'open-new-tab');
    return;
  }
  if (action === 'object') {
    if (file.kind === 'file' && !isWorkspaceInternalPath(file.path)) showFileObject({
      type: isMarkdown(file.path) ? 'document' : 'asset',
      id: file.id,
    });
    return;
  }
  if (action === 'metadata' && workspace.value) {
    if (isMarkdown(file.path)) {
      await store.openFile(file);
      showDocumentProperties.value = true;
      setPaneSource(file.id, false);
    } else fileMetadataTarget.value = { fileId: file.id, workspaceId: workspace.value.id };
    return;
  }
  if (action === 'export' && workspace.value && attachments) {
    try { await attachments.exportAttachment(workspace.value.id, file.path); }
    catch (error) { store.report(error); }
    return;
  }
  if (action === 'open-default' || action === 'reveal-entry') {
    if (!workspace.value || !localNative || mobile) return;
    try {
      await openWorkspaceEntry(workspace.value.id, file.path, action === 'reveal-entry');
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'copy' || action === 'copy-full-path') {
    try {
      let path = file.path;
      if (action === 'copy-full-path') {
        if (!workspace.value || !localNative || mobile) return;
        path = await workspaceEntryPath(workspace.value.id, file.path);
      }
      await navigator.clipboard.writeText(path);
      fileContextTrigger?.focus({ preventScroll: true });
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'copy-link') {
    if (!store.isWeb || !workspace.value || file.kind !== 'file' ||
      (!isMarkdown(file.path) && !isDataTableFilePath(file.path))) return;
    try {
      await navigator.clipboard.writeText(pageRouteUrl(window.location.href, workspace.value.id, file.id));
      fileContextTrigger?.focus({ preventScroll: true });
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (
    fileMutationDisabled(file) ||
    (action === 'delete' && fileDeleteDisabled(file)) ||
    (action === 'rename' && directoryHasManagedFile(file))
  )
    return;
  if (action === 'duplicate') {
    if (!canDuplicateEntry(file)) return;
    try {
      await store.duplicateEntry(file, workspace.value?.id);
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'delete') {
    await removeDocument(file);
    return;
  }
  if (action === 'database') {
    try { await store.createFileDatabase(file.path); } catch (error) { store.report(error); }
    return;
  }
  if (action === 'document' || action === 'folder' || action === 'table') {
    await createNewEntry(action, file.path);
    return;
  }
  if (action === 'rename') startTreeRename(file);
}
function fileContextKeydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>('.file-context-menu button:not(:disabled)'),
  ];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else if (index === -1) next = event.key === 'ArrowDown' ? 0 : buttons.length - 1;
  else next = (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
  buttons[next]?.focus();
}
async function openDocumentLink(
  reference: string,
  newTab = false,
  documentPath = active.value?.path,
) {
  const { window } = activeWindow.value;
  if (!workspace.value || documentPath === undefined) return;
  if (/^(?:https?:\/\/|mailto:)/i.test(reference)) {
    if (native) {
      try {
        await openExternalUrl(reference);
      } catch (error) {
        store.report(error);
      }
    } else window.open(reference, '_blank', 'noopener,noreferrer');
    return;
  }
  const path = resolveWorkspaceReference(documentPath, reference);
  const file = workspace.value.files.find((entry) => entry.path === path && entry.kind === 'file');
  if (file) await openEntry(file, newTab);
  else store.report(t('此链接不在当前工作空间；请复制链接到浏览器打开'));
}
async function openWikiLink(target: string) {
  if (!workspace.value || !active.value) return;
  const result = resolveWikiLink(workspace.value.files, active.value.path, target);
  if ('error' in result) {
    store.report(
      result.error === 'ambiguous'
        ? t('有多篇同名文档，请在双向链接中写明文件夹路径')
        : result.error === 'invalid'
          ? t('双向链接目标无效')
          : t('当前工作空间中找不到这篇文档'),
    );
    return;
  }
  if (result.file.path !== active.value.path) await openEntry(result.file);
  if (active.value?.path !== result.file.path) return;
  if (!result.heading) return;
  await nextTick();
  const requested = result.heading.toLocaleLowerCase();
  const index = outline.value.findIndex(
    (heading) => heading.text.toLocaleLowerCase() === requested,
  );
  if (index < 0) {
    store.report(t('目标文档中找不到这个标题'));
    return;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const ready = source.value
      ? !!editorScroll.value?.querySelector('textarea')
      : !!editorScroll.value?.querySelectorAll(
          '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
        )[index];
    if (ready) {
      jumpToHeading(index);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  store.report(t('文档已打开，但暂时无法定位到标题'));
}
const outline = computed(() => headings(active.value?.content ?? ''));
const visibleOutline = computed(() => {
  const query = outlineSearch.value.trim().toLocaleLowerCase();
  const focused = outlineAutoCollapse.value && !query
    ? focusedOutlineIndices(outline.value, activeHeading.value)
    : undefined;
  return outline.value.flatMap((heading, index) =>
    (!focused || focused.has(index)) && (!query || heading.text.toLocaleLowerCase().includes(query))
      ? [{ heading, index }] : [],
  );
});
async function toggleOutlineSearch(event?: Event) {
  if (outlineSearchOpen.value) {
    outlineSearchOpen.value = false;
    outlineSearch.value = '';
    (event?.currentTarget as HTMLElement | undefined)?.blur();
    return;
  }
  outlineSearchOpen.value = true;
  await nextTick();
  outlineSearchInput.value?.focus();
}
function releaseOutlinePointerFocus(event: PointerEvent) {
  const { document } = activeWindow.value;
  if (panel.value !== 'outline' || touchLayout.value || !hoverOutline || outlinePinned.value || event.pointerType === 'touch') return;
  const surface = event.currentTarget as HTMLElement;
  const focused = document.activeElement;
  // Mouse-opened search must not act as a pin. Keyboard focus still expands
  // the outline until the pointer leaves it, and the search state is retained.
  if (isHTMLElement(focused) && surface.contains(focused)) focused.blur();
}
function toggleOutlinePin(event: MouseEvent) {
  outlinePinned.value = !outlinePinned.value;
  if (!outlinePinned.value) (event.currentTarget as HTMLButtonElement).blur();
}
function closeOutlineContextMenu() {
  outlineContextMenu.value = null;
}
function openOutlineContextMenu(event: MouseEvent) {
  const { window } = activeWindow.value;
  if (panel.value !== 'outline') return;
  event.preventDefault();
  closeFileContextMenu();
  closeDirectoryContextMenu();
  closePageContextMenu();
  if (hoverOutline && !outlinePinned.value) toggleOutlinePin(event);
  const x = Math.max(8, event.clientX);
  const y = Math.max(8, event.clientY);
  outlineContextMenu.value = { x, y };
  void nextTick(() => {
    const element = outlineContextMenuElement.value;
    if (!element || !outlineContextMenu.value) return;
    outlineContextMenu.value = {
      x: Math.min(x, Math.max(8, window.innerWidth - element.offsetWidth - 8)),
      y: Math.min(y, Math.max(8, window.innerHeight - element.offsetHeight - 8)),
    };
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });
}
function toggleOutlineSide() {
  outlineOnLeft.value = !outlineOnLeft.value;
  closeOutlineContextMenu();
}
function outlineContextKeydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeOutlineContextMenu();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(outlineContextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : current < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
const headingViewport = new HeadingViewport();
let pendingHeadingScroll: { top: number; coverBottom: number } | undefined;
function updateActiveHeading(snapshot?: typeof pendingHeadingScroll) {
  const container = documentScroll.value;
  const cover = container?.querySelector<HTMLElement>('.document-cover');
  const pane = container?.closest<HTMLElement>('.workspace-pane');
  // Measure in the inspector's containing pane, including partially scrolled covers.
  outlineCoverBottom.value = snapshot?.coverBottom ?? (cover && pane
    ? Math.max(0, cover.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 16)
    : 0);
  const root = editorScroll.value;
  if (!container || !root || source.value || !outline.value.length) return;
  activeHeading.value = Math.min(headingViewport.active(root, container, 100, snapshot?.top), outline.value.length - 1);
}
function scheduleActiveHeading(event?: Event) {
  const container = documentScroll.value;
  if (event?.type === 'scroll' && event.target !== container) return;
  if (event?.type === 'scroll' && container) {
    // Read before animation-frame callbacks move floating controls. Even a
    // scrollTop getter after those writes can force pending layout to finish.
    const cover = container.querySelector<HTMLElement>('.document-cover');
    const pane = container.closest<HTMLElement>('.workspace-pane');
    pendingHeadingScroll = { top: container.scrollTop, coverBottom: cover && pane
      ? Math.max(0, cover.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 16) : 0 };
  } else pendingHeadingScroll = undefined;
  const targetWindow = container ? ownerWindow(container) : activeWindow.value.window;
  if (headingFrame !== undefined && headingWindow === targetWindow) return;
  if (headingFrame !== undefined) headingWindow?.cancelAnimationFrame(headingFrame);
  headingWindow = targetWindow;
  headingFrame = targetWindow.requestAnimationFrame(() => {
    headingFrame = undefined;
    const snapshot = pendingHeadingScroll;
    pendingHeadingScroll = undefined;
    updateActiveHeading(snapshot);
  });
}
watch([() => active.value?.content, source], () => {
  headingViewport.invalidate();
  void nextTick(scheduleActiveHeading);
}, {
  flush: 'post',
});
watch([documentScroll, editorScroll, showPageTitle], ([container, root], _, cleanup) => {
  const invalidate = () => { headingViewport.invalidate(); scheduleActiveHeading(); };
  invalidate();
  scheduleActiveHeading();
  if (!container) return;
  // A cover can be added or removed without changing the outline. Also follow
  // window/sidebar/split resizing and title or toolbar layout changes.
  const observer = new (ownerWindow(container).ResizeObserver)(invalidate);
  observer.observe(container);
  for (const element of container.querySelectorAll('.document-main, .document-title'))
    observer.observe(element);
  // Font/image loading and folded/expanded node views can move headings without
  // changing Markdown. Gutter button updates are deliberately excluded.
  const mutations = new (ownerWindow(container).MutationObserver)(records => {
    if (records.some(record => {
      const element = isElement(record.target) ? record.target : record.target.parentElement;
      return element?.closest('.tano-prose') || [...record.addedNodes, ...record.removedNodes]
        .some(node => isElement(node) && (node.matches('.tano-prose') || node.querySelector('.tano-prose')));
    })) invalidate();
  });
  if (root) {
    observer.observe(root);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    root.addEventListener('load', invalidate, true);
  }
  cleanup(() => { observer.disconnect(); mutations.disconnect(); root?.removeEventListener('load', invalidate, true); });
}, { flush: 'post' });
const noteCount = computed(
  () => workspace.value?.files.filter((f) => f.kind === 'file' && !isWorkspaceInternalPath(f.path) && (isMarkdown(f.path) || isDataTableFilePath(f.path))).length ?? 0,
);
const { hits: searchHits, busy: searching, error: searchError } = useWorkspaceSearch({
  query: input,
  enabled: () => modal.value === 'search',
  workspace,
  search: (query, signal) => store.search(query, signal),
});
const searchResults = computed(() => {
  const files = workspace.value?.files.filter((f) => f.kind === 'file' && isMarkdown(f.path)) ?? [];
  const query = input.value.trim().toLocaleLowerCase();
  if (!query) return [];
  return searchHits.value.flatMap((hit) => {
    const file = files.find((file) => file.id === hit.id && file.path === hit.path);
    if (!file) return [];
    const excerpt = hit.excerpt.replace(/\s+/g, ' ').trim();
    const preview = excerpt.toLocaleLowerCase().includes(query)
      ? excerpt
      : hit.path.toLocaleLowerCase().includes(query)
        ? hit.path
        : excerpt || hit.path;
    return [{ ...file, preview }];
  });
});
function searchResultLocation(path: string) {
  return [workspace.value?.name ?? t('工作区'), ...path.split('/').slice(0, -1)].join(' › ');
}
async function openSearchResult(file: FileEntry) {
  modal.value = '';
  await store.openFile(file);
  if (store.active?.id === file.id) recordHelpCompleted('find');
}
function searchHighlightParts(text: string) {
  const query = input.value.trim();
  if (!query) return [{ text, matched: false }];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts: { text: string; matched: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), matched: false });
    parts.push({ text: match[0], matched: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  return parts.length ? parts : [{ text, matched: false }];
}
const modalTitle = computed(() => {
  const titles = {
    newTab: t('打开文件'),
    search: t('找到那一页'),
    delete: `${store.isDemo ? t('删除') : store.isWeb ? t('删除在线文档') : mobile ? t('移入手机回收站') : t('移入回收站')}${modalDeleteEntries.value.length > 1 ? t(' · {0} 项', [modalDeleteEntries.value.length]) : ''}`,
    saveAs: t('另存为新文档'),
  };
  return modal.value ? titles[modal.value] : '';
});

function showModal(kind: Exclude<typeof modal.value, ''>, target?: FileEntry) {
  if (store.busy || (workspace.value?.readOnly && ['delete', 'saveAs'].includes(kind)))
    return;
  menu.value = false;
  workspaceMenu.value = false;
  fileContextMenu.value = null;
  directoryContextMenu.value = null;
  settingsPanel.value = false;
  modalTarget.value = target ?? null;
  modalDeleteEntries.value =
    kind === 'delete'
      ? target && selectedEntryIds.value.has(target.id)
        ? [...selectedEntries.value]
        : target
          ? [target]
          : (active.value ? [workspace.value?.files.find((file) => file.id === active.value?.id)].filter((file): file is FileEntry => !!file) : [])
      : [];
  modalDeleteContents.value = kind === 'delete' ? [...(workspace.value?.files ?? [])] : [];
  modalDeleteWorkspaceId.value = kind === 'delete' ? workspace.value?.id : undefined;
  modalError.value = '';
  input.value =
    kind === 'saveAs'
      ? (active.value?.path.replace(/\.(md|markdown)$/i, '-副本.md') ?? '')
      : '';
  modal.value = kind;
  void nextTick(() => {
    inputEl.value?.focus();
  });
}
async function removeDocuments(entries: FileEntry[]) {
  if (!entries.length || entries.some(fileDeleteDisabled)) return;
  if (store.isDemo || store.isWeb) {
    showModal('delete', entries[0]);
    return;
  }
  menu.value = false;
  try {
    await store.removeEntries(entries, workspace.value?.id, [...(workspace.value?.files ?? [])]);
    selectActiveFileInTree();
  } catch (error) {
    store.report(error);
  }
}
async function removeDocument(target?: FileEntry) {
  if (!target && (editorReadonly.value || sessionBlocksFileMutation(active.value?.id ?? activeId.value) || editing.activeBusy)) return;
  const entries = target
    ? [target]
    : (active.value ? [workspace.value?.files.find((file) => file.id === active.value?.id)].filter((file): file is FileEntry => !!file) : []);
  await removeDocuments(entries);
}
async function createNewDocument() {
  await createNewEntry('document');
}
async function createNewEntry(kind: 'document' | 'folder' | 'table', parent = '') {
  if (store.busy || workspace.value?.readOnly || updateLock.value) return;
  if (webPageRouting && !pageRouteReady) initialPageRouteSuperseded = true;
  menu.value = false;
  workspaceMenu.value = false;
  fileContextMenu.value = null;
  directoryContextMenu.value = null;
  modal.value = '';
  try {
    if (kind === 'folder') {
      await store.createUntitledFolder(parent);
      return;
    }
    if (kind === 'table') {
      await store.createDataTable('blank', parent);
      if (compactPanes.value) sidebar.value = false;
      return;
    }
    await store.createUntitledDocument(parent);
    if (compactPanes.value) sidebar.value = false;
    await nextTick();
    for (let attempt = 0; attempt < 10; attempt++) {
      const target = source.value
        ? sourceEditor.value
        : editorScroll.value?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (target) {
        target.focus();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  } catch (error) {
    store.report(error);
  }
}
let detachingTab = false;

function detachedTitle(tab: DocumentTab) {
  return assistantTab.value?.id === tab.id ? assistantTab.value.title : documentTabLabel(tab);
}

async function detachTab(id: string, drop?: DetachedDropPoint, settled?: () => void) {
  if (!native || mobile || detachingTab || !workspace.value || store.busy || drop?.insideSourceWindow) {
    settled?.();
    return;
  }
  const tab = store.tabs.find(item => item.id === id);
  if (!tab) { settled?.(); return; }
  detachingTab = true;
  try {
    await editing.flush();
    let position: { x: number; y: number } | undefined;
    if (drop) {
      const { monitorFromPoint } = await import('@tauri-apps/api/window');
      const monitor = await monitorFromPoint(drop.x, drop.y);
      const scale = monitor?.scaleFactor ?? await activeWindow.value.native!.scaleFactor();
      position = detachedWindowPosition(drop, scale, 1100, 760, monitor?.workArea);
    }
    const windowId = crypto.randomUUID();
    await auxiliaryWindows.open(windowId, 'tab', detachedTitle(tab) + ' — Tano / 同页', position, entry => {
      activeWindow.value = entry.context;
      store.moveTabToAuxiliaryWindow(id, windowId);
    });
  } catch (error) {
    store.report(error);
  } finally {
    detachingTab = false;
    settled?.();
  }
}

const workspaceExporting = ref(false);
const workspaceExportError = ref('');
const workspaceDeleting = ref(false);
const workspaceDeletionError = ref('');
watch(() => workspace.value?.id, () => { workspaceDeletionError.value = ''; });
async function deleteWorkspace(workspaceId: string) {
  if (workspaceDeleting.value || store.busy || workspaceExporting.value || store.workspaceSettingsSaving) return;
  workspaceDeleting.value = true;
  workspaceDeletionError.value = '';
  try {
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换，请重新确认删除'));
    await editing.flush();
    if (!await store.deleteWorkspace(workspaceId)) throw new Error(store.fatal || t('无法删除工作区，请稍后重试'));
    settingsPanel.value = false;
    workspaceMenu.value = false;
    if (native && !mobile) await auxiliaryWindows.close('settings');
  } catch (error) {
    workspaceDeletionError.value = error instanceof Error ? error.message : String(error);
  } finally {
    workspaceDeleting.value = false;
  }
}
async function exportWorkspace(workspaceId: string) {
  if (workspaceExporting.value || workspaceDeleting.value) return;
  workspaceExporting.value = true;
  workspaceExportError.value = '';
  const assertCurrent = () => {
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换，请重新导出'));
  };
  try {
    assertCurrent();
    await editing.flush();
    if (!await store.flush()) throw new Error(t('还有未保存的修改，请处理保存错误后再导出'));
    assertCurrent();
    await store.refresh();
    assertCurrent();
    const current = workspace.value!;
    const blob = await workspaceArchive(current, workspaceAdapter, attachments?.readAttachment, assertCurrent);
    const filename = workspaceArchiveName(current.name);
    if (native) {
      const { saveDocumentExport } = await import('./native-document-export');
      await saveDocumentExport(blob, filename, 'zip');
    } else {
      const { downloadExport } = await import('./document-export');
      downloadExport(blob, filename);
    }
  } catch (error) {
    workspaceExportError.value = String(error instanceof Error ? error.message : error);
  } finally { workspaceExporting.value = false; }
}
const settingsContext = computed(() => ({
  pluginPages: settingsWorkspace.value ? store.pluginSettingsPages : [],
  workspace: settingsWorkspace.value
    ? {
        id: settingsWorkspace.value.id,
        name: settingsWorkspace.value.name,
        path: settingsWorkspace.value.path,
        readOnly: settingsWorkspace.value.readOnly,
        canDelete: settingsWorkspace.value.canDelete,
        canManageSettings: settingsWorkspace.value.canManageSettings,
      }
    : null,
  activeFile: settingsWorkspace.value && store.active ? { id: store.active.id, path: store.active.path } : null,
  workspaceSettings: store.workspaceSettings,
  workspacePages: settingsWorkspace.value?.files.filter(file => file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path)).map(file => ({ id: file.id, path: file.path })) ?? [],
  workspaceSettingsError: store.workspaceSettingsError,
  workspaceSettingsSaving: store.workspaceSettingsSaving,
  workspaceExporting: workspaceExporting.value,
  workspaceExportError: workspaceExportError.value,
  workspaceDeletionSupported: !!workspaceAdapter.deleteWorkspace,
  workspaceDeleting: workspaceDeleting.value || store.busy,
  workspaceDeletionError: workspaceDeletionError.value,
  mode: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
  defaultSource: defaultSource.value,
  theme: theme.value,
  appearance: appearance.value,
  visualFontChoice: visualFontChoice.value,
  customFontName: customFontName.value,
  splitFontSettings: splitFontSettings.value,
  revealMarkdown: revealMarkdown.value,
  toolbarMode: toolbarMode.value,
  shortcuts: shortcuts.value,
  showPageTitle: showPageTitle.value,
  showDocumentProperties: showDocumentProperties.value,
  showDocumentDiscussion: showDocumentDiscussion.value,
  showOutline: showOutline.value,
  outlineOnLeft: outlineOnLeft.value,
  visualFontSize: visualFontSize.value,
  sourceFontSize: sourceFontSize.value,
  editorPreferences: editorPreferences.value,
  historyEnabled: !!extensions.historyEnabled,
  capabilities: store.capabilities,
  capabilityError: store.capabilityError,
  capabilitySaving: store.capabilitySaving,
  version: updates.state.status?.currentVersion ?? appVersion,
  updates: updates.state,
}));

function openSettings(page: SettingsPageId = readSettingsPage(settingsPage.value)) {
  menu.value = false;
  workspaceMenu.value = false;
  settingsPage.value = page === 'preferences' ? 'appearance' : page;
  const pane = settingsWorkspace.value && store.panes.find(pane => pane.tabs.includes(SETTINGS_TAB_ID));
  if (pane) {
    store.focusPane(pane.id);
    store.openViewTab(SETTINGS_TAB_ID);
    return;
  }
  settingsPanel.value = true;
}
function settingsAction(
  action: 'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out',
) {
  if (!settingsWorkspace.value && ['reveal', 'agent', 'history', 'recycle'].includes(action)) return;
  settingsPanel.value = false;
  if (action === 'open-folder') void store.openWorkspace();
  else if (action === 'reveal') void store.reveal();
  else if (action === 'agent') agentPanel.value = true;
  else if (action === 'history') extensions.showHistory?.();
  else if (action === 'recycle') recyclePanel.value = true;
}
function toggleWorkspaceMenu() {
  workspaceMenu.value = !workspaceMenu.value;
  if (!workspaceMenu.value) closeWorkspaceEntryContextMenu();
  if (workspaceMenu.value && store.isWeb) void store.refreshWorkspaces();
}
watch(workspaceMenu, (opened) => {
  if (!opened) closeWorkspaceEntryContextMenu();
});
async function createNewWorkspace() {
  if (store.busy) return;
  menu.value = false;
  workspaceMenu.value = false;
  fileContextMenu.value = null;
  directoryContextMenu.value = null;
  settingsPanel.value = false;
  modal.value = '';
  await store.createWorkspace();
  if (workspace.value) sidebarView.value = 'repository';
}
async function leaveWorkspace() {
  if (store.busy || !workspace.value) return;
  try {
    await editing.flush();
    if (await store.leaveWorkspace()) workspaceMenu.value = false;
  } catch (error) {
    store.report(error);
  }
}
let returningHome = false;
async function returnHome(event: MouseEvent) {
  const { window } = activeWindow.value;
  if (
    native ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  if (store.busy || returningHome) return;
  returningHome = true;
  try {
    if (!(await store.flush())) {
      store.report(t('还有未保存的修改，请保存或另存副本后再返回首页。'));
      return;
    }
    await editing.flush();
    window.location.assign('/');
  } catch (error) {
    store.report(error);
  } finally {
    returningHome = false;
  }
}
async function submitModal() {
  if (modalBusy.value) return;
  modalError.value = '';
  modalBusy.value = true;
  try {
    const kind = modal.value;
    if (
      modalTarget.value &&
      kind === 'delete' &&
      sessionBlocksFileMutation(modalTarget.value.id)
    )
      throw new Error(t('请先结束此文档的实时协作'));
    if (kind === 'delete') {
      if (modalDeleteEntries.value.some(fileDeleteDisabled))
        throw new Error(t('所选条目中有无法移除的文件，请检查权限或实时协作状态'));
      await withFileMutation(fileMutationIds(modalDeleteEntries.value), () => store.removeEntries(
        modalDeleteEntries.value,
        modalDeleteWorkspaceId.value,
        modalDeleteContents.value,
      ));
      selectActiveFileInTree();
    } else {
      let path = input.value.trim();
      if (!isMarkdown(path)) path += '.md';
      const error = validatePath(path);
      if (error) throw new Error(error);
      if (!input.value.trim()) throw new Error(t('请填写一个名称'));
      if (kind === 'saveAs' && active.value) await store.saveCopy(active.value, path);
    }
    modal.value = '';
  } catch (e) {
    if (modal.value === 'delete') {
      const files = workspace.value?.files ?? [];
      modalDeleteEntries.value = modalDeleteEntries.value.flatMap(
        (file) => files.find((entry) => entry.id === file.id) ?? [],
      );
      modalDeleteContents.value = [...files];
    }
    modalError.value = e instanceof Error ? e.message : String(e);
  } finally {
    modalBusy.value = false;
  }
}
function documentOutputOptions(): DocumentExportOptions | undefined {
  const doc = active.value,
    currentWorkspace = workspace.value;
  if (!doc) return;
  const title = showPageTitle.value
    ? editorScroll.value?.querySelector<HTMLTextAreaElement>('.document-title-wrap textarea')?.value
    : undefined;
  return {
    id: doc.id,
    path: doc.path,
    content: doc.content,
    title,
    capabilities: store.capabilities,
    referenceTargets: store.referenceTargets,
    tableLayouts: doc.tableLayout?.file.tables,
    resolveImage: (reference: string) =>
      attachments
        ? attachments.imageUrl(currentWorkspace, doc.path, reference)
        : safeRemoteImage(reference),
    fontFamily: selectedVisualFontFamily.value,
    fontSize: visualFontSize.value,
  };
}
async function printActiveDocument() {
  if (printBusy.value) return;
  const options = documentOutputOptions();
  if (!options) return;
  menu.value = false;
  printBusy.value = true;
  try {
    const { printDocument } = await import('./document-print');
    await printDocument(options);
  } catch (reason) {
    store.report(t('打印失败：{0}', [reason instanceof Error ? reason.message : String(reason)]));
  } finally {
    printBusy.value = false;
  }
}
async function exportDocument(format: DocumentExportFormat) {
  if (exportBusy.value) return;
  const options = documentOutputOptions();
  if (!options) return;
  menu.value = false;
  exportBusy.value = true;
  try {
    const { downloadExport, exportFilename, renderDocumentExport } = await import('./document-export');
    const blob = await renderDocumentExport(options, format);
    const filename = exportFilename(options.path, format);
    if (localNative) {
      const { saveDocumentExport } = await import('./native-document-export');
      if (!(await saveDocumentExport(blob, filename, format))) return;
    } else downloadExport(blob, filename);
    recordHelpCompleted('export-document');
  } catch (reason) {
    store.report(reason);
  } finally {
    exportBusy.value = false;
  }
}
function jumpToHeading(index: number, userInitiated = false) {
  if (!outline.value[index]) return;
  if (userInitiated && touchLayout.value) touchOutlineOpen.value = false;
  activeHeading.value = index;
  if (source.value) {
    if (!sourceEditor.value) return;
    const toolbarHeight = documentScroll.value?.querySelector('.editor-toolbar')?.clientHeight ?? 0;
    sourceEditor.value.jumpToLine(outline.value[index].line, toolbarHeight);
  } else {
    const heading = editorScroll.value
      ?.querySelectorAll(
        '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
      )
      [index];
    if (!heading) return;
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (userInitiated) recordHelpCompleted('reading');
}
function toggleSidebar() {
  if (activeWindow.value.id !== 'main') return;
  sidebar.value = !sidebar.value;
  workspaceMenu.value = false;
}
function handleWorkbenchShortcut(event: KeyboardEvent) {
  if (openingWorkspace.value) return;
  if (event.defaultPrevented || importPanel.value || settingsPanel.value || commandPaletteOpened.value || updateLock.value || modal.value) return;
  let action: (() => void) | undefined;
  const standardEditor = !!active.value && !editing.active && !editing.activeBusy;
  if (activeWindow.value.id === 'main' && workspace.value && isSidebarToggleShortcut(event, shortcuts.value)) action = toggleSidebar;
  else if (matchesShortcut(event, 'save', shortcuts.value)) action = () => { void store.flush(); };
  else if (active.value && matchesShortcut(event, 'print', shortcuts.value)) action = () => { void printActiveDocument(); };
  else if (standardEditor && matchesShortcut(event, 'toggleSource', shortcuts.value)) action = () => { source.value = !source.value; };
  else if (standardEditor && !source.value && matchesShortcut(event, 'toggleMarkdownReveal', shortcuts.value)) action = () => { revealMarkdown.value = !revealMarkdown.value; };
  else if (workspace.value && assistant.available && matchesShortcut(event, 'toggleAssistant', shortcuts.value)) action = toggleAssistant;
  else if (matchesShortcut(event, 'findDocument', shortcuts.value)) action = () => showModal('search');
  else if (workspace.value && matchesShortcut(event, 'openDocument', shortcuts.value)) action = () => showModal('newTab');
  else if (workspace.value && matchesShortcut(event, 'newDocument', shortcuts.value)) action = () => { void createNewDocument(); };
  else if (workspace.value && matchesShortcut(event, 'commandPalette', shortcuts.value)) action = () => { commandPaletteOpened.value = true; };
  if (!action && workspace.value) {
    const command = pluginShortcutCommand(event, store.pluginCommands, shortcuts.value);
    if (command) action = () => { void store.interactWithPlugin({ workspaceId: workspace.value!.id, pluginId: command.pluginId,
      instanceId: command.instanceId, kind: 'command', name: command.id, payload: { workspaceId: workspace.value!.id, fileId: store.active?.id } }).catch(store.report); };
  }
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}
function handlePageSearchShortcut(event: KeyboardEvent) {
  if (openingWorkspace.value) return;
  if (
    importPanel.value ||
    settingsPanel.value ||
    commandPaletteOpened.value ||
    updateLock.value ||
    modal.value ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.defaultPrevented
  )
    return;
  const search = paneSearches.get(store.activePaneId);
  if (!search) return;
  const find = matchesShortcut(event, 'pageSearch', shortcuts.value);
  const replace = matchesShortcut(event, 'pageReplace', shortcuts.value);
  if (find || replace) {
    event.preventDefault();
    event.stopPropagation();
    openPaneSearch(store.activePaneId, replace);
  } else if (
    search.isOpen() &&
    !(isElement(event.target) && event.target.closest('.page-search')) &&
    (matchesShortcut(event, 'closeSearch', shortcuts.value) ||
      matchesShortcut(event, 'nextMatchFromEditor', shortcuts.value) ||
      matchesShortcut(event, 'previousMatchFromEditor', shortcuts.value))
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (matchesShortcut(event, 'closeSearch', shortcuts.value)) search.close();
    else search.navigate(matchesShortcut(event, 'previousMatchFromEditor', shortcuts.value) ? -1 : 1);
  }
}
function keydown(event: KeyboardEvent) {
  const { document } = activeWindow.value;
  if (openingWorkspace.value) return;
  if (importPanel.value) return;
  if (settingsPanel.value) {
    if (event.key === 'Escape') settingsPanel.value = false;
    return;
  }
  if (event.key === 'Escape' && fileContextMenu.value) {
    event.preventDefault();
    closeFileContextMenu(true);
    return;
  }
  if (event.key === 'Escape' && directoryContextMenu.value) {
    event.preventDefault();
    closeDirectoryContextMenu();
    return;
  }
  if (event.key === 'Escape' && outlineContextMenu.value) {
    event.preventDefault();
    closeOutlineContextMenu();
    return;
  }
  if (updateLock.value && event.key !== 'Tab') {
    if (event.key === 'Escape' || event.ctrlKey || event.metaKey) event.preventDefault();
    return;
  }
  const treeRow = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '.tree-scroll .tree-row[data-entry-id]',
  );
  if (treeRow && !modal.value) {
    if (event.key === 'F2') {
      event.preventDefault();
      const file = workspace.value?.files.find((entry) => entry.id === treeRow.dataset.entryId);
      if (
        file &&
        !fileMutationDisabled(file) &&
        !directoryHasManagedFile(file) &&
        (!store.isWeb || file.kind === 'file')
      )
        startTreeRename(file);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectedEntryIds.value = new Set(fileTree.value?.getVisibleIds() ?? []);
      selectionAnchorId.value = treeRow.dataset.entryId ?? null;
      return;
    }
    if (event.key === 'Delete' && selectedEntries.value.length) {
      event.preventDefault();
      void removeDocuments([...selectedEntries.value]);
      return;
    }
    if (event.key === 'Escape' && selectedEntryIds.value.size) {
      event.preventDefault();
      selectActiveFileInTree();
      return;
    }
  }
  if (event.key === 'Escape' && !modalBusy.value) {
    modal.value = '';
    menu.value = false;
    workspaceMenu.value = false;
    if (compactPanes.value) sidebar.value = false;
  }
  if (event.key === 'Tab' && modal.value) {
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        '.modal button:not(:disabled), .modal input, .modal a',
      ),
    ];
    const first = targets[0],
      last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (store.pending) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function mobileBack(event: Event) {
  // Android's system back first dismisses the current surface, then navigates.
  // Keep in-flight mutations mounted until their normal completion path runs.
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (dialog) {
    event.preventDefault();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    return;
  }
  const layer = [agentPanel, objectPanel, recyclePanel, historyPanel, referenceGraphOpened, commandPaletteOpened, templateLibraryOpen, touchOutlineOpen].find(opened => opened.value);
  const dismiss = modalBusy.value || updateLock.value || busy.value ? () => {}
    : fileContextMenu.value ? () => closeFileContextMenu(true)
    : directoryContextMenu.value ? closeDirectoryContextMenu
    : workspaceEntryContextMenu.value ? closeWorkspaceEntryContextMenu
    : pageContextMenu.value ? closePageContextMenu
    : outlineContextMenu.value ? closeOutlineContextMenu
    : menu.value ? () => { menu.value = false; }
    : workspaceMenu.value ? () => { workspaceMenu.value = false; }
    : modal.value ? () => { modal.value = ''; }
    : settingsPanel.value ? () => { settingsPanel.value = false; }
    : importPanel.value ? () => { importPanel.value = false; }
    : selectedDiff.value ? () => { selectedDiff.value = undefined; }
    : selectionTodo.value ? () => { selectionTodo.value = undefined; }
    : layer ? () => { layer.value = false; }
    : compactPanes.value && sidebar.value ? () => { sidebar.value = false; }
    : assistant.opened ? () => { assistant.opened = false; }
    : canNavigatePage(-1) ? () => navigatePage(-1) : undefined;
  if (dismiss) { event.preventDefault(); dismiss(); }
}
async function mobileVisibility() {
  try {
    await handleMobileVisibility({
      mobile,
      hasWorkspace: !!workspace.value,
      visibilityState: document.visibilityState,
      flushWorkspace: () => store.flush(),
      flushEditing: () => editing.flush(),
      refreshWorkspace: () => store.refresh(),
      synchronize: () => extensions.refresh(),
    });
  } catch (reason) {
    store.report(reason);
  }
}
function outsideClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.calendar-view-picker')) calendarModeOpen.value = false;
  if (!target.closest('.file-context-menu')) closeFileContextMenu();
  if (!target.closest('.directory-context-menu')) closeDirectoryContextMenu();
  if (!target.closest('.workspace-entry-context-menu')) closeWorkspaceEntryContextMenu();
  if (!target.closest('.page-context-menu')) closePageContextMenu();
  if (!target.closest('.outline-context-menu')) closeOutlineContextMenu();
  if (!target.closest('.dropdown, .menu-wrap, .sidebar-bottom')) {
    menu.value = false;
    workspaceMenu.value = false;
  }
}
function dismissFileContextMenu() {
  closeFileContextMenu();
}
function outsideContextMenu(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.tree-row')) closeFileContextMenu();
  if (!event.defaultPrevented && !(event.target as HTMLElement).closest('.directory-context-menu'))
    closeDirectoryContextMenu();
  if (!event.defaultPrevented && !(event.target as HTMLElement).closest('.workspace-entry-context-menu'))
    closeWorkspaceEntryContextMenu();
  if (!event.defaultPrevented) {
    closePageContextMenu();
    closeOutlineContextMenu();
  }
}
function dismissPageContextMenu() {
  closePageContextMenu();
}
watch(sidebar, (visible) => {
  if (!visible) {
    closeFileContextMenu();
    closeDirectoryContextMenu();
    closeOutlineContextMenu();
  }
});
function bindAuxiliaryEvents(context: WindowContext) {
  const focus = () => {
    activeWindow.value = context;
    const paneId = store.windowLayouts[context.id]?.activePaneId;
    if (paneId) store.focusPane(paneId);
  };
  const handlers: [string, EventListener, boolean][] = [
    ['focus', focus, true], ['pointerdown', focus, true],
    ['keydown', routeConfiguredEditorShortcut as EventListener, true],
    ['keydown', handleWorkbenchShortcut as EventListener, true],
    ['keydown', handlePageSearchShortcut as EventListener, true],
    ['keydown', keydown as EventListener, false],
    ['click', outsideClick as EventListener, false],
    ['contextmenu', outsideContextMenu as EventListener, false],
    ['scroll', dismissPageContextMenu, true], ['scroll', closeOutlineContextMenu, true],
    ['resize', dismissPageContextMenu, false], ['resize', closeOutlineContextMenu, false],
  ];
  for (const [name, handler, capture] of handlers) context.window.addEventListener(name, handler, capture);
  const stopMotion = installInteractionMotion(context.document);
  return () => {
    for (const [name, handler, capture] of handlers) context.window.removeEventListener(name, handler, capture);
    stopMotion();
    if (activeWindow.value === context) activeWindow.value = mainWindow;
  };
}
const auxiliaryEventDisposers = new Map<string, () => void>();
watch(() => [...auxiliaryWindows.entries.values()], entries => {
  for (const [id, dispose] of auxiliaryEventDisposers) {
    if (!entries.some(entry => entry.id === id)) { dispose(); auxiliaryEventDisposers.delete(id); }
  }
  for (const entry of entries) {
    if (!auxiliaryEventDisposers.has(entry.id)) auxiliaryEventDisposers.set(entry.id, bindAuxiliaryEvents(entry.context));
  }
}, { flush: 'sync' });
const focusMain = () => {
  activeWindow.value = mainWindow;
  const paneId = store.windowLayouts.main.activePaneId;
  if (paneId) store.focusPane(paneId);
};
window.addEventListener('focus', focusMain);
window.addEventListener('pointerdown', focusMain, true);
onBeforeUnmount(() => {
  window.removeEventListener('focus', focusMain);
  window.removeEventListener('pointerdown', focusMain, true);
  for (const dispose of auxiliaryEventDisposers.values()) dispose();
  auxiliaryEventDisposers.clear();
});

let unlistenClose: (() => void) | undefined;
let unlistenWatchError: (() => void) | undefined;

onMounted(async () => {
  window.addEventListener('keydown', handleWorkbenchShortcut, true);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keydown', handlePageSearchShortcut, true);
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('click', outsideClick);
  window.addEventListener('contextmenu', outsideContextMenu);
  window.addEventListener('scroll', dismissFileContextMenu, true);
  window.addEventListener('scroll', closeDirectoryContextMenu, true);
  window.addEventListener('scroll', dismissPageContextMenu, true);
  window.addEventListener('scroll', closeOutlineContextMenu, true);
  window.addEventListener('resize', dismissFileContextMenu);
  window.addEventListener('resize', closeDirectoryContextMenu);
  window.addEventListener('resize', dismissPageContextMenu);
  window.addEventListener('resize', closeOutlineContextMenu);
  if (!isAuxiliaryWindow) window.addEventListener('resize', constrainSidebarToViewport);
  document.addEventListener('visibilitychange', mobileVisibility);
  window.addEventListener('tano:back', mobileBack);
  if (webPageRouting) {
    initializePageHistory();
    window.addEventListener('popstate', handlePagePopState);
  }
  try {
    await workbenchSession.initialize(async () => {
      if (props.createWorkspace) await createNewWorkspace();
      else await store.initialize(initialPageRoute?.workspaceId ?? (props.resolveInitialWorkspace ? await props.resolveInitialWorkspace() : props.initialWorkspace));
    });
  } finally {
    navigation.restore();
    if (navigation.homeModule.value !== 'plan' && !extensionViews.some(view => view.id === navigation.homeModule.value && view.sidebar)) navigation.homeModule.value = 'plan';
    plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
    startupPending.value = false;
  }
  if (unmounted) return;
  emit('ready');
  await nextTick();

  if (webPageRouting) {
    pageRouteReady = true;
    if (props.createWorkspace || initialPageRouteSuperseded) writePageRoute(true);
    else await applyPageRoute();
  }
  if (native && !mobile) {
    void updates.initialize();
  }
  if (native) {
    if (localNative)
      unlistenWatchError = await listen<string>('workspace-watch-error', (event) => {
        store.enableWorkspacePolling();
        store.report(t('文件监听遇到错误：{0}。目录仍会定期自动检查。', [event.payload]));
      });
    if (!mobile)
      unlistenClose = await mainWindow.native!.onCloseRequested(async (event) => {
        event.preventDefault();
        if (updates.state.phase === 'installing') return;
        try {
          await editing.flush();
          if (await store.flush()) {
            await assistant.settle();
            await inlineRunner.settle();
            await agentInbox.settle();
            if (!(await auxiliaryWindows.closeAll())) { agentInbox.resume(); return; }
            await editing.suspendAll();
            await mainWindow.native!.destroy();
          } else store.report(t('还有未保存的内容，窗口已保留。请先保存或另存副本。'));
        } catch (error) {
          agentInbox.resume();
          store.report(error);
        }
      });
  }
});
onBeforeUnmount(() => {
  unmounted = true;
  document.documentElement.style.removeProperty('--sidebar-width');
  if (headingFrame !== undefined) headingWindow?.cancelAnimationFrame(headingFrame);
  workbenchSession.release();
  window.removeEventListener('keydown', handleWorkbenchShortcut, true);
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('keydown', handlePageSearchShortcut, true);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('click', outsideClick);
  window.removeEventListener('contextmenu', outsideContextMenu);
  window.removeEventListener('scroll', dismissFileContextMenu, true);
  window.removeEventListener('scroll', closeDirectoryContextMenu, true);
  window.removeEventListener('scroll', dismissPageContextMenu, true);
  window.removeEventListener('scroll', closeOutlineContextMenu, true);
  window.removeEventListener('resize', dismissFileContextMenu);
  window.removeEventListener('resize', closeDirectoryContextMenu);
  window.removeEventListener('resize', dismissPageContextMenu);
  window.removeEventListener('resize', closeOutlineContextMenu);
  window.removeEventListener('resize', constrainSidebarToViewport);
  window.removeEventListener('popstate', handlePagePopState);
  document.removeEventListener('visibilitychange', mobileVisibility);
  window.removeEventListener('tano:back', mobileBack);
  unlistenClose?.();
  unlistenWatchError?.();
});
watch(activeId, () => {
  closePageContextMenu();
  closeOutlineContextMenu();
  const treeId = activeId.value.startsWith('table:') ? tableFileId(activeId.value) : activeId.value;
  if (!pendingTreeOpenIds.has(treeId) || !selectedEntryIds.value.has(treeId))
    selectActiveFileInTree();
  historyPanel.value = false;
  panel.value = 'outline';
  outlineSearchOpen.value = false;
  outlineSearch.value = '';
  menu.value = false;
  activeHeading.value = 0;
  void nextTick(scheduleActiveHeading);
});
const helpContext = computed<HelpContext>(() => {
  if (activeId.value === ASSISTANT_TAB_ID || sidebarView.value === 'assistant') return 'assistant';
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
  'folder-conversion': !!workspace.value && !workspace.value.readOnly && store.canConvertFolderDocuments && !!store.workspaceSettings.folderHomeFileName,
  panes: !!workspace.value && !compactPanes.value,
  assistant: !!workspace.value && assistant.available,
  'assistant-configure': !!workspace.value && assistant.available && assistant.canConfigure && !assistant.demo,
  suggestions: !!active.value && !editorReadonly.value && !editing.isManaging(active.value.id),
  math: !!active.value && !editorReadonly.value && store.capabilities.features.math,
  mermaid: !!active.value && !editorReadonly.value && store.capabilities.features.mermaid,
}));
const helpBlocked = computed(() => !!(
  activeExtensionView.value || activeId.value === SETTINGS_TAB_ID || activeId.value.startsWith('attachment:') ||
  (assistant.opened && assistant.displayMode === 'fullscreen') ||
  busy.value || fatal.value || store.pending || active.value?.conflict || active.value?.error ||
  workspaceMenu.value || menu.value || modal.value || settingsPanel.value ||
  importPanel.value || templateLibraryOpen.value || agentPanel.value || objectPanel.value ||
  selectedDiff.value || selectionTodo.value || recyclePanel.value || referenceGraphOpened.value ||
  fileContextMenu.value || directoryContextMenu.value || pageContextMenu.value || outlineContextMenu.value ||
  resizingSidebar.value || draggedEntry.value || updateLock.value
));
  return {
    auxiliaryWindows,
    activeWindow,
    detachedTitle,
    native,
    mobile,
    workspace,
    compactPanes,
    isAuxiliaryWindow,
    sidebar,
    t,
    shortcuts,
    toggleSidebar,
    sessionPending,
    tabFileDrag,
    fileDragEnd,
    store,
    createNewDocument,
    detachTab,
    resizingSidebar,
    moveSidebarResize,
    finishSidebarResize,
    butterfly,
    fileMetadataTarget,
    switchingWorkspace,
    mainColumn,
    returnHome,
    sidebarHeaderItems,
    closeButtonVisibilityMenus,
    extensionViews,
    viewActions,
    navigationContext,
    sidebarNavigationItems,
    navigationModule,
    selectModule,
    sidebarView,
    draggedEntry,
    dropFolder,
    fileDragOver,
    fileDragLeave,
    fileDrop,
    workspaceView,
    selectWorkspaceView,
    workspaceMenu,
    modal,
    settingsPanel,
    repositoryActionItems,
    showModal,
    activeId,
    GRAPH_TAB_ID,
    busy,
    openDirectoryContextMenu,
    startupPending,
    filesPending,
    treeFiles,
    revealedHomeId,
    treeDocumentIcons,
    loadTreeDocumentIcon,
    selectedEntryIds,
    fileContextMenu,
    canDragEntry,
    treeRename,
    renameTreeEntry,
    openTreeEntry,
    selectFileTreeEntry,
    openFileContextMenu,
    fileDragStart,
    finishTreeRename,
    noteCount,
    showObjects,
    sidebarCalendarDate,
    openCalendar,
    showPlanEvent,
    multipleContextEntries,
    contextEntries,
    fileContextKeydown,
    localNative,
    selectionDeleteDisabled,
    fileContextAction,
    shortcutHint,
    contextFolderHome,
    folderHomeContextAction,
    fileMutationDisabled,
    directoryHasManagedFile,
    isMarkdown,
    isDataTableFilePath,
    attachments,
    tabsEnabled,
    canDuplicateEntry,
    isWorkspaceInternalPath,
    folderConversionIssue,
    convertDocumentStructure,
    closeFileContextMenu,
    fileDeleteDisabled,
    directoryContextMenu,
    directoryContextAction,
    directoryContextDuplicateDisabled,
    directoryContextRenameDisabled,
    directoryContextDeleteDisabled,
    workspaceEntryContextMenu,
    workspaceEntryContextKeydown,
    workspaceEntryContextAction,
    toggleWorkspaceMenu,
    ChevronUp,
    ChevronDown,
    workspaceDropdownContextMenu,
    selectContext,
    extensions,
    WorkspaceMenuLayout,
    extensionActions,
    commandPaletteOpened,
    openSystemSync,
    openImport,
    openTemplateLibrary,
    openSettings,
    updates,
    recyclePanel,
    agentPanel,
    createNewWorkspace,
    openWorkspaceEntryContextMenu,
    helpContext,
    helpAvailability,
    helpBlocked,
    documentationBaseUrl,
    menu,
    openExternalUrl,
    sidebarWidth,
    defaultSidebarWidth,
    SIDEBAR_MIN_WIDTH,
    sidebarWidthLimit,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    referenceGraphTarget,
    referenceGraphOpened,
    referenceGraphAnchor,
    openReference,
    assistantTab,
    dragPaneWindow,
    maximizePaneWindow,
    assistant,
    assistantPanelMounted,
    assistantHosts,
    ASSISTANT_TAB_ID,
    revealAssistantSelection,
    templateLibraryOpen,
    templatePaneId,
    templateSource,
    templateInitialization,
    workspaceStatusLabel,
    openEntry,
    openBreadcrumbDirectory,
    setAssistantHost,
    topbarVisibilityItems,
    canNavigatePage,
    navigatePage,
    CALENDAR_TAB_ID,
    paneButterflyScope,
    pluginViewHeader,
    pluginPreviewStatus,
    paneDocumentStatus,
    attachmentStatus,
    currentAttachmentStatus,
    PLUGINS_TAB_ID,
    settingsTabView,
    touchLayout,
    showOutline,
    touchOutlineOpen,
    panel,
    isTableTab,
    calendarToolItems,
    calendarPeriod,
    calendarDate,
    moveCalendarPeriod,
    calendarModeOpen,
    calendarModeLabel,
    calendarModeOptions,
    calendarMode,
    selectCalendarMode,
    managePlanEvents,
    documentSuggestions,
    editing,
    suggestionModeBusy,
    toggleSuggestionMode,
    documentToolItems,
    revealMarkdown,
    paneSource,
    shortcutAriaLabel,
    shortcutKeys,
    setPaneSource,
    toggleDocumentMenu,
    documentMenuTriggerKeydown,
    documentMenuKeydown,
    openPaneSearch,
    editorReadonly,
    documentUndoAvailable,
    undoDocument,
    documentRedoAvailable,
    redoDocument,
    canAddDocumentProperty,
    addDocumentProperty,
    paneComments,
    openDocumentDiscussion,
    paneReadonly,
    showReferenceGraph,
    limitPageWidth,
    pageWidthWritable,
    setLimitPageWidth,
    workspaceLocked,
    pageLocked,
    togglePageLock,
    historyPage,
    historyPanel,
    editorPreferences,
    showPageTitle,
    showDocumentProperties,
    showAllLineNumbers,
    togglePageOption,
    toggleWorkspaceLock,
    exportBusy,
    exportDocument,
    printBusy,
    printActiveDocument,
    sessionBlocksFileMutation,
    removeDocument,
    tableFileId,
    openAssistant,
    parentPath,
    openWorkspaceViewSourceFile,
    openWorkspaceViewSourceObject,
    calendarScope,
    plans,
    showCalendarDay,
    showCalendarMonth,
    openAssistantPage,
    SETTINGS_TAB_ID,
    selectedVisualFontFamily,
    visualFontSize,
    setPaneSearch,
    paneSourceEditors,
    paneEditors,
    paneSearchRevisions,
    setPaneElement,
    toolbarMode,
    scheduleActiveHeading,
    appearance,
    assistantTaskActive,
    beginSelectionTodo,
    paneEditorScrolls,
    paneSelections,
    defaultSelectionContext,
    showSourceTodo,
    selectedDiff,
    sourceFontSize,
    openPageContextMenu,
    safeRemoteImage,
    uploadFile,
    resourceRevision,
    renameDocumentTitle,
    insertBlockBelowTitle,
    commentAnchors,
    paneEditorReady,
    paneSourceSelections,
    insertSourceFiles,
    CalloutIconPicker,
    setPaneEditor,
    openDocumentLink,
    openWikiLink,
    openBlankBlockAssistant,
    startDocumentDraft,
    quickInitialize,
    chooseInitialTemplate,
    showDocumentDiscussion,
    setPaneComments,
    discussWithAssistant,
    capturePaneCommentSelection,
    focusPaneComment,
    paneCommentGeometry,
    paneScrolls,
    receiveAttachmentStatus,
    updateLock,
    fileHandlers,
    relativeWorkspaceReference,
    outlineOnLeft,
    hoverOutline,
    outlinePinned,
    outlinePosition,
    openOutlineContextMenu,
    releaseOutlinePointerFocus,
    outlineAutoCollapse,
    outlineSearchOpen,
    toggleOutlineSearch,
    toggleOutlinePin,
    outlineSearch,
    visibleOutline,
    jumpToHeading,
    outline,
    activeHeading,
    activities,
    AlertTriangle,
    RefreshCw,
    Check,
    FileText,
    uiLocale,
    homeContent,
    homeExtension,
    inlineAssistant,
    inlineAssistantPrompt,
    inlineAssistantState,
    inlineRunner,
    inlineAssistantError,
    inlineAssistantMessage,
    submitInlineAssistant,
    continueInlineConversation,
    undoInlineAssistant,
    closeInlineAssistant,
    pageContextMenu,
    pageContextKeydown,
    outlineContextMenu,
    outlineContextKeydown,
    toggleOutlineSide,
    importPanel,
    importRecords,
    systemSyncPanel,
    workspaceSync,
    active,
    importObjectAssets,
    objectPanelMounted,
    objectPanel,
    selectedObjectId,
    selectedResourceIdentity,
    selectedPersonal,
    assetImportBusy,
    assetPreview,
    openObjectResource,
    openObjectReference,
    assetInput,
    planDetail,
    openPlanReference,
    selectionTodo,
    workbenchCommands,
    settingsWorkspace,
    openingSettingsWindow,
    openSettingsTab,
    openSettingsInNewWindow,
    settingsPage,
    settingsContext,
    workspaceExporting,
    workspaceExportError,
    workspaceDeletionError,
    deleteWorkspace,
    exportWorkspace,
    defaultSource,
    theme,
    appearanceController,
    visualFontChoice,
    customFontName,
    splitFontSettings,
    appVersion,
    settingsAction,
    fatal,
    createNewEntry,
    modalBusy,
    modalTitle,
    input,
    searchResults,
    openSearchResult,
    searchHighlightParts,
    searchResultLocation,
    searching,
    searchError,
    submitModal,
    modalDeleteEntries,
    modalTarget,
    modalError,
    AppTooltip,
    PanelLeftOpen,
    DesktopTabs,
    AssistantButterflyLayer,
    FileMetadataPanel,
    ButtonVisibilityGroup,
    CalendarDays,
    SidebarNavigation,
    PluginSidebar,
    WorkspaceViewSwitcher,
    Search,
    GitFork,
    SquarePen,
    FileTree,
    PluginInstaller,
    LoadingSkeleton,
    Table2,
    SidebarAssistant,
    SidebarPlan,
    CopyPlus,
    Route,
    FolderTree,
    Trash2,
    ShortcutHint,
    House,
    FilePlus2,
    FolderPlus,
    TextCursorInput,
    Paperclip,
    PanelsTopLeft,
    Link,
    FileOutput,
    AppWindow,
    FolderSearch,
    EyeOff,
    Eye,
    FileSymlink,
    Database,
    FileSliders,
    Blocks,
    PluginMenu,
    ArrowDownToLine,
    FolderOpen,
    WorkspaceIcon,
    Files,
    CircleHelp,
    Bot,
    OpenWorkspaceIcon,
    HelpLauncher,
    SidebarUpdateButton,
    WorkspaceSidebar,
    ReferenceGraphPopover,
    AssistantPanel,
    TemplateLibrary,
    ArrowLeft,
    ArrowRight,
    DocumentStatus,
    ChevronRight,
    Puzzle,
    WorkspaceBreadcrumb,
    PluginViewHeader,
    List,
    LockKeyhole,
    ChevronLeft,
    MessageSquareDiff,
    X,
    MarkdownRevealToggle,
    SourceCodeIcon,
    MoreHorizontal,
    Repeat2,
    Undo2,
    Redo2,
    CheckCheck,
    Plus,
    MessageSquare,
    MoveHorizontal,
    Archive,
    Clock3,
    PageDisplayOptions,
    DocumentGlobalMenu,
    DocumentExportMenu,
    DocumentPrintButton,
    RelationGraph,
    DataTablePage,
    AssistantLauncher,
    FolderView,
    WorkspaceViewTab,
    CalendarView,
    PluginView,
    DocumentLoading,
    PageSearch,
    LayoutDocumentChrome,
    ListTodo,
    EditorTools,
    ArrowUpRight,
    DocumentTitle,
    SourceEditor,
    DocumentStarter,
    MarkdownEditor,
    DocumentComments,
    DocumentSuggestions,
    DocumentScrollbar,
    AttachmentPreview,
    EmptyEditor,
    History,
    ListTree,
    Pin,
    DocumentOutline,
    WorkspacePanes,
    InlineAssistantInput,
    ImportPanel,
    WorkspaceSyncPanel,
    MobileRecycle,
    AgentPanel,
    DiffDialog,
    DocumentHistoryPanel,
    ObjectPanel,
    PlanDetailPanel,
    SelectionTodoDialog,
    CommandPalette,
    SettingsPanel,
    NewTabPicker,
    LoaderCircle,
    vScrollFade,
    vSurfaceMotion,
    vButterflyPerch,
    vOutlineMotion,
  };
}
