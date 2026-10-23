<script setup lang="ts">
import WorkspaceSyncPanel from './components/WorkspaceSyncPanel.vue';
import { createWorkspaceSync, syncEvent } from './workspace-sync';
import { t } from './i18n';
import AppTooltip from './components/AppTooltip.vue';
import { assistantDiscussionPrompt } from './assistant/language';
import { assistantSourceRange } from './assistant/source-selection';
import type { AssistantSource } from '@tano/protocol';
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  shallowRef,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { version as appVersion } from '../package.json';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  FolderPlus,
  FolderOpen,
  Box,
  PanelLeftOpen,
  FileText,
  X,
  Check,
  Circle,
  Code2,
  MoreHorizontal,
  ArrowUpRight,
  Archive,
  Clock3,
  History,
  List,
  ListTodo,
  ListOrdered,
  CircleHelp,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Repeat2,
  Pencil,
  Trash2,
  Bot,
  MessageSquare,
  MessageSquareDiff,
  ExternalLink,
  Link,
  CheckCheck,
  Copy,
  LoaderCircle,
  Users,
  Puzzle,
  GitFork,
  CalendarDays,
  LogOut,
  Settings2,
  SquarePen,
  Pin,
  Space,
  Heading1,
  SlidersHorizontal,
  LockKeyhole,
  MoveHorizontal,
  Undo2,
  Redo2,
  ArrowDownToLine,
  Files,
  Table2,
} from 'lucide-vue-next';
const MarkdownEditor = loadingComponent(() => import('@tano/editor'), 'editor');
const CalloutIconPicker = defineAsyncComponent(() => import('./components/CalloutIconPicker.vue'));
import { defaultEditorPreferences, normalizeSelectionWrapping } from '@tano/editor/runtime';
import type { EditorPreferences } from '@tano/editor/runtime';
import { defaultSelectionContext } from '@tano/editor/selection-context';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
const SourceEditor = loadingComponent(() => import('./components/SourceEditor.vue'), 'editor');
import { captureModeViewport, restoreModeViewport } from './editor-mode';
import type { ModeViewport } from './editor-mode';
import AttachmentPreview from './components/AttachmentPreview.vue';
import FileMetadataPanel from './components/FileMetadataPanel.vue';
import { fileHandlers } from '@tano/protocol';
import PageSearch from './components/PageSearch.vue';
import EmptyEditor from './components/EmptyEditor.vue';
import DocumentStarter from './components/DocumentStarter.vue';
import { documentStarter, templateStarterBody } from './document-starters';
import MarkdownRevealToggle from './components/MarkdownRevealToggle.vue';
import DocumentTitle from './components/DocumentTitle.vue';
import { appearanceText } from './document-appearance';
import { useDocumentFavicon } from './document-favicon';
import WorkspaceBreadcrumb from './components/WorkspaceBreadcrumb.vue';
import DocumentStatus from './components/DocumentStatus.vue';
import { documentStatusItems, type DocumentSyncStatus } from './document-status';
import DocumentScrollbar from './components/DocumentScrollbar.vue';
import DocumentExportMenu from './components/DocumentExportMenu.vue';
import type { ImportRecord } from './components/ImportPanel.vue';
const ImportPanel = defineAsyncComponent(() => import('./components/ImportPanel.vue'));
const TemplateLibrary = loadingComponent(() => import('./components/TemplateLibrary.vue'), 'document');
import type { DocumentExportFormat } from './document-export';
// Discussion and annotation surfaces decide their own visibility and loading state.
const DocumentComments = defineAsyncComponent(() => import('./components/DocumentComments.vue'));
const DocumentSuggestions = loadingComponent(() => import('./components/DocumentSuggestions.vue'), 'document');
import ReferenceGraphPopover from './components/ReferenceGraphPopover.vue';
const SelectionTodoDialog = defineAsyncComponent(() => import('./components/SelectionTodoDialog.vue'));
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
type WorkspaceEntry = Pick<RecentWorkspace, 'id' | 'name' | 'path' | 'icon'>;
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
import DesktopTabs from './components/DesktopTabs.vue';
import WorkspacePanes from './components/WorkspacePanes.vue';
import type { OpenDocument } from './stores/workspace';
import { GRAPH_TAB_ID } from './document-graph';
import { PLUGINS_TAB_ID } from './workspace-plugins';
import { CALENDAR_TAB_ID, calendarPeriodTitle, shiftCalendarDate } from './calendar';
import type { CalendarViewMode } from './calendar';
const RelationGraph = loadingComponent(() => import('./components/RelationGraph.vue'), 'document');
import NewTabPicker from './components/NewTabPicker.vue';
const EditorTools = defineAsyncComponent(() => import('./components/EditorTools.vue'));
import { parseToolbarMode, toolbarPreferenceKey } from './toolbar-preference';
const DocumentHistoryPanel = loadingComponent(() => import('./components/DocumentHistoryPanel.vue'));
const AgentPanel = loadingComponent(() => import('./components/AgentPanel.vue'));
const AssistantPanel = loadingComponent(() => import('./components/AssistantPanel.vue'));
import AssistantLauncher from './components/AssistantLauncher.vue';
import AssistantButterflyLayer from './components/AssistantButterflyLayer.vue';
import { butterflyScope } from './assistant/butterfly';
import { createButterflyIdleTrigger } from './assistant/butterfly-idle';
import { butterflyPerchDirective, provideButterflyController } from './assistant/butterfly-vue';
import { useAssistantStore, useInlineAssistantStore } from './assistant/store';
import { inlineAssistantResult } from './assistant/inline-result';
const DiffDialog = defineAsyncComponent(() => import('./components/DiffDialog.vue'));
import { handleMobileVisibility } from './mobile-lifecycle';
import { useViewport } from './viewport';
import { useWorkspaceStore } from './stores/workspace';
import { retainWorkbenchSession } from './workbench-session';
import { useSuggestionStore } from './stores/suggestions';
import { useWorkbenchRuntime, createLocalExtensions } from './runtime';
import type { WorkbenchActions } from './runtime';
import { native } from './adapter';
import { mobile } from './platform';
const MobileRecycle = defineAsyncComponent(() => import('./components/MobileRecycle.vue'));
const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'));
import WorkspaceIcon from './components/WorkspaceIcon.vue';
import WorkspaceMenuLayout from './components/WorkspaceMenuLayout.vue';
import { workspaceArchive, workspaceArchiveName } from './workspace-export';
const ObjectPanel = defineAsyncComponent(() => import('./components/ObjectPanel.vue'));
const PlanDetailPanel = defineAsyncComponent(() => import('./components/PlanDetailPanel.vue'));
import type { ObjectRecord } from './workspace-objects';
import { usePlanStore } from './stores/plans';
import { usePlanSyncStore } from './stores/plan-sync';
import { planKey } from './personal-plans';
const SidebarPlan = loadingComponent(() => import('./components/SidebarPlan.vue'));
import SidebarNavigation from './components/SidebarNavigation.vue';
import WorkspaceSidebar from './components/WorkspaceSidebar.vue';
import HelpLauncher from './components/HelpLauncher.vue';
import type { HelpAvailability, HelpContext } from './help-content';
import { recordHelpCompleted } from './help-checklist';
import WorkspaceViewSwitcher from './components/WorkspaceViewSwitcher.vue';
import { useWorkbenchNavigation, type WorkspaceSidebarView } from './workbench-navigation';
import { ASSISTANT_TAB_ID, openAssistantPage } from './assistant/navigation';
const SidebarAssistant = loadingComponent(() => import('./components/SidebarAssistant.vue'));
import ButtonVisibilityGroup from './components/ButtonVisibilityGroup.vue';
import InlineAssistantInput from './components/InlineAssistantInput.vue';
import type { InlineAssistantAnchor } from './components/InlineAssistantInput.vue';
const CalendarView = loadingComponent(() => import('./components/CalendarView.vue'), 'document');
const DataTablePage = loadingComponent(() => import('./components/DataTablePage.vue'), 'document');
const WorkspaceViewPage = loadingComponent(() => import('./components/WorkspaceViewPage.vue'), 'document');
import { isTableTab, TABLES_TAB_ID, tableFileId } from './data-tables';
import { isDataTableFilePath } from '@tano/protocol';
const PluginInstaller = defineAsyncComponent(() => import('./components/PluginInstaller.vue'));
import PluginView from './components/PluginView.vue';
import PluginSidebar from './components/PluginSidebar.vue';
import PluginMenu from './components/PluginMenu.vue';
import CommandPalette from './components/CommandPalette.vue';
import { editorPaletteCommands } from './command-palette';
import type { WorkbenchCommand } from './command-palette';
import { pluginShortcutCommand } from './plugins/workbench';
import { SETTINGS_PLUGIN_RESULT } from './settings-window';
import { isObjectPath, referenceMarkdown, referenceUrl, resolveReference } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import WorkspaceDashboard from './components/WorkspaceDashboard.vue';
import LoadingSkeleton from './components/LoadingSkeleton.vue';
import { loadingComponent } from './loading-component';
import { useUpdatesStore } from './stores/updates';
import { resolveWikiLink } from './wiki-links';
import { applyFileMovePreview, planFileMovePreview, type FileMovePreview } from './file-move';
import {
  isSidebarToggleShortcut, matchesShortcut, parseShortcutBindings, readShortcutBindings,
  saveShortcutBindings, shortcutLabel, shortcutPreferenceKey,
} from './shortcuts';
import type { ShortcutId } from './shortcuts';
import { createDetachedTabWindow, detachedTabRequest, reportDetachedReady } from './detach-tab';
import type { DetachedDropPoint } from './detach-tab';
import {
  findTabDockTarget,
  requestTabTransfer,
  TAB_TRANSFER_REQUEST,
  TAB_TRANSFER_RESULT,
  TAB_TRANSFER_ROLLBACK,
} from './tab-docking';
import type { TabTransferRequest, TabTransferRollback, TabTransferResult } from './tab-docking';
import { selectTreeEntry, topLevelEntries } from './file-selection';
import { isBlankPageTarget } from './page-context-menu';
import { pageRoutePath, pageRouteUrl, parsePageRoute } from './web-navigation';
import { applyTheme, readThemePreference, saveThemePreference } from './theme';
import type { ThemePreference } from './theme';
import { parseVisualFontChoice, sanitizeCustomFontName, visualFontFamily } from './editor-font';
import type { VisualFontChoice } from './editor-font';
import { emitTo, listen } from '@tauri-apps/api/event';
import {
  SETTINGS_COMMAND,
  SETTINGS_NAVIGATE,
  SETTINGS_STATE,
  closeSettingsWindow,
  settingsWindowLabel,
} from './settings-window';
import type { SettingsCommand, SettingsPageId, SettingsSnapshot } from './settings-window';

const props = defineProps<{ initialWorkspace?: string; createWorkspace?: boolean }>();
const emit = defineEmits<{ ready: [] }>();
const store = useWorkspaceStore();
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
const detachedWindow = tabsEnabled && !!detachedTabRequest();
const localNative = native && !store.isWeb;
const attachments =
  useWorkbenchRuntime().attachments ?? (localNative ? nativeAttachments : undefined);
const workspaceAdapter = useWorkbenchRuntime().adapter;
const documentationBaseUrl = useWorkbenchRuntime().documentationBaseUrl;
const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
const extensionViews = extensions.views ?? [];
const sidebarNavigationItems = computed(() => [
  { id: 'repository', get label() { return t('工作区'); } },
  { id: 'plan', get label() { return t('计划'); } },
  ...extensionViews
    .filter((view) => view.sidebar)
    .map((view) => ({ id: view.id, label: view.label })),
]);
const sidebarHeaderItems = computed(() => [
  ...extensionViews
    .filter((view) => view.header)
    .map((view) => ({ id: view.id, label: view.label })),
  { id: 'commands', get label() { return t('命令中心'); } },
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
    ...(hasDocument ? [{ id: 'document-status', get label() { return t('文章状态'); } }] : []),
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
store.setBeforeWorkspaceChange(async () => { await assistant.settle(); await inlineRunner.settle(); });
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
        sidebarView.value = view.id;
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
const navigation = useWorkbenchNavigation(() => store.workspace?.id);
const { module: navigationModule, workspaceView, sidebarView } = navigation;
let personalPlanScope: typeof plans.view = 'personal';
function selectWorkspaceView(id: string) {
  rememberCalendar();
  if (navigationModule.value === 'plan') personalPlanScope = plans.view;
  navigation.selectWorkspaceView(id as WorkspaceSidebarView);
  restoreCalendar();
  if (id === 'events') plans.view = 'workspace';
}
function selectModule(id: string) {
  rememberCalendar();
  if (navigationModule.value === 'plan') personalPlanScope = plans.view;
  navigation.selectModule(id);
  restoreCalendar();
  if (id === 'workspace') {
    if (workspaceView.value === 'events') plans.view = 'workspace';
  } else if (id === 'plan') {
    plans.view = personalPlanScope;
  }
  sidebar.value = true;
}
watch(() => store.activePluginSidebar, key => { if (key) { sidebarView.value = 'plugin-views'; sidebar.value = true; } });
watch(() => store.pluginSettingsRequest, request => { if (request) openSettings(request.key); });
const calendarDate = ref(new Date());
const sidebarCalendarDate = ref(new Date());
const calendarScope = ref<typeof plans.view>(plans.view);
const calendarMode = ref<CalendarViewMode>('week');
const calendarModeOpen = ref(false);
const calendarLocations = new Map<string, { date: Date; mode: CalendarViewMode }>();
function calendarLocationKey() { return navigationModule.value === 'plan' ? 'personal-plan' : store.workspace?.id ?? ''; }
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
  store.openCalendarTab();
  if (compactPanes.value) sidebar.value = false;
}
function openExtensionView(id: string) {
  if (navigationModule.value === 'plan') { personalPlanScope = plans.view; rememberCalendar(); }
  if (extensionViews.find(view => view.id === id)?.sidebar) navigation.selectModule(id);
  store.openViewTab(id);
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
const { workspace, active, activeId, activities, fatal, busy } = storeToRefs(store);
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
const sidebar = ref(!detachedWindow && !compactPanes.value);
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
const theme = ref<ThemePreference>(readThemePreference());
const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
const onSystemThemeChange = () => {
  if (theme.value === 'system') applyTheme('system');
};
applyTheme(theme.value);
watch(theme, saveThemePreference);
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
  try {
    const value = Number(window.localStorage.getItem(`tano.preference.${key}`));
    return Number.isInteger(value) && value >= 12 && value <= 24 ? value : fallback;
  } catch {
    return fallback;
  }
}
function saveFontSizePreference(key: string, value: number) {
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
  !detachedWindow &&
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
  const requestedWidth = Math.round(width);
  sidebarWidth.value = Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarWidthLimit(), requestedWidth));
  preferredSidebarWidth = preservePreference ? requestedWidth : sidebarWidth.value;
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth.value}px`);
}
function currentSidebarWidth() {
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
function shortcutHint(id: ShortcutId) { return shortcutLabel(shortcuts.value[id]); }
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
const selectedVisualFontFamily = computed(() =>
  visualFontFamily(visualFontChoice.value, customFontName.value),
);
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
    !store.capabilitySaving &&
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
const editorPreferences = ref<EditorPreferences>({
  autoSpacing: readPreference('autoSpacing', defaultEditorPreferences.autoSpacing ?? false),
  previewMathWhileEditing: readPreference(
    'previewMathWhileEditing',
    defaultEditorPreferences.previewMathWhileEditing,
  ),
  folding: readPreference('folding', defaultEditorPreferences.folding),
  blankBlockAiShortcut: readPreference('blankBlockAiShortcut', defaultEditorPreferences.blankBlockAiShortcut),
  selectionWrapping: readSelectionWrapping(),
});
watch(
  editorPreferences,
  (preferences) => {
    savePreference('autoSpacing', preferences.autoSpacing ?? false);
    savePreference('previewMathWhileEditing', preferences.previewMathWhileEditing);
    savePreference('folding', preferences.folding);
    savePreference('blankBlockAiShortcut', preferences.blankBlockAiShortcut);
    saveTextPreference('selectionWrapping', JSON.stringify(normalizeSelectionWrapping(preferences.selectionWrapping)));
  },
  { deep: true },
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
function pageLockPreferenceKey(workspaceId: string, documentId: string) {
  return `pageLocked.${workspaceId}.${documentId}`;
}
function togglePageLock() {
  const currentWorkspace = workspace.value;
  const document = active.value;
  if (!currentWorkspace || !document) return;
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
  if (updateLock.value || store.busy || workspace.value.readOnly || sessionBlocksFileMutation(id))
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
  const id = activeId.value.startsWith('table:') ? tableFileId(activeId.value) : activeId.value;
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
    { id: 'workbench.find', category: t('编辑'), get label() { return t('页内搜索'); }, shortcut: shortcuts.value.pageSearch, available: standardEditor, run: () => openPaneSearch() },
    { id: 'workbench.replace', category: t('编辑'), get label() { return t('查找与替换'); }, shortcut: shortcuts.value.pageReplace, available: editable, run: () => openPaneSearch(store.activePaneId, true) },
    { id: 'workbench.undo', category: t('编辑'), get label() { return t('撤销'); }, available: editable && documentUndoAvailable.value, run: undoDocument },
    { id: 'workbench.redo', category: t('编辑'), get label() { return t('重做'); }, available: editable && documentRedoAvailable.value, run: redoDocument },
    ...editorPaletteCommands({ editable: editable && !!editor.value, source: source.value,
      context: paneSelections[store.activePaneId] ?? defaultSelectionContext, features: store.capabilities.features,
      run: (name, value) => editor.value?.command(name, value) }),
    { id: 'workbench.source', category: t('视图'), label: source.value ? t('返回可视化编辑') : t('切换源码模式'), available: standardEditor, keywords: 'Markdown source', run: () => { source.value = !source.value; } },
    { id: 'workbench.reading', category: t('视图'), label: pageLocked.value ? t('退出阅读模式') : t('进入阅读模式'), available: hasDocument, keywords: t('锁定页面 解锁'), run: togglePageLock },
    { id: 'workbench.width', category: t('视图'), label: limitPageWidth.value ? t('展开页面全宽') : t('限制页面宽度'), available: hasDocument && pageWidthWritable.value, run: () => setLimitPageWidth(!limitPageWidth.value) },
    { id: 'workbench.outline', category: t('视图'), label: showOutline.value ? t('隐藏文档目录') : t('显示文档目录'), available: hasDocument, keywords: t('大纲'), run: () => { showOutline.value = !showOutline.value; } },
    { id: 'workbench.properties', category: t('视图'), label: showDocumentProperties.value ? t('隐藏文档属性') : t('显示文档属性'), available: hasDocument, run: () => { showDocumentProperties.value = !showDocumentProperties.value; } },
    { id: 'workbench.discussion', category: t('文档'), get label() { return t('发起讨论'); }, keywords: t('文档讨论 评论'), available: editable, run: openDocumentDiscussion },
    { id: 'workbench.sidebar', category: t('视图'), label: sidebar.value ? t('收起侧栏') : t('展开侧栏'), shortcut: shortcuts.value.toggleSidebar, available: !detachedWindow, run: toggleSidebar },
    { id: 'workbench.repository', category: t('工作区'), get label() { return t('打开仓库'); }, available: !detachedWindow, run: () => { sidebar.value = true; sidebarView.value = 'repository'; } },
    { id: 'workbench.plan', category: t('工作区'), get label() { return t('打开计划'); }, available: !detachedWindow && store.workspaceSettings.showPlan, run: () => { sidebar.value = true; selectModule('plan'); } },
    { id: 'workbench.calendar', category: t('工作区'), get label() { return t('打开日历'); }, available: store.workspaceSettings.showPlan, run: () => openCalendar() },
    { id: 'workbench.graph', category: t('工作区'), get label() { return t('打开关系图谱'); }, available: store.workspaceSettings.showGraph, run: () => store.openGraphTab() },
    ...store.workspaceViews.map((record) => ({
      id: `workbench.workspace-view.${record.view.id}`,
      category: t('工作区'),
      get label() { return t('打开视图：{0}', [record.view.name]); },
      available: true,
      run: () => store.openWorkspaceView(record.view.id).catch(store.report),
    })),
    { id: 'workbench.git', category: t('工作区'), label: 'Git 与同步', keywords: 'Git 状态 差异 提交 历史 同步', available: native && !mobile && !!workspace.value && !store.isWeb, run: () => openSystemSync() },
    { id: 'workbench.plugins', category: t('工作区'), get label() { return t('打开插件中心'); }, available: store.workspaceSettings.showPlugins, run: () => store.openPluginsTab() },
    { id: 'workbench.updates', category: t('历史'), get label() { return t('文档更新历史'); }, available: hasDocument, run: () => { historyPage.value = 'updates'; historyPanel.value = true; } },
    { id: 'workbench.versions', category: t('历史'), get label() { return t('文档版本历史'); }, available: hasDocument && !!extensions.historyEnabled, run: () => { historyPage.value = 'versions'; historyPanel.value = true; } },
    { id: 'workbench.settings', category: t('设置'), get label() { return t('外观设置'); }, keywords: t('打开设置'), run: () => openSettings() },
    { id: 'workbench.settings.editing', category: t('设置'), get label() { return t('编辑设置'); }, run: () => openSettings('editing') },
    { id: 'workbench.settings.shortcuts', category: t('设置'), get label() { return t('快捷键'); }, run: () => openSettings('shortcuts') },
    { id: 'workbench.settings.workspace', category: t('设置'), get label() { return t('工作区设置'); }, run: () => openSettings('workspace') },
    { id: 'workbench.settings.about', category: t('设置'), get label() { return t('关于同页'); }, run: () => openSettings('about') },
  ];
});
const settingsPage = ref<SettingsPageId>(detachedWindow ? detachedTabRequest()?.settingsPage ?? 'appearance' : 'appearance');
const settingsHosts = computed(() => [
  ...(settingsPanel.value ? ['modal'] : []),
  ...store.panes.filter(pane => pane.activeId === SETTINGS_TAB_ID).map(pane => pane.id),
]);
function openSettingsTab(page: SettingsPageId) {
  settingsPage.value = page;
  store.openViewTab(SETTINGS_TAB_ID);
  settingsPanel.value = false;
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
  planDetail.value = record;
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
  const pending = pendingModeViewports.get(paneId);
  const target = sourceMode ? paneSourceEditors.get(paneId) : paneEditors.get(paneId);
  const scroll = paneScrolls.get(paneId);
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
  const locked = doc.id === store.active?.id ? pageLocked.value
    : readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false);
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
  return { top, maxHeight: `calc(100% - ${top} - 12px)` };
});
let headingFrame: number | undefined;
async function dragPaneWindow(event: MouseEvent) {
  if (event.button !== 0 || event.detail !== 1) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().startDragging();
}
async function maximizePaneWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().toggleMaximize();
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
function workspaceEntryContextAction(action: 'open' | 'leave' | 'reveal') {
  const item = workspaceEntryContextMenu.value?.item;
  if (!item) return;
  closeWorkspaceEntryContextMenu();
  if (action === 'open') {
    workspaceMenu.value = false;
    if (item.id !== workspace.value?.id) void store.openWorkspace(item.path);
  } else if (action === 'leave') {
    void leaveWorkspace();
  } else if (action === 'reveal') {
    void store.reveal();
  }
}
function selectFileTreeEntry(file: FileEntry, event: MouseEvent) {
  const visibleIds = [
    ...document.querySelectorAll<HTMLElement>('.tree-scroll .tree-row[data-entry-id]'),
  ].map((row) => row.dataset.entryId!);
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
  const x = event instanceof MouseEvent ? event.clientX : (rect?.left ?? 0) + 24;
  const y = event instanceof MouseEvent ? event.clientY : (rect?.bottom ?? 0);
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
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
  return outline.value.flatMap((heading, index) =>
    !query || heading.text.toLocaleLowerCase().includes(query) ? [{ heading, index }] : [],
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
function toggleOutlinePin(event: MouseEvent) {
  outlinePinned.value = !outlinePinned.value;
  if (!outlinePinned.value) (event.currentTarget as HTMLButtonElement).blur();
}
function closeOutlineContextMenu() {
  outlineContextMenu.value = null;
}
function openOutlineContextMenu(event: MouseEvent) {
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
function updateActiveHeading() {
  const container = documentScroll.value;
  const cover = container?.querySelector<HTMLElement>('.document-cover');
  const pane = container?.closest<HTMLElement>('.workspace-pane');
  // Measure in the inspector's containing pane, including partially scrolled covers.
  outlineCoverBottom.value = cover && pane
    ? Math.max(0, cover.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 16)
    : 0;
  const items = editorScroll.value?.querySelectorAll<HTMLElement>(
    '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
  );
  if (!container || source.value || !items?.length || !outline.value.length) return;
  const threshold = container.getBoundingClientRect().top + 100;
  let current = 0;
  items.forEach((item, index) => {
    if (item.getBoundingClientRect().top <= threshold) current = index;
  });
  activeHeading.value = Math.min(current, outline.value.length - 1);
}
function scheduleActiveHeading() {
  if (headingFrame !== undefined) return;
  headingFrame = requestAnimationFrame(() => {
    headingFrame = undefined;
    updateActiveHeading();
  });
}
watch([() => outline.value.length, source], () => void nextTick(scheduleActiveHeading), {
  flush: 'post',
});
watch([documentScroll, showPageTitle], ([container], _, cleanup) => {
  scheduleActiveHeading();
  if (!container) return;
  // A cover can be added or removed without changing the outline. Also follow
  // window/sidebar/split resizing and title or toolbar layout changes.
  const observer = new ResizeObserver(scheduleActiveHeading);
  observer.observe(container);
  for (const element of container.querySelectorAll('.document-main, .document-title'))
    observer.observe(element);
  cleanup(() => observer.disconnect());
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
const transferRollback = new Map<
  string,
  {
    tabId: string;
    created: boolean;
    priorIndex: number;
    priorActive: string;
    priorSettingsPage?: SettingsPageId;
    undoDock?: () => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

async function acceptTabTransfer(request: TabTransferRequest) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const targetLabel = getCurrentWindow().label;
  let actualId = request.tabId;
  let created = false;
  const priorActive = store.activeId;
  const priorSettingsPage = request.tabId === SETTINGS_TAB_ID ? settingsPage.value : undefined;
  const priorIndex = store.tabs.findIndex((tab) => tab.id === request.tabId);
  let undoDock: (() => void) | undefined;
  let error: string | undefined;
  try {
    if (
      request.sourceLabel === targetLabel ||
      !workspace.value ||
      workspace.value.id !== request.workspaceId ||
      store.busy
    )
      throw new Error(t('目标窗口当前无法接收这个标签页'));
    if (request.drop) {
      if (!store.panes.some((pane) => pane.id === request.drop!.paneId))
        throw new Error(t('目标分栏已关闭，请重新拖入'));
      store.focusPane(request.drop.paneId);
    }
    if (request.tabId.startsWith('blank:')) {
      store.createBlankTab();
      actualId = store.activeId;
      created = true;
    } else if (request.tabId === GRAPH_TAB_ID) {
      created = priorIndex < 0;
      await store.openGraphTab({ newTab: true });
    } else if (request.tabId === PLUGINS_TAB_ID) {
      created = priorIndex < 0;
      await store.openPluginsTab({ newTab: true });
    } else if (request.tabId === CALENDAR_TAB_ID) {
      created = priorIndex < 0;
      store.openCalendarTab();
    } else if (isTableTab(request.tabId)) {
      created = priorIndex < 0;
      await store.openDataTable(request.tabId === TABLES_TAB_ID ? undefined : tableFileId(request.tabId));
    } else if (request.tabId.startsWith('workspace-view:')) {
      throw new Error(t('工作区视图暂不支持移到其他窗口'));
    } else if (request.tabId === SETTINGS_TAB_ID) {
      created = priorIndex < 0;
      settingsPage.value = request.settingsPage ?? 'appearance';
      store.openViewTab(SETTINGS_TAB_ID);
    } else if (extensionViews.some((view) => view.id === request.tabId)) {
      const view = extensionViews.find((view) => view.id === request.tabId)!;
      if (!view.detachable)
        throw new Error(view.detachBlockedMessage ?? t('此扩展视图不支持移到其他窗口'));
      created = priorIndex < 0;
      store.openViewTab(view.id);
    } else if (priorIndex < 0) {
      const file = workspace.value.files.find(
        (entry) => entry.id === request.tabId && entry.kind === 'file',
      );
      if (!file) throw new Error(t('目标窗口找不到拖入的文档'));
      await store.openFileInNewTab(file);
      created = true;
    }
    if (!store.tabs.some((tab) => tab.id === actualId))
      throw new Error(t('目标窗口未能打开拖入的标签页'));
    if (request.drop) {
      if (!store.panes.some((pane) => pane.id === request.drop!.paneId))
        throw new Error(t('目标分栏已关闭，请重新拖入'));
      undoDock = store.dockTab(actualId, request.drop);
    } else {
      const index =
        priorIndex >= 0 && priorIndex < request.index ? request.index - 1 : request.index;
      store.placeTab(actualId, index);
    }
    store.activeId = actualId;
    const timer = setTimeout(() => transferRollback.delete(request.requestId), 15_000);
    transferRollback.set(request.requestId, {
      tabId: actualId,
      created,
      priorIndex,
      priorActive,
      priorSettingsPage,
      undoDock,
      timer,
    });
  } catch (reason) {
    error = String(reason);
    if (priorSettingsPage !== undefined) settingsPage.value = priorSettingsPage;
    if (created) await store.close(actualId);
    if (store.tabs.some((tab) => tab.id === priorActive)) store.activeId = priorActive;
  }
  try {
    await emitTo(request.sourceLabel, TAB_TRANSFER_RESULT, {
      requestId: request.requestId,
      targetLabel,
      ...(error ? { error } : { tabId: actualId, created }),
    } satisfies TabTransferResult);
  } catch (reason) {
    await rollbackTabTransfer({ requestId: request.requestId });
    throw reason;
  } finally {
    window.dispatchEvent(
      new CustomEvent('tano-tab-transfer-settled', {
        detail: { sourceLabel: request.sourceLabel, tabId: request.tabId },
      }),
    );
  }
  if (!error) void getCurrentWindow().setFocus().catch(store.report);
}

async function rollbackTabTransfer(request: TabTransferRollback) {
  const pending = transferRollback.get(request.requestId);
  if (!pending) return;
  transferRollback.delete(request.requestId);
  clearTimeout(pending.timer);
  if (pending.priorSettingsPage !== undefined) settingsPage.value = pending.priorSettingsPage;
  if (pending.created) await store.close(pending.tabId);
  else if (pending.undoDock) pending.undoDock();
  else if (pending.priorIndex >= 0) store.placeTab(pending.tabId, pending.priorIndex);
  if (store.tabs.some((tab) => tab.id === pending.priorActive))
    store.activeId = pending.priorActive;
}

async function detachTab(id: string, drop?: DetachedDropPoint, settled?: () => void) {
  if (!native || mobile || detachingTab || !workspace.value || store.busy) {
    settled?.();
    return;
  }
  const tab = store.tabs.find((item) => item.id === id);
  if (!tab) {
    settled?.();
    return;
  }
  if (tab.attachmentPreview) {
    store.report(t('附件预览暂不支持移到其他窗口。'));
    settled?.();
    return;
  }
  if (tab.pluginView) {
    store.report(t('插件视图绑定当前窗口的运行实例，可以在当前窗口分屏。'));
    settled?.(); return;
  }
  if (tab.workspaceView) {
    store.report(t('工作区视图暂不支持移到其他窗口。'));
    settled?.(); return;
  }
  if (tab.view && !tab.view.detachable) {
    store.report(tab.view.detachBlockedMessage ?? t('此视图保留在当前窗口，暂不支持移到其他窗口。'));
    settled?.();
    return;
  }
  if (tab.document?.conflict || tab.document?.missing) {
    store.report(t('请先处理文档冲突或缺失，再拖出标签页。'));
    settled?.();
    return;
  }
  detachingTab = true;
  // Collapse a departing single-tab pane before saving or starting a WebView.
  // For a drop still over this window, first confirm it belongs to another one.
  if (!drop?.insideSourceWindow) store.detachingTabId = id;
  try {
    await editing.flush();
    if (!(await store.flush())) throw new Error(t('还有未保存的修改，请先处理保存错误。'));
    const dock = drop
      ? await findTabDockTarget(workspace.value.id, id, {
          x: drop.x,
          y: drop.y,
          centerOffset: (drop.width ?? 0) / 2 - drop.grabX,
        })
      : null;
    if (dock === 'inside-window' || (!dock && drop?.insideSourceWindow)) return;
    store.detachingTabId = id;
    if (dock) {
      const transfer = await requestTabTransfer(dock.targetLabel, {
        workspaceId: workspace.value.id,
        tabId: id,
        ...(id === SETTINGS_TAB_ID ? { settingsPage: settingsPage.value } : {}),
        index: dock.index,
        drop: dock.drop,
      });
      await store.close(id);
      if (store.tabs.some((item) => item.id === id)) {
        await emitTo(dock.targetLabel, TAB_TRANSFER_ROLLBACK, {
          requestId: transfer.requestId,
        } satisfies TabTransferRollback);
        throw new Error(t('原标签页未能关闭，已取消跨窗口移动'));
      }
      if (detachedWindow && !store.tabs.length) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().destroy();
      }
      return;
    }
    const title = tab.view ? tab.view.label : tab.graph
      ? t('关系图谱')
      : tab.plugins
        ? t('插件')
        : tab.blank
          ? t('新标签页')
          : basename(tab.path).replace(/\.(md|markdown)$/i, '');
    const detached = await createDetachedTabWindow(workspace.value.path, id, title, drop,
      id === SETTINGS_TAB_ID ? settingsPage.value : undefined);
    await store.close(id);
    if (store.tabs.some((item) => item.id === id)) {
      await detached.destroy();
      throw new Error(t('原标签页未能关闭，已取消拖出。'));
    }
  } catch (error) {
    store.report(error);
  } finally {
    if (store.detachingTabId === id) store.detachingTabId = '';
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
    if (native && !mobile) await closeSettingsWindow();
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
const settingsSnapshot = computed<SettingsSnapshot>(() => ({
  pluginPages: store.pluginSettingsPages,
  workspace: workspace.value
    ? {
        id: workspace.value.id,
        name: workspace.value.name,
        path: workspace.value.path,
        readOnly: workspace.value.readOnly,
        canDelete: workspace.value.canDelete,
        canManageSettings: workspace.value.canManageSettings,
      }
    : null,
  activeFile: store.active ? { id: store.active.id, path: store.active.path } : null,
  workspaceSettings: store.workspaceSettings,
  workspacePages: workspace.value?.files.filter(file => file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path)).map(file => ({ id: file.id, path: file.path })) ?? [],
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
  visualFontChoice: visualFontChoice.value,
  customFontName: customFontName.value,
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
let settingsWindowVisible = false;
let requestedSettingsPage: SettingsPageId = 'appearance';
async function syncSettingsWindow() {
  if (!settingsWindowVisible) return;
  try {
    await emitTo(settingsWindowLabel(), SETTINGS_STATE, settingsSnapshot.value);
  } catch {
    settingsWindowVisible = false;
  }
}
watch(
  settingsSnapshot,
  () => {
    void syncSettingsWindow();
  },
  { deep: true },
);

function openSettings(page: SettingsPageId = 'appearance') {
  menu.value = false;
  workspaceMenu.value = false;
  settingsPage.value = page === 'preferences' ? 'appearance' : page;
  const pane = store.panes.find(pane => pane.tabs.includes(SETTINGS_TAB_ID));
  if (pane) {
    store.focusPane(pane.id);
    store.openViewTab(SETTINGS_TAB_ID);
    return;
  }
  settingsPanel.value = true;
}
function handleSettingsCommand(command: SettingsCommand) {
  if (command.type === 'plugin-invoke') {
    void store.interactWithPlugin(command.interaction).then(
      () => emitTo(settingsWindowLabel(), SETTINGS_PLUGIN_RESULT, { requestId: command.requestId }),
      error => emitTo(settingsWindowLabel(), SETTINGS_PLUGIN_RESULT, { requestId: command.requestId, error: String(error) }),
    ).catch(store.report);
    return;
  }
  if (command.type === 'workspace-delete') {
    void deleteWorkspace(command.workspaceId);
    return;
  }
  if (command.type === 'workspace-setting') {
    void store.updateWorkspaceSettings(command.workspaceId, command.patch);
    return;
  }
  if (command.type === 'workspace-settings-reload') {
    void store.reloadWorkspaceSettings();
    return;
  }
  if (command.type === 'workspace-export') {
    void exportWorkspace(command.workspaceId);
    return;
  }
  if (command.type === 'ready') {
    settingsWindowVisible = true;
    void syncSettingsWindow();
    void emitTo(settingsWindowLabel(), SETTINGS_NAVIGATE, requestedSettingsPage).catch(
      store.report,
    );
    return;
  }
  if (command.type === 'capability') {
    void store.updateCapabilities(command.value);
    return;
  }
  if (command.type === 'assistant-refresh') {
    void assistant.reloadConnections().catch(store.report);
    return;
  }
  if (command.type === 'action') {
    settingsAction(command.value);
    return;
  }
  if (command.type === 'update') {
    if (updates.state.phase === 'available') void updates.download();
    else if (updates.state.phase === 'ready') void updates.install();
    else void updates.check();
    return;
  }
  switch (command.key) {
    case 'defaultSource':
      defaultSource.value = command.value as boolean;
      break;
    case 'theme':
      theme.value = command.value as typeof theme.value;
      break;
    case 'visualFontChoice':
      visualFontChoice.value = command.value as typeof visualFontChoice.value;
      break;
    case 'customFontName':
      customFontName.value = command.value as string;
      break;
    case 'revealMarkdown':
      revealMarkdown.value = command.value as boolean;
      break;
    case 'toolbarMode':
      toolbarMode.value = parseToolbarMode(command.value);
      break;
    case 'shortcuts':
      shortcuts.value = parseShortcutBindings(command.value);
      break;
    case 'showPageTitle':
      showPageTitle.value = command.value as boolean;
      break;
    case 'showDocumentProperties':
      showDocumentProperties.value = command.value as boolean;
      break;
    case 'showDocumentDiscussion':
      showDocumentDiscussion.value = command.value as boolean;
      break;
    case 'showOutline':
      showOutline.value = command.value as boolean;
      break;
    case 'outlineOnLeft':
      outlineOnLeft.value = command.value as boolean;
      break;
    case 'visualFontSize':
      visualFontSize.value = command.value as number;
      break;
    case 'sourceFontSize':
      sourceFontSize.value = command.value as number;
      break;
    case 'editorPreferences':
      editorPreferences.value = command.value as typeof editorPreferences.value;
      break;
  }
}
function settingsAction(
  action: 'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out',
) {
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
async function exportDocument(format: DocumentExportFormat) {
  const doc = active.value,
    currentWorkspace = workspace.value;
  if (!doc || exportBusy.value) return;
  const title = showPageTitle.value
    ? editorScroll.value?.querySelector<HTMLTextAreaElement>('.document-title-wrap textarea')?.value
    : undefined;
  const options = {
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
  menu.value = false;
  exportBusy.value = true;
  try {
    const { downloadExport, exportFilename, renderDocumentExport } = await import('./document-export');
    const blob = await renderDocumentExport(options, format);
    const filename = exportFilename(doc.path, format);
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
  if (detachedWindow) return;
  sidebar.value = !sidebar.value;
  workspaceMenu.value = false;
}
function handleWorkbenchShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || importPanel.value || settingsPanel.value || commandPaletteOpened.value || updateLock.value || modal.value) return;
  let action: (() => void) | undefined;
  if (!detachedWindow && workspace.value && isSidebarToggleShortcut(event, shortcuts.value)) action = toggleSidebar;
  else if (matchesShortcut(event, 'save', shortcuts.value)) action = () => { void store.flush(); };
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
    !(event.target instanceof Element && event.target.closest('.page-search')) &&
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
      selectedEntryIds.value = new Set(
        [...document.querySelectorAll<HTMLElement>('.tree-scroll .tree-row[data-entry-id]')].map(
          (row) => row.dataset.entryId!,
        ),
      );
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
let unlistenClose: (() => void) | undefined;
let unlistenWatchError: (() => void) | undefined;
let unlistenTabTransfer: (() => void) | undefined;
let unlistenTabRollback: (() => void) | undefined;
let unlistenSettingsCommand: (() => void) | undefined;
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
  if (!detachedWindow) window.addEventListener('resize', constrainSidebarToViewport);
  document.addEventListener('visibilitychange', mobileVisibility);
  window.addEventListener('tano:back', mobileBack);
  if (webPageRouting) {
    initializePageHistory();
    window.addEventListener('popstate', handlePagePopState);
  }
  try {
    await workbenchSession.initialize(async () => {
      if (props.createWorkspace) await createNewWorkspace();
      else await store.initialize(initialPageRoute?.workspaceId ?? props.initialWorkspace);
    });
  } finally {
    startupPending.value = false;
  }
  if (unmounted) return;
  emit('ready');
  if (webPageRouting) {
    pageRouteReady = true;
    if (props.createWorkspace || initialPageRouteSuperseded) writePageRoute(true);
    else await applyPageRoute();
  }
  if (native && !mobile) {
    unlistenSettingsCommand = await listen<SettingsCommand>(SETTINGS_COMMAND, ({ payload }) => {
      handleSettingsCommand(payload);
    });
    unlistenTabTransfer = await listen<TabTransferRequest>(TAB_TRANSFER_REQUEST, ({ payload }) => {
      void acceptTabTransfer(payload).catch(store.report);
    });
    unlistenTabRollback = await listen<TabTransferRollback>(
      TAB_TRANSFER_ROLLBACK,
      ({ payload }) => {
        void rollbackTabTransfer(payload).catch(store.report);
      },
    );
  }
  const detachedRequest = detachedWindow ? detachedTabRequest() : null;
  if (detachedRequest) {
    const opened =
      store.workspace?.path === detachedRequest.workspacePath &&
      store.tabs.length === 1 &&
      (detachedRequest.tabId.startsWith('blank:') || store.tabs[0]?.id === detachedRequest.tabId);
    await reportDetachedReady(opened ? undefined : t('独立窗口未能打开所选标签页'));
  }
  if (native && !mobile && !detachedWindow) {
    void updates.initialize();
  }
  if (native) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (localNative)
      unlistenWatchError = await listen<string>('workspace-watch-error', (event) =>
        store.report(t('文件监听遇到错误：{0}。目录仍会定期自动检查。', [event.payload])),
      );
    if (!mobile)
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        if (updates.state.phase === 'installing') return;
        try {
          if (await store.flush()) {
            await assistant.settle();
            await inlineRunner.settle();
            await editing.suspendAll();
            await closeSettingsWindow();
            await getCurrentWindow().destroy();
          } else store.report(t('还有未保存的内容，窗口已保留。请先保存或另存副本。'));
        } catch (error) {
          store.report(error);
        }
      });
  }
});
onBeforeUnmount(() => {
  unmounted = true;
  document.documentElement.style.removeProperty('--sidebar-width');
  if (headingFrame !== undefined) cancelAnimationFrame(headingFrame);
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
  unlistenTabTransfer?.();
  unlistenTabRollback?.();
  unlistenSettingsCommand?.();
  for (const pending of transferRollback.values()) clearTimeout(pending.timer);
  transferRollback.clear();
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
</script>

<template>
  <AppTooltip />
  <Teleport v-if="native && !mobile && workspace && compactPanes" to="#desktop-window-tab-slot">
    <button
      v-if="!detachedWindow"
      :class="{ 'desktop-sidebar-toggle-hidden': sidebar }"
      class="desktop-sidebar-toggle icon-button"
      type="button"
      :aria-label="t('展开侧栏')"
      :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
      :aria-hidden="sidebar"
      :tabindex="sidebar ? -1 : 0"
      :disabled="sidebar"
      @click="toggleSidebar"
    >
      <PanelLeftOpen :size="16" :stroke-width="1.6" />
    </button>
    <DesktopTabs
      detachable
      :file-drag="tabFileDrag"
      @files-dropped="fileDragEnd"
      @new-tab="store.createBlankTab()"
      @new-document="createNewDocument"
      @detach-tab="detachTab"
    />
  </Teleport>
  <div
    class="app-shell"
    @pointermove="moveSidebarResize"
    @pointerup="finishSidebarResize"
    @pointercancel="finishSidebarResize"
    @lostpointercapture="finishSidebarResize"
    :class="{
      'sidebar-hidden': detachedWindow || !sidebar || !workspace,
      'detached-window': detachedWindow,
      'sidebar-resizing': resizingSidebar,
      'workspace-empty': !workspace,
    }"
  >
    <AssistantButterflyLayer :controller="butterfly" />
    <Teleport to="body"><FileMetadataPanel v-if="fileMetadataTarget" v-bind="fileMetadataTarget" @close="fileMetadataTarget = null" /></Teleport>
    <Transition name="sidebar-dismiss">
      <button
        v-if="workspace && sidebar && !detachedWindow && compactPanes"
        class="sidebar-dismiss"
        :aria-label="t('收起侧栏')"
        @click="toggleSidebar"
      />
    </Transition>
    <WorkspaceSidebar
      v-if="workspace && !detachedWindow"
      :open="sidebar"
      :compact="compactPanes"
      :content-element="mainColumn"
      @dismiss="sidebar = false"
    >
        <div class="sidebar-header">
          <div class="sidebar-brand-slot">
            <component
              :is="native ? 'div' : 'a'"
              class="brand"
              :href="native ? undefined : '/'"
              :aria-label="native ? undefined : t('返回同页首页')"
              @click="returnHome"
            >
              <img src="/favicon-green.svg?v=3" alt="" />
            </component>
          </div>
          <ButtonVisibilityGroup
            v-slot="{ isVisible }"
            :items="sidebarHeaderItems"
            :active="sidebar"
            preference-key="tano.preference.sidebarHiddenHeaderActions"
            group-class="sidebar-header-actions"
            :label="t('侧栏顶部按钮')"
            :menu-label="t('侧栏顶部按钮显示设置')"
            @open="closeButtonVisibilityMenus"
          >
            <template v-for="view in extensionViews" :key="`header-${view.id}`">
              <component
                :is="view.header"
                v-if="store.workspaceSettings.showCollaborationViews && view.header && isVisible(view.id)"
                :actions="viewActions[view.id]"
              />
            </template>
            <button v-if="isVisible('commands')" type="button" class="icon-button" :aria-label="t('打开命令中心')" :data-tooltip="t('命令中心')" :data-tooltip-shortcut="shortcuts.commandPalette" @click="commandPaletteOpened = true"><Search :size="17" /></button>
          </ButtonVisibilityGroup>
        </div>
        <SidebarNavigation
          v-slot="{ isVisible }"
          :items="sidebarNavigationItems"
          :active="sidebar"
          @open="closeButtonVisibilityMenus"
        >
          <button
            v-if="isVisible('repository')"
            type="button"
            class="sidebar-navigation-button"
            :aria-label="t('工作区')"
            :data-tooltip="t('工作区')"
            aria-controls="sidebar-repository-panel"
            :aria-pressed="navigationModule === 'workspace'"
            @click="selectModule('workspace')"
          >
            <Box :size="17" :stroke-width="1.8" aria-hidden="true" />
            <span :aria-hidden="navigationModule !== 'workspace'"><span>{{ t('工作区') }}</span></span>
          </button>
          <button
            v-if="store.workspaceSettings.showPlan && isVisible('plan')"
            type="button"
            class="sidebar-navigation-button"
            :aria-label="t('计划')"
            :data-tooltip="t('计划')"
            aria-controls="sidebar-plan-panel"
            :aria-pressed="navigationModule === 'plan'"
            @click="selectModule('plan')"
          >
            <CalendarDays :size="18" :stroke-width="1.6" aria-hidden="true" />
            <span :aria-hidden="navigationModule !== 'plan'"><span>{{ t('计划') }}</span></span>
          </button>
          <template v-for="view in extensionViews" :key="view.id">
            <button
              v-if="store.workspaceSettings.showCollaborationViews && view.sidebar && isVisible(view.id)"
              type="button"
              class="sidebar-navigation-button"
              :aria-label="view.label"
              :data-tooltip="view.label"
              :aria-controls="`sidebar-${view.id}`"
              :aria-pressed="sidebarView === view.id"
              @click="selectModule(view.id)"
            >
              <component :is="view.icon" :size="18" :stroke-width="1.6" aria-hidden="true" />
              <span :aria-hidden="sidebarView !== view.id"><span>{{ view.label }}</span></span>
            </button>
          </template>
        </SidebarNavigation>
        <PluginSidebar v-if="sidebarView === 'plugin-views'" />
          <div
            v-show="navigationModule === 'workspace'"
            class="section-label sidebar-view-header"
            :class="{ 'drop-target': draggedEntry && dropFolder === '' }"
            @dragover="fileDragOver('', $event)"
            @dragleave="fileDragLeave('', $event)"
            @drop="fileDrop('', $event)"
          >
            <span v-if="draggedEntry">{{ t('放到工作区根目录') }}</span>
            <WorkspaceViewSwitcher
              v-else
              :model-value="workspaceView"
              @update:model-value="selectWorkspaceView"
              :active="sidebar && !workspaceMenu && !modal && !settingsPanel"
              @open="closeButtonVisibilityMenus"
            />
            <ButtonVisibilityGroup
              v-slot="{ isVisible }"
              v-show="sidebarView === 'repository'"
              :items="repositoryActionItems"
              :active="sidebar && sidebarView === 'repository'"
              preference-key="tano.preference.repositoryHiddenActions"
              group-class="repository-actions"
              :label="t('工作区按钮')"
              :menu-label="t('工作区按钮显示设置')"
              @open="closeButtonVisibilityMenus"
            >
              <button
                v-if="isVisible('search')"
                type="button"
                class="icon-button"
                :aria-label="t('查找文档')"
                :data-tooltip="t('查找文档')" :data-tooltip-shortcut="shortcuts.findDocument"
                @click="showModal('search')"
              >
                <Search :size="15" :stroke-width="1.6" />
              </button>
              <button
                v-if="store.workspaceSettings.showGraph && isVisible('graph')"
                type="button"
                class="icon-button"
                :aria-label="t('打开关系图谱')"
                :data-tooltip="t('关系图谱')"
                :aria-pressed="activeId === GRAPH_TAB_ID"
                @click="store.openGraphTab()"
              >
                <GitFork :size="15" :stroke-width="1.6" />
              </button>
              <button
                v-if="isVisible('create')"
                class="icon-button"
                :aria-label="t('新建文档')"
                :data-tooltip="t('新建文档')" :data-tooltip-shortcut="shortcuts.newDocument"
                :disabled="!workspace || workspace.readOnly || busy"
                @click="createNewDocument"
              >
                <SquarePen :size="15" :stroke-width="1.6" />
              </button>
            </ButtonVisibilityGroup>
          </div>
        <div
          v-show="sidebarView === 'repository'"
          id="sidebar-repository-panel"
          class="sidebar-content"
        >
          <div
            class="tree-scroll"
            :class="{ 'drop-root': draggedEntry && dropFolder === '' }"
            @contextmenu.self.prevent="openDirectoryContextMenu('', $event)"
            @dragover.self="fileDragOver('', $event)"
            @dragleave.self="fileDragLeave('', $event)"
            @drop.self="fileDrop('', $event)"
          >
            <FileTree
              v-if="workspace"
              :entries="treeFiles"
              :document-icons="treeDocumentIcons"
              :load-document-icon="loadTreeDocumentIcon"
              :selected-ids="selectedEntryIds"
              :context-selected="fileContextMenu?.file.id"
              :dragged-id="draggedEntry?.file.id"
              :drop-target="dropFolder"
              :can-drag="canDragEntry"
              :renaming-id="treeRename?.fileId"
              :rename-entry="renameTreeEntry"
              @open="openTreeEntry"
              @select="selectFileTreeEntry"
              @prefetch="store.prefetchFile"
              @context="openFileContextMenu"
              @context-blank="openDirectoryContextMenu"
              @drag-start="fileDragStart"
              @drag-end="fileDragEnd"
              @drag-over="fileDragOver"
              @drag-leave="fileDragLeave"
              @drop="fileDrop"
              @rename-finished="finishTreeRename"
            />
            <div
              v-if="!noteCount"
              class="tree-empty"
              @contextmenu.prevent="openDirectoryContextMenu('', $event)"
            >
              {{ t('你的下一页，') }}<br />{{ t('从一个新文档开始。') }}
            </div>
          </div>
        </div>
        <section v-if="sidebarView === 'plugins'" class="sidebar-content workspace-plugins-sidebar" :aria-label="t('工作区插件')">
          <PluginInstaller sidebar @objects="showObjects()" />
        </section>
        <section v-if="sidebarView === 'views'" class="sidebar-content workspace-views-sidebar" :aria-label="t('数据库与视图')">
          <button @click="store.openDataTable()"><Table2 :size="15" />{{ t('数据表') }}</button>
          <button v-for="record in store.workspaceViews" :key="record.view.id" @click="store.openWorkspaceView(record.view.id)">{{ record.view.name }}</button>
        </section>
        <SidebarAssistant v-if="sidebarView === 'assistant'" @open="compactPanes && (sidebar = false)" />
        <SidebarPlan
          v-show="sidebarView === 'plan' || sidebarView === 'events'"
          :active="sidebar && (sidebarView === 'plan' || sidebarView === 'events')"
          :workspace-only="sidebarView === 'events'"
          id="sidebar-plan-panel"
          :date="sidebarCalendarDate"
          @select-date="openCalendar"
          @select-event="showPlanEvent"
        />
        <template v-for="view in extensionViews" :key="view.id">
          <component
            :is="view.sidebar"
            v-if="view.sidebar"
            v-show="sidebarView === view.id"
            :id="`sidebar-${view.id}`"
            :actions="viewActions[view.id]"
          />
        </template>
        <Teleport to="body">
          <div
            v-if="fileContextMenu"
            class="dropdown compact-action-menu file-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="
              multipleContextEntries
                ? t('{0} 个条目操作', [contextEntries.length])
                : t('{0} 操作', [fileContextMenu.file.name])
            "
            :style="{ left: `${fileContextMenu.x}px`, top: `${fileContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <PluginMenu v-if="!multipleContextEntries && fileContextMenu.file.kind === 'file'" location="file" :file-id="fileContextMenu.file.id" @selected="closeFileContextMenu()" />
            <template v-if="multipleContextEntries">
              <div class="file-context-count" role="presentation">
                {{ t('已选中') }} {{ contextEntries.length }} {{ t('个条目') }}
              </div>
              <button
                v-if="!mobile && localNative"
                role="menuitem"
                :disabled="selectionDeleteDisabled"
                @click="fileContextAction('duplicate')"
              >
                <Copy :size="15" />{{ t('为所选条目创建副本') }}
              </button>
              <button role="menuitem" @click="fileContextAction('copy')">
                <Copy :size="15" />{{ t('复制相对路径') }}
              </button>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                @click="fileContextAction('copy-full-path')"
              >
                <Copy :size="15" />{{ t('复制完整路径') }}
              </button>
              <div class="menu-divider" role="separator" />
              <button
                class="danger-text"
                role="menuitem"
                :disabled="selectionDeleteDisabled"
                @click="fileContextAction('delete')"
              >
                <Trash2 :size="15" />{{
                  store.isDemo
                    ? t('删除所选条目')
                    : store.isWeb
                      ? t('删除所选文档')
                      : t('将所选条目移入回收站')
                }}
              </button>
            </template>
            <template v-else>
              <template v-if="fileContextMenu.file.kind === 'directory'">
                <button
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('document')"
                >
                  <FileText :size="15" />{{ t('在此新建文档') }}
                </button>
                <button role="menuitem" :disabled="fileMutationDisabled(fileContextMenu.file)" @click="fileContextAction('table')">
                  <Table2 :size="15" />{{ t('在此新建数据表') }}
                </button>
                <button role="menuitem" :disabled="fileMutationDisabled(fileContextMenu.file)" @click="fileContextAction('database')">
                  <Table2 :size="15" />{{ t('以数据库视图管理此目录') }}
                </button>
                <button
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('folder')"
                >
                  <FolderPlus :size="15" />{{ t('在此新建文件夹') }}
                </button>
                <button
                  role="menuitem"
                  :disabled="
                    fileMutationDisabled(fileContextMenu.file) ||
                    directoryHasManagedFile(fileContextMenu.file)
                  "
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />{{ t('重命名文件夹') }}
                </button>
              </template>
              <template v-else>
                <button
                  v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)"
                  role="menuitem"
                  @click="fileContextAction('object')"
                >
                  <Users :size="15" />{{ t('查看文件对象') }}
                </button>
                <button v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)" role="menuitem" @click="fileContextAction('metadata')">
                  <FileText :size="15" />{{ t('文件属性') }}
                </button>
                <button v-if="attachments && !isWorkspaceInternalPath(fileContextMenu.file.path)" role="menuitem" @click="fileContextAction('export')">
                  <ArrowUpRight :size="15" />{{ t('导出文件副本') }}
                </button>
                <button
                  v-if="isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path) || attachments"
                  role="menuitem"
                  @click="fileContextAction('open')"
                >
                  <FileText :size="15" />{{
                    isDataTableFilePath(fileContextMenu.file.path) ? t('打开数据表') : isMarkdown(fileContextMenu.file.path) ? t('打开文档') : t('打开附件')
                  }}
                </button>
                <button
                  v-if="tabsEnabled && (isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path))"
                  role="menuitem"
                  @click="fileContextAction('open-new-tab')"
                >
                  <ExternalLink :size="15" />{{ t('在新标签页中打开') }}
                </button>
                <button
                  v-if="isMarkdown(fileContextMenu.file.path)"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />{{ t('重命名文档') }}
                </button>
                <button
                  v-else-if="attachments || isDataTableFilePath(fileContextMenu.file.path)"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />{{ t('重命名文件') }}
                </button>
              </template>
              <button
                v-if="canDuplicateEntry(fileContextMenu.file)"
                role="menuitem"
                :disabled="fileMutationDisabled(fileContextMenu.file)"
                @click="fileContextAction('duplicate')"
              >
                <Copy :size="15" />{{ t('创建副本') }}
              </button>
              <button role="menuitem" @click="fileContextAction('copy')">
                <Copy :size="15" />{{ t('复制相对路径') }}
              </button>
              <button
                v-if="store.isWeb && fileContextMenu.file.kind === 'file' && (isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path))"
                role="menuitem"
                @click="fileContextAction('copy-link')"
              >
                <Link :size="15" />{{ t('复制链接') }}
              </button>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                @click="fileContextAction('copy-full-path')"
              >
                <Copy :size="15" />{{
                  fileContextMenu.file.kind === 'directory' ? t('复制文件夹路径') : t('复制文件路径')
                }}
              </button>
              <template v-if="localNative && !mobile">
                <div class="menu-divider" role="separator" />
                <button role="menuitem" @click="fileContextAction('open-default')">
                  <ArrowUpRight :size="15" />{{ t('使用默认应用打开') }}
                </button>
                <button role="menuitem" @click="fileContextAction('reveal-entry')">
                  <ArrowUpRight :size="15" />{{ t('在系统资源管理器中显示') }}
                </button>
              </template>
              <template v-if="!fileDeleteDisabled(fileContextMenu.file) || !store.isWeb">
                <div class="menu-divider" role="separator" />
                <button
                  class="danger-text"
                  role="menuitem"
                  :disabled="fileDeleteDisabled(fileContextMenu.file)"
                  @click="fileContextAction('delete')"
                >
                  <Trash2 :size="15" />{{
                    store.isDemo
                      ? t('删除')
                      : store.isWeb
                        ? fileContextMenu.file.kind === 'directory'
                          ? t('删除在线文件夹')
                          : t('删除在线文档')
                        : t('移入回收站')
                  }}
                </button>
              </template>
            </template>
          </div>
        </Teleport>
        <Teleport to="body">
          <div
            v-if="directoryContextMenu"
            class="dropdown compact-action-menu file-context-menu directory-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="t('目录操作')"
            :style="{ left: `${directoryContextMenu.x}px`, top: `${directoryContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <button
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('document')"
            >
              <FileText :size="15" />{{ t('新建文档') }}
            </button>
            <button role="menuitem" :disabled="!workspace || workspace.readOnly || busy" @click="directoryContextAction('table')">
              <Table2 :size="15" />{{ t('新建数据表') }}
            </button>
            <button role="menuitem" :disabled="!workspace || workspace.readOnly || busy" @click="directoryContextAction('database')">
              <Table2 :size="15" />{{ t('以数据库视图管理此目录') }}
            </button>
            <button
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('folder')"
            >
              <FolderPlus :size="15" />{{ t('新建文件夹') }}
            </button>
            <button
              v-if="!directoryContextMenu.parent"
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('import')"
            >
              <ArrowDownToLine :size="15" />{{ t('导入') }}
            </button>
            <template v-if="directoryContextMenu.parent">
              <button
                role="menuitem"
                :disabled="directoryContextDuplicateDisabled()"
                @click="directoryContextAction('duplicate')"
              >
                <Copy :size="15" />{{ t('创建副本') }}
              </button>
              <button role="menuitem" @click="directoryContextAction('copy')">
                <Copy :size="15" />{{ t('复制相对路径') }}
              </button>
              <div class="menu-divider" role="separator" />
              <button
                role="menuitem"
                :disabled="directoryContextRenameDisabled()"
                @click="directoryContextAction('rename')"
              >
                <Pencil :size="15" />{{ t('重命名文件夹') }}
              </button>
              <button
                class="danger-text"
                role="menuitem"
                :disabled="directoryContextDeleteDisabled()"
                @click="directoryContextAction('delete')"
              >
                <Trash2 :size="15" />{{
                  store.isDemo ? t('删除文件夹') : store.isWeb ? t('删除在线文件夹') : t('将文件夹移入回收站')
                }}
              </button>
            </template>
          </div>
        </Teleport>
        <Teleport to="body">
          <div
            v-if="workspaceEntryContextMenu"
            ref="workspaceEntryContextMenuElement"
            class="dropdown compact-action-menu file-context-menu workspace-entry-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="t('{0} 工作区操作', [workspaceEntryContextMenu.item.name])"
            :style="{ left: `${workspaceEntryContextMenu.x}px`, top: `${workspaceEntryContextMenu.y}px` }"
            @keydown="workspaceEntryContextKeydown"
          >
            <button
              role="menuitem"
              :disabled="busy"
              @click="workspaceEntryContextAction('open')"
            >
              <FolderOpen :size="15" />{{ t('打开工作区') }}
              <Check
                v-if="workspaceEntryContextMenu.item.id === workspace?.id"
                class="workspace-entry-context-check"
                :size="14"
              />
            </button>
            <template v-if="workspaceEntryContextMenu.item.id === workspace?.id">
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                :disabled="busy"
                @click="workspaceEntryContextAction('reveal')"
              >
                <ExternalLink :size="15" />{{ t('在资源管理器中显示') }}
              </button>
              <button v-if="!store.isWeb" role="menuitem" :disabled="busy" @click="workspaceEntryContextAction('leave')">
                <LogOut :size="15" />{{ t('退出当前工作区') }}
              </button>
            </template>
          </div>
        </Teleport>
        <div class="sidebar-bottom">
          <div class="workspace-picker-wrap">
            <button
              class="workspace-picker"
              :aria-expanded="workspaceMenu"
              aria-controls="workspace-menu"
              :aria-label="t('切换工作区')"
              :data-tooltip="workspace?.name ?? t('选择工作区')"
              @click="toggleWorkspaceMenu"
              @contextmenu.stop.prevent="toggleWorkspaceMenu"
            >
              <span class="workspace-avatar"><WorkspaceIcon :icon="store.workspaceSettings.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="15" /></span>
              <span class="workspace-picker-text"
                ><strong>{{ workspace?.name ?? t('选择工作区') }}</strong></span
              >
              <component :is="workspaceMenu ? ChevronUp : ChevronDown" :size="12" />
            </button>
            <div
              v-if="workspaceMenu"
              id="workspace-menu"
              class="dropdown compact-action-menu sidebar-popover workspace-dropdown"
              @contextmenu.stop.prevent="workspaceDropdownContextMenu"
            >
              <div class="workspace-menu-summary">
                <span class="workspace-menu-avatar"><WorkspaceIcon :icon="store.workspaceSettings.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="16" /></span>
                <span class="workspace-menu-summary-text">
                  <strong>{{ workspace?.name ?? t('选择工作区') }}</strong>
                  <small>{{
                    store.isDemo
                      ? t('浏览器演示')
                      : store.isWeb
                        ? workspace?.readOnly
                          ? t('在线工作区 · 只读')
                          : t('在线工作区')
                        : t('本地工作区')
                  }}</small>
                </span>
                <button
                  v-if="workspace"
                  class="workspace-menu-exit"
                  type="button"
                  :aria-label="t('退出当前工作区')"
                  :data-tooltip="t('退出当前工作区')"
                  :disabled="busy"
                  @click="leaveWorkspace"
                >
                  <LogOut :size="16" />
                </button>
              </div>
              <PluginMenu location="workspace" @selected="workspaceMenu = false" />
              <component
                :is="extensions.regions['workspace-menu-layout'] ?? WorkspaceMenuLayout"
                :actions="extensionActions"
              >
              <template v-if="extensions.regions['workspace-settings']" #settings>
              <component
                :is="extensions.regions['workspace-settings']"
                :actions="extensionActions"
              />
              </template>
              <template #default>
              <component
                :is="extensions.regions['workspace-settings']"
                v-if="extensions.regions['workspace-menu-layout'] && extensions.regions['workspace-settings']"
                :actions="extensionActions"
              />
              <button v-if="workspace && native && !mobile && !store.isWeb" role="menuitem" @click="openSystemSync()"><RefreshCw :size="16" />Git 与同步</button>
              <button v-if="workspace" role="menuitem" :disabled="workspace.readOnly || busy" @click="openImport">
                <ArrowDownToLine :size="16" />{{ t('导入') }}
              </button>
              <button
                v-if="workspace"
                role="menuitem"
                :disabled="workspace.readOnly || busy"
                @click="
                  workspaceMenu = false;
                  openTemplateLibrary();
                "
              >
                <Files :size="16" />{{ t('文档模板') }}
              </button>
              <button role="menuitem" @click="showObjects()"><Users :size="16" />{{ t('工作区对象') }}</button>
              <button role="menuitem" :disabled="!workspace || workspace.readOnly || busy || !store.capabilities.features.objectReferences" @click="workspaceMenu = false; store.createObjectDatabase().catch(store.report)"><Table2 :size="16" />{{ t('创建对象数据库视图') }}</button>
              <template v-if="store.workspaceViews.length">
                <div class="menu-divider" />
                <button
                  v-for="record in store.workspaceViews"
                  :key="record.view.id"
                  role="menuitem"
                  @click="workspaceMenu = false; store.openWorkspaceView(record.view.id).catch(store.report)"
                >
                  <Table2 :size="16" />{{ t('打开视图：{0}', [record.view.name]) }}
                </button>
              </template>
              <p v-for="error in store.workspaceViewErrors" :key="error" class="workspace-view-menu-error" role="alert">{{ error }}</p>
              <button role="menuitem" @click="openSettings('about')">
                <CircleHelp :size="16" />{{ t('关于 Tano / 同页') }}{{
                  updates.state.candidate ? t(' · 有新版本') : ''
                }}
              </button>
              <div v-if="extensions.regions['account-note']" class="menu-divider" />
              <component
                :is="extensions.regions['account-note']"
                v-if="extensions.regions['account-note']"
                :actions="extensionActions"
              />
              <div
                v-if="
                  extensions.regions['mode-switch'] ||
                  workspace ||
                  extensions.regions['workspace-history'] ||
                  extensions.regions['sign-out']
                "
                class="menu-divider"
              />
              <component
                :is="extensions.regions['mode-switch']"
                v-if="extensions.regions['mode-switch']"
                :actions="extensionActions"
              />
              <button
                v-if="mobile && workspace"
                role="menuitem"
                @click="
                  workspaceMenu = false;
                  recyclePanel = true;
                "
              >
                <Trash2 :size="16" />{{ t('手机回收站') }}
              </button>
              <button
                v-if="workspace"
                role="menuitem"
                @click="
                  workspaceMenu = false;
                  agentPanel = true;
                "
              >
                <Bot :size="16" />{{ t('与 Agent 一起工作') }}
              </button>
              <component
                :is="extensions.regions['workspace-history']"
                v-if="extensions.regions['workspace-history']"
                :actions="extensionActions"
              />
              <component
                :is="extensions.regions['sign-out']"
                v-if="extensions.regions['sign-out']"
                :actions="extensionActions"
              />
              </template>
              <template #workspaces>
              <component
                v-if="extensions.regions['workspace-menu']"
                :is="extensions.regions['workspace-menu']"
                :actions="extensionActions"
              />
              <template v-else>
                <button
                  v-if="store.isDemo || mobile"
                  :disabled="busy"
                  @click="
                    workspaceMenu = false;
                    store.isDemo ? openSettings('about') : store.openWorkspace();
                  "
                >
                  <FolderOpen :size="16" />{{ store.isDemo ? t('了解演示存储') : t('打开默认手机空间') }}
                </button>
                <component
                  :is="extensions.regions['local-menu-login']"
                  v-if="extensions.regions['local-menu-login']"
                  :actions="extensionActions"
                />
                <button v-if="mobile" :disabled="busy" @click="createNewWorkspace">
                  <FolderPlus :size="16" />{{ t('新建手机空间') }}
                </button>
                <template v-if="store.recent.length || (!store.isDemo && !mobile)">
                  <div
                    v-if="store.isDemo || mobile || extensions.regions['local-menu-login']"
                    class="menu-divider"
                  />
                  <div class="workspace-recent-heading">
                    <span class="recent-label">{{ store.isDemo ? t('最近工作空间') : t('本地工作区') }}</span>
                    <button
                      v-if="!store.isDemo && !mobile"
                      type="button"
                      class="workspace-recent-open"
                      :aria-label="t('打开新的本地文件夹')"
                      :data-tooltip="t('打开新的本地文件夹')"
                      :disabled="busy"
                      @click="
                        workspaceMenu = false;
                        store.openWorkspace();
                      "
                    >
                      <FolderPlus :size="16" :stroke-width="1.6" />
                    </button>
                  </div>
                  <button
                    v-for="item in store.recent.slice(0, 5)"
                    :key="item.id"
                    :data-tooltip="item.path"
                    :disabled="busy"
                    :aria-current="item.id === workspace?.id ? 'true' : undefined"
                    :data-workspace-entry-id="item.id"
                    @mousedown.right.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                    @contextmenu.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                    @click="
                      workspaceMenu = false;
                      store.openWorkspace(item.path);
                    "
                  >
                    <span class="workspace-list-avatar"><WorkspaceIcon :icon="item.id === workspace?.id ? store.workspaceSettings.icon : item.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="16" /></span>
                    <span class="recent-name">{{ item.name }}</span>
                    <Check v-if="item.id === workspace?.id" :size="15" />
                  </button>
                </template>
              </template>
              </template>
              </component>
            </div>
          </div>
          <component
            :is="extensions.regions['sidebar-footer']"
            v-if="extensions.regions['sidebar-footer']"
            :actions="extensionActions"
          />
          <HelpLauncher
            :context="helpContext"
            :availability="helpAvailability"
            :available="sidebar && !!workspace && !detachedWindow"
            :blocked="helpBlocked"
            :scope="`${workspace?.id}:${activeId}`"
            :documentation-base-url="documentationBaseUrl"
            :native="native"
            @open="workspaceMenu = false; menu = false"
            @settings="openSettings"
            @documentation="openExternalUrl($event).catch(store.report)"
          />
        </div>
        <div
          v-if="!compactPanes"
          class="sidebar-resize-handle"
          role="separator"
          :aria-label="t('调整侧栏宽度')"
          aria-orientation="vertical"
          :aria-valuenow="sidebarWidth ?? defaultSidebarWidth()"
          :aria-valuemin="SIDEBAR_MIN_WIDTH"
          :aria-valuemax="sidebarWidthLimit()"
          tabindex="0"
          @pointerdown="startSidebarResize"
          @keydown="resizeSidebarWithKeyboard"
        />
    </WorkspaceSidebar>

    <div ref="mainColumn" class="main-column" :inert="compactPanes && sidebar && !!workspace || undefined">
      <ReferenceGraphPopover
        v-if="referenceGraphTarget"
        v-model:opened="referenceGraphOpened"
        variant="panel"
        :identity="{ type: 'document', id: referenceGraphTarget.id }"
        :label="referenceGraphTarget.path.replace(/\.(md|markdown)$/i, '')"
        :anchor="referenceGraphAnchor"
        @open="openReference"
      />
      <div v-if="workspace && compactPanes && tabsEnabled" class="workspace-tabbar">
        <DesktopTabs
          :file-drag="tabFileDrag"
          :assistant-tab="assistantTab"
          @files-dropped="fileDragEnd"
          @new-tab="store.createBlankTab()"
          @new-document="createNewDocument"
        />
      </div>

      <WorkspacePanes
        v-if="workspace"
        :compact="compactPanes"
        :tabs-enabled="tabsEnabled"
        :class="{ 'workspace-native-tabs': tabsEnabled && !compactPanes }"
      >
        <template #tabs="{ pane, rect }">
          <div v-if="!compactPanes" class="workspace-tabbar" :data-tab-pane-id="pane.id">
            <button
              v-if="
                native &&
                !mobile &&
                !detachedWindow &&
                !sidebar &&
                rect.top === 0 &&
                rect.left === 0
              "
              class="desktop-sidebar-toggle icon-button"
              type="button"
              :aria-label="t('展开侧栏')"
              :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
              @click="toggleSidebar"
            >
              <PanelLeftOpen :size="16" :stroke-width="1.6" />
            </button>
            <DesktopTabs
              :pane-id="pane.id"
              :detachable="native && !mobile"
              :file-drag="tabFileDrag"
              :assistant-tab="assistantTab"
              @files-dropped="fileDragEnd"
              @new-tab="
                store.focusPane(pane.id);
                store.createBlankTab();
              "
              @new-document="
                store.focusPane(pane.id);
                createNewDocument();
              "
              @detach-tab="detachTab"
            />
            <div
              v-if="native && !mobile"
              v-show="rect.top === 0"
              class="workspace-window-drag"
              :title="t('拖动窗口')"
              @mousedown="dragPaneWindow"
              @dblclick="maximizePaneWindow"
            />
          </div>
        </template>
        <template #sidebar>
          <AssistantPanel
            v-if="assistant.available && assistantPanelMounted"
            :compact="compactPanes"
            :fullscreen-target="assistantHosts.get(assistant.fullscreenPaneId ?? '')"
            :navigation-visible="store.activeId === ASSISTANT_TAB_ID"
            @show-navigation="sidebar = true"
            @open-reference="openReference"
            @reveal-selection="revealAssistantSelection"
            @open-settings="openSettings('assistant')"
            @closed="assistantPanelMounted = assistant.opened"
          />
        </template>
        <template #default="{ pane, document: active, tab }">
          <LoadingSkeleton v-if="store.openingDocuments[pane.id]?.tabId === pane.activeId" variant="document" :rows="10" class="pane-loading-skeleton" />
          <TemplateLibrary
            v-if="templateLibraryOpen && pane.id === templatePaneId && workspace"
            :key="workspace.id"
            :source="templateSource"
            :initialize="templateInitialization"
            :demo-label="store.isDemo ? workspaceStatusLabel : undefined"
            @close="templateLibraryOpen = false"
            @open-file="(file) => { store.focusPane(pane.id); openEntry(file); }"
          >
            <template #navigation>
              <div v-if="!sidebar && !(native && !mobile && workspace)" class="topbar-navigation">
                <button type="button" class="icon-button" :aria-label="t('展开侧栏')" :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar" @click="toggleSidebar"><PanelLeftOpen :size="16" :stroke-width="1.6" /></button>
              </div>
            </template>
          </TemplateLibrary>
          <div
            :id="`assistant-fullscreen-${pane.id}`"
            :ref="(el) => setAssistantHost(pane.id, el)"
            v-show="assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)"
            class="assistant-fullscreen-host"
          />
          <div v-show="!assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)" class="workspace-page-content">
            <ButtonVisibilityGroup
              v-if="!detachedWindow"
              v-slot="{ isVisible }"
              :items="
                topbarVisibilityItems(pane.activeId, !!active, pane.id === store.activePaneId)
              "
              preference-key="tano.preference.documentHiddenTools"
              tag="header"
              :group-class="pane.activeId === GRAPH_TAB_ID ? 'topbar graph-topbar' : 'topbar'"
              :label="pane.activeId === GRAPH_TAB_ID ? t('图谱顶部栏') : t('文档顶部栏')"
              :menu-label="t('顶部栏显示设置')"
              @open="closeButtonVisibilityMenus"
            >
              <div
                v-if="
                  (native && !tabsEnabled && (isVisible('back') || isVisible('forward'))) ||
                  (!sidebar && !(native && !mobile && workspace))
                "
                class="topbar-navigation"
                role="group"
                :aria-label="pane.activeId === GRAPH_TAB_ID ? t('图谱导航') : t('文档导航')"
              >
                <button
                  v-if="!sidebar && !(native && !mobile && workspace)"
                  type="button"
                  class="icon-button"
                  :aria-label="t('展开侧栏')"
                  :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
                  @click="toggleSidebar"
                >
                  <PanelLeftOpen :size="16" :stroke-width="1.6" />
                </button>
                <button
                  v-if="native && !tabsEnabled && isVisible('back')"
                  type="button"
                  class="icon-button"
                  :aria-label="t('后退')"
                  :data-tooltip="t('后退')"
                  :disabled="!canNavigatePage(-1)"
                  @click="navigatePage(-1)"
                >
                  <ArrowLeft :size="16" :stroke-width="1.6" />
                </button>
                <button
                  v-if="native && !tabsEnabled && isVisible('forward')"
                  type="button"
                  class="icon-button"
                  :aria-label="t('前进')"
                  :data-tooltip="t('前进')"
                  :disabled="!canNavigatePage(1)"
                  @click="navigatePage(1)"
                >
                  <ArrowRight :size="16" :stroke-width="1.6" />
                </button>
              </div>
              <WorkspaceBreadcrumb
                :perch="{ id: `breadcrumb:${paneButterflyScope(pane.id, pane.activeId)}`, scope: paneButterflyScope(pane.id, pane.activeId), label: t('面包屑'), kind: 'component' }"
                v-if="
                  isVisible('breadcrumb') &&
                  pane.activeId !== CALENDAR_TAB_ID &&
                  pane.activeId !== GRAPH_TAB_ID
                "
                :workspace-id="workspace?.id"
                :workspace-name="workspace?.name ?? 'Tano'"
                :hide-workspace="!!tab?.path"
                :entries="workspace?.files ?? []"
                :document-icons="treeDocumentIcons"
                :load-document-icon="loadTreeDocumentIcon"
                :path="tab?.path"
                :demo-label="store.isDemo ? workspaceStatusLabel : undefined"
                :read-only="workspace?.readOnly"
                @open="(file) => { store.focusPane(pane.id); openEntry(file); }"
              >
                <template #status>
                  <DocumentStatus v-if="active && isVisible('document-status')" :document-key="`${workspace?.id}:${active.id}`" :items="paneDocumentStatus(active)" />
                </template>
                <template v-if="tab?.pluginView"><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current">{{ tab.pluginView.label }}</span></template>
                <template v-if="pane.activeId === PLUGINS_TAB_ID"
                  ><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current"
                    >{{ t('插件') }}</span
                  ></template
                ><template
                  v-for="view in [...extensionViews, settingsTabView].filter((view) => view.id === pane.activeId)"
                  :key="view.id"
                  ><ChevronRight :size="12" /><component :is="view.icon" :size="14" /><span
                    class="breadcrumb-current"
                    >{{ view.label }}</span
                  ></template
                >
              </WorkspaceBreadcrumb>
              <DocumentStatus v-if="active && !isVisible('breadcrumb') && isVisible('document-status')"
                :document-key="`${workspace?.id}:${active.id}`" :items="paneDocumentStatus(active)" />
              <div class="topbar-right">
                <button v-if="active && touchLayout && showOutline" type="button" class="icon-button"
                  :aria-label="t('文档大纲')" :aria-expanded="touchOutlineOpen"
                  @click="panel = 'outline'; touchOutlineOpen = !touchOutlineOpen">
                  <List :size="18" />
                </button>
                <button
                  v-if="tab?.attachment && attachments && isVisible('attachment-export')"
                  type="button"
                  class="topbar-attachment-action"
                  :aria-label="t('导出附件')"
                  :data-tooltip="t('导出附件副本')"
                  @click="
                    attachments
                      .exportAttachment(workspace!.id, tab.attachment.path)
                      .catch(store.report)
                  "
                >
                  <ArrowDownToLine :size="16" /><span>{{ t('导出') }}</span>
                </button>
                <component
                  :is="extensions.regions['editing-status']"
                  v-if="
                    isVisible('editing-status') &&
                    pane.id === store.activePaneId &&
                    extensions.regions['editing-status']
                  "
                  :actions="extensionActions"
                />
                <span
                  v-if="
                    workspaceStatusLabel &&
                    (!store.isDemo ||
                      !isVisible('breadcrumb') ||
                      pane.activeId === CALENDAR_TAB_ID ||
                      pane.activeId === GRAPH_TAB_ID)
                  "
                  :class="store.isDemo ? 'demo-badge' : 'local-badge'"
                  :title="store.isDemo ? t('浏览器演示 · 数据仅保存在本浏览器') : undefined"
                >
                  <LockKeyhole v-if="workspace?.readOnly" :size="14" />
                  {{ workspaceStatusLabel }}
                </span>
                <div
                  :id="`graph-controls-${pane.id}`"
                  v-show="pane.activeId === GRAPH_TAB_ID"
                  class="graph-toolbar-host"
                />
                <div
                  v-if="isTableTab(pane.activeId)"
                  :id="`data-table-controls-${pane.id}`"
                />
                <div
                  v-if="
                    pane.activeId === CALENDAR_TAB_ID &&
                    calendarToolItems.some((item) => isVisible(item.id))
                  "
                  class="calendar-topbar-controls"
                  role="group"
                  :aria-label="t('日历导航')"
                >
                  <span v-if="isVisible('calendar-period')" class="calendar-topbar-period">{{
                    calendarPeriod
                  }}</span>
                  <button
                    v-if="isVisible('calendar-today')"
                    type="button"
                    class="calendar-topbar-today"
                    @click="calendarDate = new Date()"
                  >
                    {{ t('今天') }}
                  </button>
                  <button
                    v-if="isVisible('calendar-previous')"
                    type="button"
                    class="icon-button"
                    :aria-label="t('上一时段')"
                    :data-tooltip="t('上一时段')"
                    @click="moveCalendarPeriod(-1)"
                  >
                    <ChevronLeft :size="17" />
                  </button>
                  <button
                    v-if="isVisible('calendar-next')"
                    type="button"
                    class="icon-button"
                    :aria-label="t('下一时段')"
                    :data-tooltip="t('下一时段')"
                    @click="moveCalendarPeriod(1)"
                  >
                    <ChevronRight :size="17" />
                  </button>
                  <div
                    v-if="isVisible('calendar-mode')"
                    class="calendar-view-picker"
                    @keydown.esc.stop.prevent="calendarModeOpen = false"
                  >
                    <button
                      type="button"
                      class="calendar-topbar-mode"
                      :aria-label="t('切换日历视图')"
                      :data-tooltip="t('Ctrl + 滚轮：切换日历视图')"
                      aria-haspopup="menu"
                      :aria-expanded="calendarModeOpen"
                      @click="calendarModeOpen = !calendarModeOpen"
                    >
                      {{ calendarModeLabel }}<ChevronDown :size="14" />
                    </button>
                    <div
                      v-if="calendarModeOpen"
                      class="calendar-view-menu"
                      role="menu"
                      :aria-label="t('日历视图')"
                    >
                      <button
                        v-for="option in calendarModeOptions"
                        :key="option.mode"
                        type="button"
                        role="menuitemradio"
                        :aria-checked="calendarMode === option.mode"
                        @click="selectCalendarMode(option.mode)"
                      >
                        {{ option.label }}<Check v-if="calendarMode === option.mode" :size="15" />
                      </button>
                    </div>
                  </div>
                  <button
                    v-if="isVisible('calendar-events')"
                    type="button"
                    class="calendar-topbar-events"
                    :data-tooltip="t('查看和管理事件')"
                    @click="managePlanEvents"
                  >
                    <CalendarDays :size="15" />{{ t('管理事件') }}
                  </button>
                </div>
                <div v-if="active && documentSuggestions.get(active.id)?.mode && !editing.isManaging(active.id)"
                  class="suggestion-mode-badge" role="status" :aria-label="t('建议模式已开启')">
                  <MessageSquareDiff :size="14" /><span>{{ t('建议模式') }}</span>
                  <button type="button" :aria-label="t('退出建议模式')" :data-tooltip="t('退出建议模式')"
                    :disabled="suggestionModeBusy || documentSuggestions.get(active.id)?.reviewing"
                    @click="toggleSuggestionMode(active.id)"><X :size="14" /></button>
                </div>
                <template v-if="active">
                  <div
                    v-if="documentToolItems.some((item) => isVisible(item.id))"
                    class="document-tool-buttons"
                  >
                    <MarkdownRevealToggle
                      v-if="isVisible('markdown-reveal')"
                      v-model="revealMarkdown"
                      :source="paneSource(pane.activeId)"
                    />
                    <button
                      v-if="isVisible('source-mode')"
                      type="button"
                      class="icon-button source-mode-button"
                      :class="{ active: paneSource(pane.activeId) }"
                      :disabled="
                        editing.isManaging(pane.activeId) ||
                        (pane.id === store.activePaneId && editing.activeBusy)
                      "
                      :aria-label="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
                      :aria-pressed="paneSource(pane.activeId)"
                      :data-tooltip="
                        editing.isManaging(pane.activeId)
                          ? t('当前编辑扩展不支持切换源码模式')
                          : paneSource(pane.activeId)
                            ? t('返回编辑')
                            : t('切换源码模式')
                      "
                      @click="setPaneSource(pane.activeId, !paneSource(pane.activeId))"
                    >
                      <Code2 :size="17" />
                    </button>
                  </div>
                  <div class="menu-wrap">
                    <button
                      class="icon-button"
                      :aria-label="t('文档操作')"
                      v-butterfly-perch="{ id: `document-actions:${paneButterflyScope(pane.id, pane.activeId)}`, scope: paneButterflyScope(pane.id, pane.activeId), label: t('文档操作按钮'), kind: 'component' }"
                      :aria-expanded="menu && pane.id === store.activePaneId"
                      @click="toggleDocumentMenu"
                      @keydown="documentMenuTriggerKeydown"
                    >
                      <MoreHorizontal :size="19" />
                    </button>
                    <div
                      v-if="menu && pane.id === store.activePaneId"
                      ref="documentMenuElement"
                      class="dropdown compact-action-menu document-dropdown"
                      @keydown="documentMenuKeydown"
                    >
                      <PluginMenu location="document" :file-id="active.id" @selected="menu = false" />
                      <button type="button" @click="openPaneSearch(pane.id)">
                        <Search :size="15" />{{ t('页内搜索') }}<span class="menu-shortcut">{{ shortcutHint('pageSearch') }}</span>
                      </button>
                      <button type="button" @click="openPaneSearch(pane.id, true)">
                        <Repeat2 :size="15" />{{ t('查找与替换') }}<span class="menu-shortcut">{{ shortcutHint('pageReplace') }}</span>
                      </button>
                      <button
                        type="button"
                        :disabled="editorReadonly || !documentUndoAvailable"
                        @click="undoDocument"
                      >
                        <Undo2 :size="15" />{{ t('撤销') }}<span class="menu-shortcut">Ctrl Z</span>
                      </button>
                      <button
                        type="button"
                        :disabled="editorReadonly || !documentRedoAvailable"
                        @click="redoDocument"
                      >
                        <Redo2 :size="15" />{{ t('重做') }}<span class="menu-shortcut">Ctrl Y</span>
                      </button>
                      <button
                        @click="
                          menu = false;
                          store.flush();
                        "
                      >
                        <CheckCheck :size="15" />{{ t('立即保存') }}<span class="menu-shortcut">{{ shortcutHint('save') }}</span>
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button type="button" :disabled="!canAddDocumentProperty" @click="addDocumentProperty">
                        <Plus :size="15" />{{ t('添加文档属性') }}
                      </button>
                      <button type="button"
                        :disabled="editorReadonly || !!editing.active || editing.activeBusy || !paneComments.has(store.activePaneId)"
                        @click="openDocumentDiscussion">
                        <MessageSquare :size="15" />{{ t('发起讨论') }}
                      </button>
                      <button type="button"
                        :disabled="suggestionModeBusy || (!documentSuggestions.get(active.id)?.mode && (paneReadonly(active) || editing.isManaging(active.id) || editing.activeBusy)) || documentSuggestions.get(active.id)?.loading || documentSuggestions.get(active.id)?.reviewing"
                        @click="toggleSuggestionMode(active.id)">
                        <MessageSquareDiff :size="15" />{{ documentSuggestions.get(active.id)?.mode ? t('退出建议模式') : t('建议编辑') }}
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        :aria-expanded="referenceGraphOpened"
                        @click="showReferenceGraph(pane.id, active!)"
                      >
                        <GitFork :size="15" />{{ t('查看关系图谱') }}
                      </button>
                      <button
                        type="button"
                        class="page-toggle-menu-item"
                        role="switch"
                        :aria-checked="!limitPageWidth"
                        :disabled="!pageWidthWritable"
                        :data-tooltip="t('切换页面内容宽度')"
                        @click="setLimitPageWidth(!limitPageWidth)"
                      >
                        <MoveHorizontal :size="15" />{{ t('全宽') }}<span
                          class="menu-switch"
                          :class="{ on: !limitPageWidth }"
                          aria-hidden="true"
                          ><span
                        /></span>
                      </button>
                      <button
                        type="button"
                        class="page-toggle-menu-item"
                        role="switch"
                        :aria-checked="pageLocked"
                        :data-tooltip="pageLocked ? t('退出阅读模式') : t('锁定后进入阅读模式')"
                        @click="togglePageLock"
                      >
                        <LockKeyhole :size="15" />{{ t('锁定页面') }}<span
                          class="menu-switch"
                          :class="{ on: pageLocked }"
                          aria-hidden="true"
                          ><span
                        /></span>
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button
                        @click="
                          menu = false;
                          historyPage = 'versions';
                          historyPanel = true;
                        "
                      >
                        <Archive :size="15" />{{ t('版本历史') }}<span class="menu-beta">Beta</span>
                      </button>
                      <button
                        @click="
                          menu = false;
                          historyPage = 'updates';
                          historyPanel = true;
                        "
                      >
                        <Clock3 :size="15" />{{ t('更新历史') }}
                      </button>
                      <DocumentExportMenu :disabled="exportBusy" @select="exportDocument" />
                      <div class="menu-divider" role="separator" />
                      <button
                        class="danger-text"
                        :disabled="
                          editorReadonly ||
                          sessionBlocksFileMutation(pane.activeId) ||
                          (pane.id === store.activePaneId && editing.activeBusy)
                        "
                        @click="removeDocument()"
                      >
                        <Trash2 :size="15" />{{
                          store.isDemo
                            ? t('删除演示文档')
                            : store.isWeb
                              ? t('删除在线文档')
                              : t('移入回收站')
                        }}
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </ButtonVisibilityGroup>
            <KeepAlive v-if="pane.tabs.includes(GRAPH_TAB_ID)">
              <RelationGraph
                v-if="workspace && pane.activeId === GRAPH_TAB_ID"
                :key="`${workspace.id}:${workspace.path}`"
                :open-in-new-tab="tabsEnabled"
                :controls-target="detachedWindow ? undefined : `#graph-controls-${pane.id}`"
              />
            </KeepAlive>

            <div v-if="workspace && isTableTab(pane.activeId)" class="data-table-assistant-page">
              <DataTablePage
                :key="`${workspace.id}:${pane.activeId}`"
                :table-id="tableFileId(pane.activeId)"
                :touch-layout="touchLayout"
                :comment-author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
                :controls-target="detachedWindow ? undefined : `#data-table-controls-${pane.id}`"
              />
              <AssistantLauncher
                v-if="assistant.available && !assistant.opened"
                :scope="paneButterflyScope(pane.id, pane.activeId)"
                :context-label="t('聊聊这张数据表')"
                :busy="assistant.busy || assistant.applying"
                @open="openAssistant(pane.id, pane.activeId, { forcePanel: true })"
              />
            </div>
            <WorkspaceViewPage
              v-if="workspace && tab?.workspaceView && pane.activeId === tab.id"
              :key="`${workspace.id}:${tab.workspaceView.view.id}:${tab.workspaceView.view.database || tab.workspaceView.view.objectDatabase ? '' : tab.workspaceView.snapshot.hash}`"
              :view="tab.workspaceView.view"
              @open-file="(file) => { store.focusPane(pane.id); void openWorkspaceViewSourceFile(file); }"
              @edit-document-properties="async (file) => { store.focusPane(pane.id); await openWorkspaceViewSourceFile(file); showDocumentProperties = true; setPaneSource(file.id, false); }"
              @open-object="(identity) => { store.focusPane(pane.id); openWorkspaceViewSourceObject(identity); }"
            />
            <CalendarView
              v-if="workspace && pane.activeId === CALENDAR_TAB_ID"
              :date="calendarDate"
              :mode="calendarMode"
              :records="plans.recordsFor(calendarScope)"
              @select-mode="selectCalendarMode"
              @visible-month="calendarDate = $event"
              @visible-year="calendarDate = $event"
              @visible-timeline="calendarDate = $event"
              @select-date="showCalendarDay"
              @select-month="showCalendarMonth"
              @select-event="showPlanEvent"
            />

            <main v-if="pane.activeId === ASSISTANT_TAB_ID" class="assistant-page-placeholder"><button @click="openAssistantPage(store, assistant)">{{ t('打开助手') }}</button></main>
            <template v-for="view in extensionViews" :key="view.id">
              <component
                v-if="pane.activeId === view.id"
                :is="view.component"
                :actions="viewActions[view.id]"
              />
            </template>

            <div v-if="pane.activeId === SETTINGS_TAB_ID" :id="`settings-host-${pane.id}`" class="settings-tab-host" />
            <PluginView v-if="tab?.pluginView" :view-key="tab.pluginView.key" />
            <main
              v-if="workspace && pane.tabs.includes(PLUGINS_TAB_ID)"
              v-show="pane.activeId === PLUGINS_TAB_ID"
              class="plugins-tab-page"
            >
              <div class="plugins-tab-content">
                <p v-if="!store.capabilities.features.objectReferences" class="tool-level-notice">
                  {{ t('Level 2 已关闭，插件对象和关系暂时只读。可在工作区设置中重新启用。') }}
                </p>
                <p v-else-if="workspace.readOnly" class="tool-level-notice">
                  {{ t('此工作区为只读，无法修改对象和关系。') }}
                </p>
                <PluginInstaller @objects="showObjects()">
                  <template v-if="extensions.regions['plugin-publishing']" #publishing>
                    <component :is="extensions.regions['plugin-publishing']" :actions="extensionActions" />
                  </template>
                </PluginInstaller>
              </div>
            </main>

            <template v-if="active">
              <PageSearch
                :shortcuts="shortcuts"
                :key="`search:${active.id}`"
                :ref="(el) => setPaneSearch(pane.id, el)"
                :editor="
                  paneSource(pane.activeId)
                    ? paneSourceEditors.get(pane.id)
                    : paneEditors.get(pane.id)
                "
                :content="active.content"
                :readonly="paneReadonly(active!)"
                :revision="paneSearchRevisions[pane.id]"
              />
              <div :key="active.id" class="document-scroll-shell" :class="{ 'has-assistant-launcher': assistant.available }">
                <div
                  :id="`document-scroll-${pane.id}`"
                  :ref="(el) => setPaneElement('scroll', pane.id, el)"
                  class="document-layout"
                  :data-toolbar-dock="
                    pane.id === store.activePaneId &&
                    !paneSource(pane.activeId) &&
                    !paneReadonly(active!)
                      ? toolbarMode
                      : undefined
                  "
                  @scroll.passive="scheduleActiveHeading"
                >
                  <main class="document-main">
                    <EditorTools
                      :shortcuts="shortcuts"
                      v-model:mode="toolbarMode"
                      :assistant="assistant.available"
                        :assistant-disabled="assistantTaskActive()"
                      @assistant="openAssistant(pane.id, active!.id)"
                      annotation
                      :todo="
                        store.capabilities.features.objectReferences &&
                        !paneReadonly(active!) &&
                        !editing.isManaging(active!.id)
                      "
                      @todo="beginSelectionTodo(pane.id, active!.id)"
                      @annotation="paneComments.get(pane.id)?.beginAnnotation()"
                      :active="pane.id === store.activePaneId"
                      :editor-element="paneEditorScrolls.get(pane.id)"
                      :features="store.capabilities.features"
                      :context="paneSelections[pane.id] ?? defaultSelectionContext"
                      :source="paneSource(pane.activeId)"
                      :disabled="paneReadonly(active!)"
                      @command="(name, value) => paneEditors.get(pane.id)?.command(name, value)"
                    >
                      <template v-if="detachedWindow || showSourceTodo(pane.id, active!)" #trailing>
                        <button
                          v-if="showSourceTodo(pane.id, active!)"
                          type="button"
                          class="icon-button"
                          :aria-label="t('从选区创建任务或事件')"
                          :data-tooltip="t('从选区创建任务或事件')"
                          @mousedown.prevent
                          @click="beginSelectionTodo(pane.id, active!.id)"
                        >
                          <ListTodo :size="17" />
                        </button>
                        <ButtonVisibilityGroup
                          v-if="detachedWindow"
                          v-slot="{ isVisible }"
                          :items="documentToolItems"
                          preference-key="tano.preference.documentHiddenTools"
                          group-class="detached-editor-actions document-tool-buttons"
                          :label="t('文档工具')"
                          :menu-label="t('文档工具按钮显示设置')"
                          @open="closeButtonVisibilityMenus"
                        >
                          <MarkdownRevealToggle
                            v-if="isVisible('markdown-reveal')"
                            v-model="revealMarkdown"
                            :source="paneSource(pane.activeId)"
                          />
                          <button
                            v-if="isVisible('source-mode')"
                            type="button"
                            class="icon-button"
                            :class="{ active: paneSource(pane.activeId) }"
                            :disabled="!!editing.active || editing.activeBusy"
                            :aria-label="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
                            :aria-pressed="paneSource(pane.activeId)"
                            :data-tooltip="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
                            @click="setPaneSource(pane.activeId, !paneSource(pane.activeId))"
                          >
                            <Code2 :size="17" />
                          </button>
                        </ButtonVisibilityGroup>
                      </template>
                    </EditorTools>

                    <component
                      :is="extensions.regions['editing-panel']"
                      v-if="pane.id === store.activePaneId && extensions.regions['editing-panel']"
                      :actions="extensionActions"
                    />
                    <p v-if="active.creating && !active.error" class="creation-status" role="status">
                      {{ t('正在创建… 可以继续编辑') }}
                    </p>
                    <div v-if="active.conflict" class="conflict-banner" role="alert">
                      <AlertTriangle :size="19" />
                      <div>
                        <strong>{{ t('这一页有两份新的想法') }}</strong>
                        <p>
                          {{ t('外部修改与你的修改重叠。你的内容已保存为 conflict 副本，原文件保留外部版本。') }}
                        </p>
                        <button @click="store.resolveConflict(active!, true)">
                          {{ t('打开我的副本') }} <ArrowUpRight :size="14" /></button
                        ><button @click="store.resolveConflict(active!, false)">
                          {{ t('载入磁盘版本') }}
                        </button>
                        <button
                          @click="
                            selectedDiff = {
                              title: active.path,
                              before: active.conflict.disk.content,
                              after: active.content,
                              beforeLabel: t('磁盘版本'),
                              afterLabel: t('我的副本'),
                            }
                          "
                        >
                          {{ t('比较两个版本') }}
                        </button>
                      </div>
                    </div>
                    <div
                      v-else-if="active.missing || active.error"
                      class="conflict-banner"
                      role="alert"
                    >
                      <AlertTriangle :size="19" />
                      <div>
                        <strong>{{
                          active.missing ? t('文件已在工作文件夹中移除') : active.creating ? t('文档尚未创建成功') : t('这次保存没有完成')
                        }}</strong>
                        <p>
                          {{
                            active.error ?? t('编辑器中的内容仍然保留，你可以把它另存为一个新文档。')
                          }}
                        </p>
                        <button @click="showModal('saveAs')">
                          {{ t('另存副本') }} <ArrowUpRight :size="14" /></button
                        ><button v-if="!active.missing" @click="store.flush()">{{ t('重试保存') }}</button>
                      </div>
                    </div>
                    <div
                      :ref="(el) => setPaneElement('editor', pane.id, el)"
                      class="editor-scroll"
                      :style="{
                        '--tano-prose-font-family': selectedVisualFontFamily,
                        '--tano-prose-font-size': `${visualFontSize}px`,
                        '--tano-source-font-size': `${sourceFontSize}px`,
                      }"
                      :class="{
                        'source-view': paneSource(pane.activeId),
                        'conflicted-editor': active.conflict,
                        'width-unlimited': !limitPageWidth,
                      }"
                      tabindex="-1"
                      @mousedown.self="
                        !paneSource(pane.activeId) &&
                        paneEditors.get(pane.id)?.focusTrailingParagraph($event)
                      "
                      @contextmenu="openPageContextMenu"
                    >
                      <DocumentSuggestions v-slot="suggestions" :document="active" :readonly="paneReadonly(active!)"
                        :source="paneSource(pane.activeId)"
                        :managed="!!editing.active" :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }">
                      <DocumentTitle
                        v-if="workspace && showPageTitle"
                        :key="`${workspace.id}:${active.id}`"
                        :workspace-id="workspace.id"
                        :document-id="active.id"
                        :path="store.displayPath(active)"
                        :title-source="store.workspaceSettings.pageTitleSource"
                        :model-value="suggestions.content"
                        :files="workspace.files"
                        :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                        :resolve-image="(reference) => attachments ? attachments.imageUrl(workspace, active!.path, reference) : safeRemoteImage(reference)"
                        :upload-cover="attachments && !store.isDemo ? (file) => uploadFile(file, true, active) : undefined"
                        :resource-revision="resourceRevision"
                        :readonly="
                          suggestions.readonly ||
                          suggestions.suggesting ||
                          active.missing ||
                          sessionBlocksFileMutation(active.id) ||
                          editing.activeBusy
                        "
                        :rename="renameDocumentTitle"
                        @update:model-value="suggestions.edit($event)"
                        @enter="insertBlockBelowTitle"
                        @comment="paneComments.get(pane.id)?.showDiscussion()"
                      />
                      <SourceEditor :preferences="editorPreferences" :suggestion-marks="suggestions.sourceMarks"
                        :show-all-line-numbers="showAllLineNumbers"
                        v-if="paneSource(pane.activeId)"
                        :key="active.id"
                        :content-revision="suggestions.viewKey"
                        :ref="(el) => setPaneElement('source', pane.id, el)"
                        :model-value="suggestions.content"
                        :readonly="suggestions.readonly"
                        :local-native="!!attachments && !suggestions.suggesting"
                        :comment-anchors="commentAnchors[active.id]"
                        @ready="paneEditorReady(pane.id, active!.id, true)"
                        @selection-change="paneSourceSelections[pane.id] = $event"
                        @update:model-value="suggestions.edit($event)"
                        @files="
                          (files, requireImage, position) =>
                            insertSourceFiles(files, position, requireImage, active, pane.id)
                        "
                      />
                      <MarkdownEditor :suggestion-marks="suggestions.richMarks" :transform-change="suggestions.transformChange"
                        v-else
                        :custom-callout-icon="CalloutIconPicker"
                        :content-revision="suggestions.viewKey"
                        :key="`${active.id}:${active.id === store.active?.id ? (editing.active?.key ?? 'local') : 'local'}`"
                        :ref="(el) => setPaneEditor(pane.id, el)"
                        :document-id="active.id"
                        :readonly="suggestions.readonly"
                        :open-links-on-tap="touchLayout"
                        :reveal-markdown="suggestions.suggesting ? false : revealMarkdown"
                        :show-document-properties="showDocumentProperties"
                        :capabilities="store.capabilities"
                        :reference-targets="store.referenceTargets"
                        :preferences="editorPreferences"
                        :extension="
                          active.id === store.active?.id ? editing.active?.extension : undefined
                        "
                        :model-value="suggestions.content"
                        :table-layouts="active.tableLayout?.file.tables"
                        :comment-anchors="commentAnchors[active.id]"
                        :resolve-image="
                          (reference) =>
                            attachments
                              ? attachments.imageUrl(workspace, active!.path, reference)
                              : safeRemoteImage(reference)
                        "
                        :resource-revision="resourceRevision"
                        :import-file="
                          attachments && !suggestions.suggesting ? (file, image) => uploadFile(file, image, active) : undefined
                        "
                        @update:model-value="suggestions.edit($event)"
                        @table-layout-change="!suggestions.suggesting && store.editTableLayout(active!.id, $event)"
                        @error="store.report"
                        @ready="paneEditorReady(pane.id, active!.id, false)"
                        @search-change="
                          paneSearchRevisions[pane.id] = (paneSearchRevisions[pane.id] ?? 0) + 1
                        "
                        @open-link="
                          (reference, newTab) => openDocumentLink(reference, newTab, active!.path)
                        "
                        @open-wiki-link="openWikiLink"
                        @open-reference="openReference"
                        @edit-source="setPaneSource(pane.activeId, true)"
                        @selection-change="paneSelections[pane.id] = $event"
                        @blank-block-ai="openBlankBlockAssistant(pane.id, active!.id)"
                      >
                        <template v-if="!suggestions.suggesting && !active.missing && !active.conflict && !active.error" #empty-document>
                          <DocumentStarter :assistant="assistant.available" :assistant-busy="assistant.busy || assistant.applying || assistant.loading"
                            @draft="startDocumentDraft(pane.id, active!.id)"
                            @initialize="quickInitialize(pane.id, active!.id, $event)"
                            @template="chooseInitialTemplate(pane.id, active!.id)" />
                        </template>
                      </MarkdownEditor>
                      <DocumentComments
                        v-if="workspace"
                        v-model:discussion-visible="showDocumentDiscussion"
                        :ref="(el) => setPaneComments(pane.id, el)"
                        :workspace-id="workspace.id"
                        :document="active"
                        :assistant="assistant.available"
                        @assistant="discussWithAssistant(pane.id, active!.id, $event)"
                        :readonly="suggestions.readonly"
                        :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
                        :capture-selection="() => capturePaneCommentSelection(pane.id, active!.id)"
                        :focus-anchor="(anchor) => focusPaneComment(pane.id, active!.id, anchor)"
                        :editor-element="paneEditorScrolls.get(pane.id)"
                        :geometry="(anchors) => paneCommentGeometry(pane.id, active!.id, anchors)"
                        @annotations="commentAnchors[active!.id] = $event"
                      />
                      </DocumentSuggestions>
                    </div>
                  </main>
                </div>
                <DocumentScrollbar v-if="!touchLayout" :scroll-element="paneScrolls.get(pane.id)" />
                <AssistantLauncher
                  v-if="assistant.available && !assistant.opened"
                  :scope="paneButterflyScope(pane.id, active!.id)"
                  :busy="assistant.busy || assistant.applying"
                  @open="openAssistant(pane.id, active!.id, { forcePanel: true })"
                />
              </div>
            </template>

            <AttachmentPreview
              v-else-if="workspace && pane.activeId.startsWith('attachment:')"
              :file="tab?.attachment"
              :workspace-id="workspace.id"
              :url="
                attachments && tab?.attachment
                  ? attachments.imageUrl(
                      workspace,
                      '',
                      relativeWorkspaceReference('', tab.attachment.path),
                    )
                  : null
              "
            />
            <main
              v-else-if="
                workspace &&
                pane.activeId !== GRAPH_TAB_ID &&
                pane.activeId !== PLUGINS_TAB_ID &&
                pane.activeId !== CALENDAR_TAB_ID &&
                pane.activeId !== SETTINGS_TAB_ID &&
                !isTableTab(pane.activeId) &&
                !tab?.workspaceView &&
                !tab?.pluginView &&
                !extensionViews.find((view) => view.id === pane.activeId)
              "
              class="workspace-no-tabs"
            >
              <LoadingSkeleton v-if="busy || startupPending" variant="document" :rows="10" />
              <EmptyEditor v-else
                :create-disabled="busy || workspace.readOnly || updateLock"
                @create="createNewDocument"
                @open="showModal('newTab')"
                @search="showModal('search')"
              />
            </main>

            <aside
              v-if="
                active &&
                !(assistant.opened && assistant.displayMode === 'sidebar') &&
                !detachedWindow &&
                pane.id === store.activePaneId &&
                (panel !== 'outline' || (showOutline && (!touchLayout || touchOutlineOpen)))
              "
              class="inspector"
              :style="panel === 'outline' ? outlinePosition : undefined"
              :class="{
                'inspector-outline': panel === 'outline',
                'inspector-outline-left': panel === 'outline' && outlineOnLeft,
                'inspector-hover-outline':
                  panel === 'outline' && !touchLayout && hoverOutline && !outlinePinned && !outlineSearchOpen,
                'inspector-activity': panel === 'activity',
              }"
              :aria-label="panel === 'outline' ? t('文档目录') : t('文档动态')"
              @contextmenu="openOutlineContextMenu"
            >
              <div class="inspector-surface">
                <div v-if="panel === 'activity'" class="inspector-tabs">
                  <button @click="panel = 'outline'"><List :size="14" />{{ t('大纲') }}</button
                  ><button class="active" @click="panel = 'activity'">
                    <History :size="14" />{{ t('动态') }}
                  </button>
                </div>
                <div v-if="panel === 'outline'" class="outline-controls">
                  <span>{{ t('文档大纲') }}</span>
                  <button v-if="touchLayout" type="button" class="outline-control" :aria-label="t('关闭文档大纲')"
                    @click="touchOutlineOpen = false"><X :size="18" /></button>
                  <button
                    class="outline-control"
                    type="button"
                    :aria-label="t('搜索大纲标题')"
                    :data-tooltip="t('搜索大纲标题')"
                    :aria-expanded="outlineSearchOpen"
                    @click="toggleOutlineSearch"
                  >
                    <Search :size="15" />
                  </button>
                  <button
                    v-if="hoverOutline"
                    class="outline-control"
                    :class="{ active: outlinePinned }"
                    type="button"
                    :aria-label="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
                    :data-tooltip="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
                    :aria-pressed="outlinePinned"
                    @click="toggleOutlinePin"
                  >
                    <Pin :size="15" :fill="outlinePinned ? 'currentColor' : 'none'" />
                  </button>
                </div>
                <div v-if="panel === 'outline' && outlineSearchOpen" class="outline-search">
                  <Search :size="14" aria-hidden="true" />
                  <input
                    ref="outlineSearchInput"
                    v-model="outlineSearch"
                    type="search"
                    :aria-label="t('搜索当前文档标题')"
                    :placeholder="t('搜索标题')"
                    autocomplete="off"
                    @keydown.enter="visibleOutline[0] && jumpToHeading(visibleOutline[0].index, true)"
                    @keydown.esc.stop.prevent="toggleOutlineSearch"
                  />
                </div>
                <nav v-if="panel === 'outline'" class="outline" :aria-label="t('文档大纲')">
                  <button
                    v-for="{ heading, index } in visibleOutline"
                    :key="index"
                    :class="{
                      'outline-active': activeHeading === index,
                    }"
                    :style="{
                      '--outline-indent': `${Math.max(0, heading.level - 1) * 12}px`,
                      '--outline-marker-width': `${Math.max(9, 20 - heading.level * 2)}px`,
                    }"
                    :aria-label="t('跳转到{0}', [heading.text])"
                    :aria-current="activeHeading === index ? 'location' : undefined"
                    @click="jumpToHeading(index, true)"
                  >
                    <span class="outline-marker" aria-hidden="true" />
                    <span class="outline-text">{{ heading.text }}</span>
                  </button>
                  <p v-if="!outline.length" class="panel-empty">
                    <span class="outline-empty-marker" aria-hidden="true" />
                    {{ t('写下一个标题，') }}<br />{{ t('让思路有迹可循。') }}
                  </p>
                  <p v-else-if="!visibleOutline.length" class="outline-no-results" role="status">
                    {{ t('没有匹配的标题') }}
                  </p>
                </nav>
                <div v-else class="activity-list">
                  <p class="activity-explainer">{{ t('这个会话中的文件变化。外部编辑者身份暂不可识别。') }}</p>
                  <button v-if="localNative" class="secondary-button" @click="agentPanel = true">
                    <Bot :size="14" />{{ t('工作区指引与 MCP 活动') }}
                  </button>
                  <div v-for="item in activities" :key="item.id" class="activity-item">
                    <span class="activity-icon" :class="item.kind"
                      ><component
                        :is="
                          item.kind === 'conflict'
                            ? AlertTriangle
                            : item.kind === 'external'
                              ? RefreshCw
                              : item.kind === 'save'
                                ? Check
                                : FileText
                        "
                        :size="13"
                    /></span>
                    <div>
                      <strong>{{ item.label }}</strong>
                      <p>{{ item.detail }}</p>
                      <button
                        v-if="item.change"
                        class="activity-diff-button"
                        @click="selectedDiff = { title: item.detail, ...item.change }"
                      >
                        {{ t('查看差异') }}
                      </button>
                      <time>{{
                        new Date(item.time).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      }}</time>
                    </div>
                  </div>
                </div>
                <div v-if="panel === 'activity'" class="inspector-footer">
                  <span class="live-dot" />{{
                    store.isDemo
                      ? t('浏览器本地存储')
                      : store.isWeb
                        ? t('定期检查服务器修改')
                        : t('正在监听工作文件夹')
                  }}
                </div>
              </div>
            </aside>
          </div>
        </template>
      </WorkspacePanes>
      <LoadingSkeleton v-else-if="startupPending" variant="shell" />
      <component
        :is="extensions.regions['workspace-dashboard']"
        v-else-if="extensions.regions['workspace-dashboard']"
        :actions="extensionActions"
      />
      <WorkspaceDashboard
        v-else
        :workspaces="store.recent.map(item => ({ ...item, source: store.isDemo ? 'demo' as const : store.isWeb ? 'cloud' as const : 'local' as const }))"
        :busy="busy"
        :demo="store.isDemo"
        @open="store.openWorkspace($event.path)"
        @settings="openSettings()"
      >
        <template #actions>
          <button class="primary-button" :disabled="busy" @click="store.isWeb || mobile ? createNewWorkspace() : store.openWorkspace()">
            <Plus :size="17" />{{ store.isWeb || mobile ? t('创建工作区') : store.isDemo ? t('打开演示工作区') : t('打开文件夹') }}
          </button>
          <component :is="extensions.regions['welcome-login']" v-if="extensions.regions['welcome-login']" :actions="extensionActions" />
        </template>
      </WorkspaceDashboard>
      <InlineAssistantInput
        v-if="inlineAssistant"
        :anchor="inlineAssistant.anchor"
        v-model:value="inlineAssistantPrompt"
        :state="inlineAssistantState"
        :progress="inlineRunner.applying ? t('正在处理修改') : inlineRunner.progress"
        :error="inlineAssistantError"
        :message="inlineAssistantMessage"
        :placeholder="inlineAssistant.blankBlock ? t('描述你想生成的内容…') : undefined"
        @submit="submitInlineAssistant"
        @stop="inlineRunner.stop()"
        @conversation="continueInlineConversation"
        @undo="undoInlineAssistant"
        @close="closeInlineAssistant"
      />

      <Teleport to="body">
        <div
          v-if="pageContextMenu"
          ref="pageContextMenuElement"
          class="dropdown compact-action-menu page-context-menu"
          role="menu"
          :aria-label="t('页面显示选项')"
          :style="{ left: `${pageContextMenu.x}px`, top: `${pageContextMenu.y}px` }"
          @keydown="pageContextKeydown"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="editorPreferences.autoSpacing ?? false"
            @click="togglePageOption('autoSpacing')"
          >
            <Space :size="15" />{{ t('正文自动间距') }}<Check
              v-if="editorPreferences.autoSpacing"
              class="page-context-check"
              :size="14"
            />
          </button>
          <div class="menu-divider" role="separator" />
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="showPageTitle"
            @click="togglePageOption('title')"
          >
            <Heading1 :size="15" />{{ t('页面内标题') }}<Check
              v-if="showPageTitle"
              class="page-context-check"
              :size="14"
            />
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="showDocumentProperties"
            @click="togglePageOption('properties')"
          >
            <SlidersHorizontal :size="15" />{{ t('文档属性') }}<Check
              v-if="showDocumentProperties"
              class="page-context-check"
              :size="14"
            />
          </button>
          <button
            v-if="!detachedWindow"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="showOutline"
            @click="togglePageOption('outline')"
          >
            <List :size="15" />{{ t('显示目录') }}<Check
              v-if="showOutline"
              class="page-context-check"
              :size="14"
            />
          </button>
          <button
            v-if="paneSource(store.activeId)"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="showAllLineNumbers"
            @click="togglePageOption('lineNumbers')"
          >
            <ListOrdered :size="15" />{{ t('显示所有行号') }}<Check
              v-if="showAllLineNumbers"
              class="page-context-check"
              :size="14"
            />
          </button>
        </div>
      </Teleport>
      <Teleport to="body">
        <div
          v-if="outlineContextMenu"
          ref="outlineContextMenuElement"
          class="dropdown compact-action-menu page-context-menu outline-context-menu"
          role="menu"
          :aria-label="t('目录显示选项')"
          tabindex="-1"
          :style="{ left: `${outlineContextMenu.x}px`, top: `${outlineContextMenu.y}px` }"
          @keydown="outlineContextKeydown"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="outlineOnLeft"
            @click="toggleOutlineSide"
          >
            <PanelLeftOpen :size="15" />{{ t('显示在左侧') }}<Check
              v-if="outlineOnLeft"
              class="page-context-check"
              :size="14"
            />
          </button>
        </div>
      </Teleport>
    </div>

    <ImportPanel
      v-if="importPanel && workspace"
      :key="workspace.id"
      :attachments="attachments"
      :records="importRecords"
      @close="importPanel = false"
      @completed="importRecords.unshift($event)"
    />
    <WorkspaceSyncPanel v-if="systemSyncPanel && workspace" :workspace-id="workspace.id" :controller="workspaceSync" :cloud="extensions.sync" @close="systemSyncPanel = false" />
    <component
      :is="extensions.regions['sync-dialog']"
      v-if="extensions.regions['sync-dialog']"
      :actions="extensionActions"
    />
    <MobileRecycle
      v-if="mobile && recyclePanel && workspace"
      :workspace-id="workspace.id"
      @close="recyclePanel = false"
    />
    <AgentPanel
      v-if="agentPanel && workspace"
      :workspace-id="workspace.id"
      @close="agentPanel = false"
    />
    <DiffDialog v-if="selectedDiff" v-bind="selectedDiff" @close="selectedDiff = undefined" />
    <component
      :is="extensions.regions['history-dialog']"
      v-if="extensions.regions['history-dialog']"
      :actions="extensionActions"
    />
    <DocumentHistoryPanel
      v-if="historyPanel && active && workspace"
      :key="active.id"
      :local-id="active.id"
      :path="active.path"
      :workspace-id="workspace.id"
      :activities="activities"
      :history-view="extensions.historyEnabled ? extensions.historyView : undefined"
      :initial-page="historyPage"
      @close="historyPanel = false"
      @diff="
        historyPanel = false;
        selectedDiff = $event;
      "
    />
    <input ref="assetInput" type="file" multiple hidden @change="importObjectAssets" />
    <ObjectPanel
      v-if="objectPanelMounted"
      v-show="objectPanel"
      :open="objectPanel"
      :selected-id="selectedObjectId"
      :selected-identity="selectedResourceIdentity"
      :personal="selectedPersonal ? plans.panel : undefined"
      :can-open-asset="!!attachments"
      :can-import-asset="!!attachments && !assetImportBusy"
      :preview-asset="assetPreview"
      @close="objectPanel = false"
      @open-resource="openObjectResource"
      @open-reference="openObjectReference"
      @create-document="
        objectPanel = false;
        createNewDocument();
      "
      @import-asset="assetInput?.click()"
    />
    <PlanDetailPanel
      v-if="planDetail"
      :key="`${planDetail.source?.scope}:${planDetail.source?.id}:${planDetail.object.id}`"
      :record="planDetail"
      @close="planDetail = undefined"
      @open-reference="openPlanReference"
      @open-record="planDetail = $event"
    />
    <SelectionTodoDialog
      v-if="selectionTodo"
      :session="selectionTodo"
      @close="selectionTodo = undefined"
      @open-task="
        selectionTodo = undefined;
        showPlanEvent($event);
      "
    />
    <template v-for="view in extensionViews" :key="view.id">
      <component
        :is="view.overlay"
        v-if="workspace && view.overlay"
        :actions="viewActions[view.id]"
      />
    </template>
    <CommandPalette v-if="commandPaletteOpened && workspace" :commands="workbenchCommands" @close="commandPaletteOpened = false" />
    <Teleport v-for="host in settingsHosts" :key="host" :to="host === 'modal' ? 'body' : `#settings-host-${host}`" :disabled="host === 'modal'" defer>
    <SettingsPanel
      :tabbed="host !== 'modal'"
      :can-open-tab="tabsEnabled && !!workspace"
      @open-tab="openSettingsTab"
      @page-change="settingsPage = $event"
      :workspace="workspace"
      :extra-pages="extensions.settingsPages"
      :plugin-pages="store.pluginSettingsPages"
      :execute-plugin="store.interactWithPlugin"
      :workspace-settings="store.workspaceSettings"
      :workspace-pages="settingsSnapshot.workspacePages"
      :workspace-settings-error="store.workspaceSettingsError"
      :workspace-settings-saving="store.workspaceSettingsSaving"
      :workspace-exporting="workspaceExporting"
      :workspace-export-error="workspaceExportError"
      :workspace-deletion-supported="settingsSnapshot.workspaceDeletionSupported"
      :workspace-deleting="settingsSnapshot.workspaceDeleting"
      :workspace-deletion-error="workspaceDeletionError"
      @workspace-delete="deleteWorkspace"
      @workspace-setting="store.updateWorkspaceSettings"
      @workspace-settings-reload="store.reloadWorkspaceSettings"
      @workspace-export="exportWorkspace"
      :active-file="settingsSnapshot.activeFile"
      :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
      :native="native"
      :mobile="mobile"
      :default-source="defaultSource"
      :theme="theme"
      :visual-font-choice="visualFontChoice"
      :custom-font-name="customFontName"
      :reveal-markdown="revealMarkdown"
      :toolbar-mode="toolbarMode"
      :shortcuts="shortcuts"
      :show-page-title="showPageTitle"
      :show-document-properties="showDocumentProperties"
      :show-document-discussion="showDocumentDiscussion"
      :show-outline="showOutline"
      :outline-on-left="outlineOnLeft"
      :visual-font-size="visualFontSize"
      :source-font-size="sourceFontSize"
      :history-enabled="!!extensions.historyEnabled"
      :capabilities="store.capabilities"
      :version="updates.state.status?.currentVersion ?? appVersion"
      :initial-page="settingsPage"
      :editor-preferences="editorPreferences"
      :capability-error="store.capabilityError"
      :capability-saving="store.capabilitySaving"
      @capability="store.updateCapabilities"
      @assistant-changed="assistant.reloadConnections"
      @update:editor-preferences="editorPreferences = $event"
      @close="settingsPanel = false"
      @update:default-source="defaultSource = $event"
      @update:theme="theme = $event"
      @update:visual-font-choice="visualFontChoice = $event"
      @update:custom-font-name="customFontName = $event"
      @update:reveal-markdown="revealMarkdown = $event"
      @update:toolbar-mode="toolbarMode = $event"
      @update:shortcuts="shortcuts = $event"
      @update:show-page-title="showPageTitle = $event"
      @update:show-document-properties="showDocumentProperties = $event"
      @update:show-document-discussion="showDocumentDiscussion = $event"
      @update:show-outline="showOutline = $event"
      @update:outline-on-left="outlineOnLeft = $event"
      @update:visual-font-size="visualFontSize = $event"
      @update:source-font-size="sourceFontSize = $event"
      @action="settingsAction"
    >
      <template #workspace-members-export>
        <component v-if="extensions.regions['workspace-members-export']" :is="extensions.regions['workspace-members-export']" :workspace="workspace" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" />
      </template>
    </SettingsPanel>
    </Teleport>
    <div v-if="store.fileMutationPending" class="file-mutation-status" role="status">{{ t('正在同步更改…') }}</div>
    <div v-if="fatal || store.sessionError" class="error-toast" role="alert">
      <AlertTriangle :size="18" /><span>{{ fatal || store.sessionError }}</span
      ><button v-if="fatal" class="icon-button" :aria-label="t('关闭通知')" @click="fatal = ''">
        <X :size="16" />
      </button>
    </div>

    <NewTabPicker v-if="modal === 'newTab'" @close="modal = ''" @new-document="createNewDocument" @new-table="createNewEntry('table')" />
    <div
      v-if="modal && modal !== 'newTab'"
      class="modal-backdrop"
      :class="{ 'search-backdrop': modal === 'search' }"
      @mousedown.self="!modalBusy && !updateLock && (modal = '')"
    >
      <section
        class="modal"
        :class="{ 'search-modal': modal === 'search' }"
        role="dialog"
        aria-modal="true"
        :aria-label="modalTitle"
      >
        <header v-if="modal !== 'search'">
          <h2>{{ modalTitle }}</h2>
          <button
            class="icon-button"
            :aria-label="t('关闭弹窗')"
            :disabled="modalBusy || updateLock"
            @click="modal = ''"
          >
            <X :size="19" />
          </button>
        </header>
        <template v-if="modal === 'search'"
          ><div class="search-input-wrap">
            <input
              ref="inputEl"
              v-model="input"
              type="text"
              role="searchbox"
              inputmode="search"
              :aria-label="t('搜索文档名称和正文')"
              :placeholder="t('搜索文件名、路径或正文…')"
              @keydown.enter="searchResults[0] && openSearchResult(searchResults[0])"
            /><button type="button" :aria-label="t('关闭搜索')" :data-tooltip="t('关闭搜索')" @click="modal = ''">
              <X :size="18" />
            </button>
          </div>
          <div v-if="input.trim()" class="search-results">
            <button
              v-for="file in searchResults"
              :key="file.id"
              @click="openSearchResult(file)"
            >
              <span class="search-result-breadcrumb"
                ><span class="search-result-location"
                  ><template
                    v-for="(part, index) in searchHighlightParts(searchResultLocation(file.path))"
                    :key="index"
                    ><mark v-if="part.matched">{{ part.text }}</mark
                    ><template v-else>{{ part.text }}</template></template
                  ></span
                ><span aria-hidden="true">›</span
                ><strong
                  ><template
                    v-for="(part, index) in searchHighlightParts(
                      file.name.replace(/\.(md|markdown)$/i, ''),
                    )"
                    :key="index"
                    ><mark v-if="part.matched">{{ part.text }}</mark
                    ><template v-else>{{ part.text }}</template></template
                  ></strong
                ></span
              ><small
                ><template v-for="(part, index) in searchHighlightParts(file.preview)" :key="index"
                  ><mark v-if="part.matched">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ></small
              >
            </button>
            <p v-if="!searchResults.length" class="panel-empty" role="status">
              {{ searching ? t('正在查找…') : searchError || t('没有找到这篇文档，试试其他关键词。') }}
            </p>
          </div></template
        >
        <form v-else @submit.prevent="submitModal">
          <template v-if="modal === 'delete'"
            ><p class="modal-description">
              {{
                store.isDemo
                  ? t('将删除浏览器中的演示文档，此操作无法在应用内撤销。')
                  : store.isWeb
                    ? t('将从在线工作区移除所选文件。服务端按配置保留版本历史。')
                    : mobile
                      ? t('文件将保留在手机回收站。可从工作空间菜单恢复副本。')
                      : t('文件将移入系统回收站，你可以在回收站中恢复。')
              }}
            </p>
            <div class="delete-file">
              <FileText :size="19" />
              <span v-if="modalDeleteEntries.length <= 1">{{
                modalDeleteEntries[0]?.path ?? modalTarget?.path ?? active?.path
              }}</span>
              <span v-else class="delete-file-list">
                <span v-for="file in modalDeleteEntries.slice(0, 6)" :key="file.id">{{
                  file.path
                }}</span>
                <span v-if="modalDeleteEntries.length > 6"
                  >{{ t('还有') }} {{ modalDeleteEntries.length - 6 }} {{ t('项…') }}</span
                >
              </span>
            </div></template
          ><template v-else
            ><p class="modal-description">
              {{
                modal === 'saveAs'
                  ? t('把当前编辑内容保存为独立的 Markdown 文件。')
                  : t('从一个名字开始，把想法留在这一页。')
              }}
            </p>
            <label for="file-name">{{ t('文档路径') }}</label
            ><input
              id="file-name"
              ref="inputEl"
              v-model="input"
              :placeholder="t('例如：我的新想法.md')"
              autocomplete="off"
              maxlength="220"
            />
            <p class="input-hint">
              {{
                store.isWeb
                  ? t('可使用「项目/新想法.md」创建文档及所在目录。')
                  : t('相对于工作空间，可使用已有目录，例如「项目/新想法.md」。')
              }}
            </p></template
          >
          <p v-if="modalError" class="form-error" role="alert">{{ modalError }}</p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="modalBusy"
              @click="modal = ''"
            >
              {{ t('取消') }}</button
            ><button
              class="primary-button"
              :class="{ destructive: modal === 'delete' }"
              :disabled="modalBusy || (modal === 'delete' && !modalDeleteEntries.length)"
            >
              <LoaderCircle v-if="modalBusy" class="spinning" :size="16" />{{
                modalBusy
                  ? t('正在处理…')
                  : modal === 'delete'
                    ? t('确认移除')
                    : t('创建文档')
              }}<ArrowRight v-if="!modalBusy" :size="16" />
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
