<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue';
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
  PanelLeftClose,
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
  CircleHelp,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Pencil,
  Trash2,
  Bot,
  ExternalLink,
  CheckCheck,
  Copy,
  LoaderCircle,
  Paperclip,
  Users,
  Puzzle,
  GitFork,
  CalendarDays,
  Globe2,
  LogOut,
  Settings2,
  SquarePen,
  Pin,
  Ruler,
  Heading1,
  LockKeyhole,
  MoveHorizontal,
  Undo2,
  Redo2,
  ArrowDownToLine,
  Files,
} from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import { defaultEditorPreferences } from '@tano/editor/runtime';
import type { EditorPreferences } from '@tano/editor/runtime';
import { defaultSelectionContext } from '@tano/editor/document-model';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import SourceEditor from './components/SourceEditor.vue';
import EmptyEditor from './components/EmptyEditor.vue';
import MarkdownRevealToggle from './components/MarkdownRevealToggle.vue';
import DocumentTitle from './components/DocumentTitle.vue';
import DocumentExportMenu from './components/DocumentExportMenu.vue';
import type { ImportRecord } from './components/ImportPanel.vue';
const ImportPanel = defineAsyncComponent(() => import('./components/ImportPanel.vue'));
const TemplateDialog = defineAsyncComponent(() => import('./components/TemplateDialog.vue'));
import { downloadExport, exportFilename, renderDocumentExport } from './document-export';
import type { DocumentExportFormat } from './document-export';
import DocumentComments from './components/DocumentComments.vue';
import ReferenceConnections from './components/ReferenceConnections.vue';
import SelectionTodoDialog from './components/SelectionTodoDialog.vue';
import { selectionTodoSession } from './selection-todo';
import type { SelectionTodoSession } from './selection-todo';
import { documentLinks } from '@tano/editor/document-links';
import type { CommentAnchor } from '@tano/protocol';
import { unsupportedMarkdown } from '@tano/editor/syntax';
import {
  basename,
  isMarkdown,
  validatePath,
  isWorkspaceInternalPath,
  resolveWorkspaceReference,
  relativeWorkspaceReference,
  safeRemoteImage,
} from '@tano/protocol';
import type { FileEntry, SearchHit } from '@tano/protocol';
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
const RelationGraph = defineAsyncComponent(() => import('./components/RelationGraph.vue'));
import NewTabPicker from './components/NewTabPicker.vue';
import EditorTools from './components/EditorTools.vue';
import { parseToolbarMode, toolbarPreferenceKey } from './toolbar-preference';
import { parsePageTitleSource } from './page-title-source';
import DocumentHistoryPanel from './components/DocumentHistoryPanel.vue';
import AgentPanel from './components/AgentPanel.vue';
import AssistantPanel from './components/AssistantPanel.vue';
import { useAssistantStore } from './assistant/store';
import DiffDialog from './components/DiffDialog.vue';
import { handleMobileVisibility } from './mobile-lifecycle';
import { useWorkspaceStore } from './stores/workspace';
import { useWorkbenchRuntime, createLocalExtensions } from './runtime';
import type { WorkbenchActions } from './runtime';
import { native } from './adapter';
import { mobile } from './platform';
import MobileRecycle from './components/MobileRecycle.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import ObjectPanel from './components/ObjectPanel.vue';
import PlanDetailPanel from './components/PlanDetailPanel.vue';
import type { ObjectRecord } from './workspace-objects';
import { usePlanStore } from './stores/plans';
import { usePlanSyncStore } from './stores/plan-sync';
import { planKey } from './personal-plans';
import PersonalPlanDialog from './components/PersonalPlanDialog.vue';
import SidebarPlan from './components/SidebarPlan.vue';
import SidebarNavigation from './components/SidebarNavigation.vue';
import WorkspaceSwitcher from './components/WorkspaceSwitcher.vue';
import ButtonVisibilityGroup from './components/ButtonVisibilityGroup.vue';
import CalendarView from './components/CalendarView.vue';
import PluginInstaller from './components/PluginInstaller.vue';
import { isObjectPath, referenceMarkdown, referenceUrl, resolveReference } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import { sloganParts, welcomeSlogans } from './welcome-slogans';
import { useUpdatesStore } from './stores/updates';
import { resolveWikiLink } from './wiki-links';
import { applyFileMovePreview, planFileMovePreview, type FileMovePreview } from './file-move';
import { isSidebarToggleShortcut } from './shortcuts';
import { createDetachedTabWindow, detachedTabRequest, reportDetachedReady } from './detach-tab';
import type { DetachedDropPoint } from './detach-tab';
import { findTabDockTarget, requestTabTransfer, TAB_TRANSFER_REQUEST, TAB_TRANSFER_RESULT, TAB_TRANSFER_ROLLBACK } from './tab-docking';
import type { TabTransferRequest, TabTransferRollback, TabTransferResult } from './tab-docking';
import { selectTreeEntry, topLevelEntries } from './file-selection';
import { isBlankPageTarget } from './page-context-menu';
import { applyTheme, readThemePreference, saveThemePreference } from './theme';
import type { ThemePreference } from './theme';
import { parseVisualFontChoice, sanitizeCustomFontName, visualFontFamily } from './editor-font';
import type { VisualFontChoice } from './editor-font';
import { emitTo, listen } from '@tauri-apps/api/event';
import {
  SETTINGS_COMMAND, SETTINGS_NAVIGATE, SETTINGS_STATE, closeSettingsWindow, openSettingsWindow,
  prewarmSettingsWindow, settingsWindowLabel,
} from './settings-window';
import type { SettingsCommand, SettingsPageId, SettingsSnapshot } from './settings-window';

const store = useWorkspaceStore();
const assistant = useAssistantStore();
const plans = usePlanStore();
usePlanSyncStore();
const personalHome = ref(false);
const detachedWindow = native && !mobile && !!detachedTabRequest();
const welcomeSlogan = welcomeSlogans[Math.floor(Math.random() * welcomeSlogans.length)];
const welcomeSloganParts = sloganParts(welcomeSlogan);
const localNative = native && !store.isWeb;
const attachments = useWorkbenchRuntime().attachments ?? (localNative ? nativeAttachments : undefined);
const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
const extensionViews = extensions.views ?? [];
const sidebarNavigationItems = computed(() => [
  { id: 'repository', label: '仓库' },
  { id: 'plan', label: '计划' },
  ...extensionViews.filter(view => view.sidebar).map(view => ({ id: view.id, label: view.label })),
]);
const documentToolItems = [
  { id: 'markdown-reveal', label: '光标展开源码' },
  { id: 'source-mode', label: '源码模式' },
  { id: 'attachments', label: '附件' },
];
const topbarItems = [
  { id: 'back', label: '后退' },
  { id: 'forward', label: '前进' },
  { id: 'breadcrumb', label: '面包屑' },
  { id: 'workspace-status', label: '工作区状态' },
];
const workspaceStatusLabel = computed(() => store.workspace?.readOnly ? '只读权限'
  : store.isDemo ? '浏览器演示' : store.isWeb ? '在线工作区' : null);
const calendarToolItems = [
  { id: 'calendar-period', label: '日历日期' },
  { id: 'calendar-today', label: '今天' },
  { id: 'calendar-previous', label: '上一时段' },
  { id: 'calendar-next', label: '下一时段' },
  { id: 'calendar-mode', label: '日历视图' },
  { id: 'calendar-events', label: '管理事件' },
];
function topbarVisibilityItems(tabId: string, hasDocument: boolean, activePane: boolean) {
  return [
    ...topbarItems.filter(item => item.id !== 'breadcrumb' || tabId !== CALENDAR_TAB_ID),
    ...(activePane && extensions.regions['editing-status'] ? [{ id: 'editing-status', label: '同步状态' }] : []),
    ...(tabId === CALENDAR_TAB_ID ? calendarToolItems : []),
    ...(hasDocument ? documentToolItems : []),
  ];
}
store.registerViews(extensionViews);
const activeExtensionView = computed(() => extensionViews.find(view => view.id === store.activeId));
const viewActions = Object.fromEntries(extensionViews.map(view => [view.id, {
  open: () => {
    openExtensionView(view.id);
    if (window.innerWidth <= 700) sidebar.value = false;
  },
  showSidebar: () => { sidebarView.value = view.id; sidebar.value = true; },
}]));
const editing = extensions.editing;
assistant.setManaged(id => editing.isManaging(id));
const extensionActions: WorkbenchActions = {
  closeMenus: () => { workspaceMenu.value = false; menu.value = false; },
  createWorkspace: () => showModal('workspace'), openSettings,
  showDiff: value => { selectedDiff.value = value; },
};
const updates = useUpdatesStore();
const updateLock = computed(() => ['downloading', 'installing'].includes(updates.state.phase));
const historyPanel = ref(false);
const importPanel = ref(false);
const templateDialog = ref(false);
const importRecords = ref<ImportRecord[]>([]);
function openImport() {
  menu.value = false;
  workspaceMenu.value = false;
  importPanel.value = true;
}
const historyPage = ref<'versions' | 'updates'>('versions');
const agentPanel = ref(false);
const recyclePanel = ref(false);
const sidebarView = ref('repository');
const calendarDate = ref(new Date());
const calendarMode = ref<CalendarViewMode>('week');
const calendarModeOpen = ref(false);
const calendarModeOptions: { mode: CalendarViewMode; label: string }[] = [
  { mode: 'day', label: '日' },
  { mode: 'four-days', label: '4 天' },
  { mode: 'week', label: '周' },
  { mode: 'month', label: '月' },
  { mode: 'year', label: '年' },
  { mode: 'agenda', label: '日程' },
];
const calendarModeLabel = computed(() => calendarModeOptions.find(option => option.mode === calendarMode.value)?.label ?? '周');
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
  sidebarView.value = 'plan';
  if (date) calendarDate.value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  store.openCalendarTab();
}
function openExtensionView(id: string) {
  sidebarView.value = extensionViews.find(view => view.id === id)?.sidebar ? id : 'repository';
  store.openViewTab(id);
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
  () => {
    agentPanel.value = false;
    selectedDiff.value = undefined;
    recyclePanel.value = false;
    sidebarView.value = 'repository';
    calendarDate.value = new Date();
    calendarMode.value = 'week';
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
watch(activeId, (id) => {
  calendarModeOpen.value = false;
  if (id === CALENDAR_TAB_ID) sidebarView.value = 'plan';
  else if (activeExtensionView.value?.sidebar) sidebarView.value = id;
  else if (extensionViews.some(view => view.id === sidebarView.value)) sidebarView.value = 'repository';
});
const sidebar = ref(!detachedWindow && window.innerWidth > 700);
const viewportWidth = ref(window.innerWidth);
const compactPanes = computed(() => mobile || viewportWidth.value <= 700);
const sidebarWidth = ref<number | null>(null);
const resizingSidebar = ref(false);
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
let sidebarResizePointerId: number | null = null;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 0;
let preferredSidebarWidth: number | null = null;
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
if (!detachedWindow && Number.isInteger(savedSidebarWidth) && savedSidebarWidth >= SIDEBAR_MIN_WIDTH && savedSidebarWidth <= SIDEBAR_MAX_WIDTH) {
  setSidebarWidth(savedSidebarWidth, true);
}
function sidebarWidthLimit() {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth.value - (viewportWidth.value <= 700 ? 48 : 320)));
}
function defaultSidebarWidth() {
  return viewportWidth.value >= 1600 ? 245 : viewportWidth.value <= 1180 ? 210 : 230;
}
function setSidebarWidth(width: number, preservePreference = false) {
  const requestedWidth = Math.round(width);
  sidebarWidth.value = Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarWidthLimit(), requestedWidth));
  preferredSidebarWidth = preservePreference ? requestedWidth : sidebarWidth.value;
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth.value}px`);
}
function currentSidebarWidth() {
  return document.querySelector<HTMLElement>('.sidebar')?.getBoundingClientRect().width ?? 230;
}
function startSidebarResize(event: PointerEvent) {
  if (mobile || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  sidebarResizePointerId = event.pointerId;
  sidebarResizeStartX = event.clientX;
  sidebarResizeStartWidth = currentSidebarWidth();
  resizingSidebar.value = true;
  handle.setPointerCapture(event.pointerId);
}
function moveSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarResizePointerId) return;
  setSidebarWidth(sidebarResizeStartWidth + event.clientX - sidebarResizeStartX);
}
function finishSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarResizePointerId) return;
  sidebarResizePointerId = null;
  resizingSidebar.value = false;
  if (sidebarWidth.value !== null) saveTextPreference('sidebarWidth', String(sidebarWidth.value));
}
function resizeSidebarWithKeyboard(event: KeyboardEvent) {
  if (mobile) return;
  const width = sidebarWidth.value ?? currentSidebarWidth();
  const nextWidth = event.key === 'ArrowLeft' ? width - 10
    : event.key === 'ArrowRight' ? width + 10
    : event.key === 'Home' ? SIDEBAR_MIN_WIDTH
    : event.key === 'End' ? sidebarWidthLimit()
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
watch(toolbarMode, value => saveTextPreference('toolbarMode', value));
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
const selectedVisualFontFamily = computed(() => visualFontFamily(visualFontChoice.value, customFontName.value));
watch(visualFontChoice, (value) => saveTextPreference('visualFontChoice', value));
watch(customFontName, (value) => saveTextPreference('customFontName', value));
const visualFontSize = ref(readFontSizePreference('visualFontSize', 16));
const sourceFontSize = ref(readFontSizePreference('sourceFontSize', 14));
watch(visualFontSize, (value) => saveFontSizePreference('visualFontSize', value));
watch(sourceFontSize, (value) => saveFontSizePreference('sourceFontSize', value));
const showPageTitle = ref(readPreference('showPageTitle', true));
watch(showPageTitle, (value) => savePreference('showPageTitle', value));
const pageTitleSource = ref(parsePageTitleSource(readTextPreference('pageTitleSource')));
watch(pageTitleSource, value => saveTextPreference('pageTitleSource', value));
const limitPageWidth = computed(() => {
  const documentId = active.value?.id;
  return !documentId || store.capabilities.pageWidthLimits[documentId] !== false;
});
const pageWidthWritable = computed(
  () => !!workspace.value && !workspace.value.readOnly && !active.value?.missing &&
    !store.capabilitySaving && !store.capabilityError,
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
const editorPreferences = ref<EditorPreferences>({
  previewMathWhileEditing: readPreference(
    'previewMathWhileEditing',
    defaultEditorPreferences.previewMathWhileEditing,
  ),
  folding: readPreference('folding', defaultEditorPreferences.folding),
});
watch(
  editorPreferences,
  (preferences) => {
    for (const key of Object.keys(preferences) as (keyof EditorPreferences)[])
      savePreference(key, preferences[key]);
  },
  { deep: true },
);
const hoverOutline = window.matchMedia('(hover: hover)').matches;
const sourceModes = shallowReactive<Record<string, boolean>>({});
const paneSource = (id: string) => sourceModes[id] ?? defaultSource.value;
const source = computed({ get: () => paneSource(store.activeId), set: value => { sourceModes[store.activeId] = value; } });
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
    !!workspace.value?.files.find(file => file.id === active.value?.id)?.readOnly ||
    !!active.value?.conflict ||
    editing.activeBusy ||
    !!editing.active?.readOnly,
);
async function renameDocumentTitle(workspaceId: string, id: string, from: string, to: string) {
  if (workspace.value?.id !== workspaceId) throw new Error('工作空间已切换，请重新打开文档后重试');
  if (updateLock.value || store.busy || workspace.value.readOnly || editing.isManaging(id))
    throw new Error('当前文档暂时无法重命名');
  const doc = store.documents.find((entry) => entry.id === id);
  if (!doc || doc.path !== from) throw new Error('文件位置已变化，请重新输入标题');
  await store.rename(doc, to);
}
watch(
  () => editing.active?.key,
  (epoch) => {
    if (epoch) source.value = false;
  },
);
const syntaxIssues = computed(() => unsupportedMarkdown(active.value?.content ?? ''));
const panel = ref<'outline' | 'activity'>('outline');
const showOutline = ref(readPreference('showOutline', true));
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
watch(outlinePinned, (pinned) => savePreference('outlinePinned', pinned));
const menu = ref(false);
const exportBusy = ref(false);
const documentMenuButton = ref<HTMLButtonElement>();
const documentMenuElement = ref<HTMLElement>();
const workspaceMenu = ref(false);
const fileContextMenu = ref<{ file: FileEntry; x: number; y: number } | null>(null);
const directoryContextMenu = ref<{ parent: string; x: number; y: number } | null>(null);
const pageContextMenu = ref<{ x: number; y: number } | null>(null);
const pageContextMenuElement = ref<HTMLElement>();
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
  const id = activeId.value;
  const available = !!id && workspace.value?.files.some((file) => file.id === id);
  selectedEntryIds.value = available ? new Set([id]) : new Set();
  selectionAnchorId.value = available ? id : null;
}
const contextEntries = computed(() => (fileContextMenu.value ? selectedEntries.value : []));
const multipleContextEntries = computed(() => contextEntries.value.length > 1);
const draggedEntry = ref<{ file: FileEntry; workspaceId: string } | null>(null);
const draggedSelection = ref<FileEntry[]>([]);
const tabFileDrag = computed(() => draggedEntry.value ? {
  workspaceId: draggedEntry.value.workspaceId,
  ids: draggedSelection.value.map((file) => file.id),
} : undefined);
const dropFolder = ref<string | null>(null);
const moveBusy = ref(false);
const optimisticFileMove = ref<{ workspaceId: string; changes: FileMovePreview[] } | null>(null);
const treeFiles = computed(() => {
  const files = (workspace.value?.files ?? []).filter((file) => !isWorkspaceInternalPath(file.path));
  const preview = optimisticFileMove.value;
  return preview && workspace.value?.id === preview.workspaceId
    ? applyFileMovePreview(files, preview.changes)
    : files;
});
const managedFilePaths = computed(
  () =>
    workspace.value?.files
      .filter((entry) => entry.kind === 'file' && editing.isManaging(entry.id))
      .map((entry) => entry.path) ?? [],
);
let fileContextTrigger: HTMLElement | null = null;
const settingsPanel = ref(false);
const settingsPage = ref<'appearance' | 'editing' | 'workspace' | 'about'>('appearance');
watch(defaultSource, (value) => {
  savePreference('defaultSource', value);
  if (!editing.active && !editing.activeBusy) source.value = value;
});
watch(revealMarkdown, (value) => savePreference('revealMarkdown', value));
const modal = ref<
  '' | 'newTab' | 'rename' | 'search' | 'delete' | 'saveAs' | 'workspace'
>('');
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
      ? '目录已自动更新，请核对所选条目后再次确认。'
      : '所选条目已移除，目录已自动更新。请关闭此窗口后重新选择。';
  },
);
const input = ref('');
const modalError = ref('');
const modalBusy = ref(false);
const inputEl = ref<HTMLInputElement>();
const paneEditors = shallowReactive(new Map<string, InstanceType<typeof MarkdownEditor>>());
const selectionTodo = shallowRef<SelectionTodoSession>();
const paneSourceSelections = shallowReactive<Record<string, boolean>>({});
function beginSelectionTodo(paneId: string, fileId: string) {
  const scope = workspace.value;
  const doc = store.documents.find(doc => doc.id === fileId);
  if (!scope || !doc || paneReadonly(doc) || editing.isManaging(fileId) || !store.capabilities.features.objectReferences) return;
  const captured = (paneSource(fileId) ? paneSourceEditors.get(paneId) : paneEditors.get(paneId))?.captureTodoSelection();
  if (!captured) { store.report('请先选择要创建 Todo 的文字'); return; }
  const expected = { id: scope.id, path: scope.path, content: doc.content };
  const source: ReferenceTarget = { workspace: scope.id, type: 'document', id: doc.id, path: doc.path, name: basename(doc.path).replace(/\.(md|markdown)$/i, '') };
  function originalDocument() {
    if (workspace.value?.id !== expected.id || workspace.value.path !== expected.path) throw new Error('工作区已切换，请返回原工作区后重试');
    const original = store.documents.find(doc => doc.id === fileId);
    if (!original || paneReadonly(original) || original.missing || editing.isManaging(fileId) || !store.capabilities.features.objectReferences)
      throw new Error('原文档已关闭或不可编辑，请重新打开原文档');
    return original;
  }
  selectionTodo.value = selectionTodoSession(captured.text, source, {
    create: draft => {
      if (originalDocument().content !== expected.content) throw new Error('原文已变化，请重新选择文字');
      return store.createObject(draft);
    },
    insert: async (record, append) => {
      const original = originalDocument();
      const url = referenceUrl(record.object);
      const alreadyInserted = documentLinks(original.content).some(link => link.target === url);
      if (!alreadyInserted) {
        if (append) store.editDocument(fileId, `${original.content.replace(/\n*$/, '')}\n\n${referenceMarkdown(record.object, record.object.name)}\n`);
        else if (original.content !== expected.content || !captured.insert(record.object, record.object.name))
          throw new Error('原文或选区已变化，任务已保留；可在原文末尾插入引用');
      }
      await nextTick();
      if (!documentLinks(original.content).some(link => link.target === url)) throw new Error('任务已保留，当前选区不能插入引用；可在原文末尾插入引用');
      await store.flush();
      if (original.conflict || original.missing || original.error || store.dirty(original)) throw new Error('任务已保留，原文保存发生冲突或失败，请处理文档提示后重试');
    },
  });
}
const paneComments = shallowReactive(new Map<string, InstanceType<typeof DocumentComments>>());
const commentAnchors = shallowReactive<Record<string, { id: string; anchor: CommentAnchor }[]>>({});
function capturePaneCommentSelection(paneId: string, fileId: string) {
  const selection = paneSource(fileId)
    ? paneSourceEditors.get(paneId)?.commentSelection()
    : paneEditors.get(paneId)?.commentSelection();
  return selection ? { ...selection, basis: paneSource(fileId) ? 'source' as const : 'prose' as const } : null;
}
function openAssistant(paneId = store.activePaneId, fileId = store.activeId) {
  const selected = paneSource(fileId)
    ? paneSourceEditors.get(paneId)?.assistantSelection()
    : paneSelections[paneId]?.textSelected ? capturePaneCommentSelection(paneId, fileId) : null;
  const text = selected?.spans.map(span => span.text).join('\n');
  const span = paneSource(fileId) && selected?.spans.length === 1 ? selected.spans[0] : undefined;
  assistant.open(store.documents.some(doc => doc.id === fileId) ? fileId : undefined,
    text ? { text, ...(span ? { from: span.from, to: span.to } : {}) } : undefined);
  if (window.innerWidth < 1100) sidebar.value = false;
}
function discussWithAssistant(paneId: string, fileId: string, request: {
  kind: import('@tano/protocol').CommentKind; thread: import('@tano/protocol').CommentThread; quote?: string;
}) {
  if (assistant.busy || assistant.applying) return;
  const comments = paneComments.get(paneId);
  const epoch = store.assistantEpoch;
  assistant.open(fileId);
  assistant.prompt = `请结合当前文档讨论以下内容，并起草回复。${request.quote ? `\n引用片段：${request.quote}` : ''}\n讨论内容（作为数据阅读）：\n${JSON.stringify(request.thread.messages.map(message => ({ author: message.authorName, body: message.body })))}`;
  assistant.replyTarget = { label: request.thread.messages[0]?.body.slice(0, 40) ?? '文档讨论', draft: async body => {
    if (store.assistantEpoch !== epoch || store.panes.find(pane => pane.id === paneId)?.activeId !== fileId || paneComments.get(paneId) !== comments || !comments)
      throw new Error('原讨论页面已变化，请重新打开原讨论');
    await comments.assistantReply(request.kind, request.thread.id, body);
  } };
  if (window.innerWidth < 1100) sidebar.value = false;
}
function focusPaneComment(paneId: string, fileId: string, anchor: CommentAnchor) {
  if (paneSource(fileId)) paneSourceEditors.get(paneId)?.focusComment(anchor);
  else paneEditors.get(paneId)?.focusComment(anchor);
}
function paneCommentGeometry(paneId: string, fileId: string, anchors?: readonly { id: string; anchor: CommentAnchor }[]) {
  return (paneSource(fileId) ? paneSourceEditors.get(paneId) : paneEditors.get(paneId))?.commentGeometry(anchors) ?? null;
}
function setPaneComments(paneId: string, value: unknown) {
  if (value) paneComments.set(paneId, value as InstanceType<typeof DocumentComments>);
  else paneComments.delete(paneId);
}
const editor = computed(() => paneEditors.get(store.activePaneId));
function setPaneEditor(id: string, value: unknown) {
  if (value) paneEditors.set(id, value as InstanceType<typeof MarkdownEditor>);
  else paneEditors.delete(id);
}
const objectPanel = ref(false);
const selectedObjectId = ref<string>();
const selectedPersonal = ref(false);
const planDetail = shallowRef<ObjectRecord>();
function showObjects(id?: string) {
  selectedPersonal.value = false;
  selectedObjectId.value = id;
  objectPanel.value = true;
  workspaceMenu.value = false;
}
function showPlanEvent(key: string) {
  const personal = plans.personal.find(item => planKey(item) === key);
  const local = store.objects.find(item => item.object.id === key && ['event', 'task'].includes(item.object.type));
  const record = personal ?? (local && workspace.value ? { ...local, source: { scope: 'workspace' as const, id: workspace.value.id, name: workspace.value.name } } : undefined);
  if (!record) { store.report('事项已不存在，请刷新计划后重试'); return; }
  objectPanel.value = false;
  personalHome.value = false;
  planDetail.value = record;
}
function managePlanEvents() {
  showObjects();
  selectedPersonal.value = plans.view === 'personal';
}
async function openReference(identity: ReferenceIdentity) {
  const result = resolveReference(store.referenceTargets, identity);
  if (!result.target) {
    store.report('当前工作区中引用目标不可用，请检查对象是否被移除或 ID 是否重复');
    return;
  }
  if (identity.type !== 'document') {
    if (['event', 'task'].includes(identity.type)) showPlanEvent(identity.id);
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
async function openPlanReference(identity: ReferenceIdentity) {
  const current = planDetail.value;
  if (current?.source?.scope === 'personal') {
    const record = plans.personal.find(item => item.object.type === identity.type && item.object.id === identity.id);
    if (record) planDetail.value = record;
    else store.report('个人事项引用目标不可用');
    return;
  }
  planDetail.value = undefined;
  await openReference(identity);
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
        throw new Error('工作区已切换，已导入的资产保留在原工作区');
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
const paneScrolls = shallowReactive(new Map<string, HTMLElement>());
const paneEditorScrolls = shallowReactive(new Map<string, HTMLElement>());
const paneSourceEditors = shallowReactive(new Map<string, InstanceType<typeof SourceEditor>>());
const documentScroll = computed(() => paneScrolls.get(store.activePaneId));
const editorScroll = computed(() => paneEditorScrolls.get(store.activePaneId));
const sourceEditor = computed(() => paneSourceEditors.get(store.activePaneId));
function setPaneElement(kind: 'scroll' | 'editor' | 'source', id: string, value: unknown) {
  if (kind === 'source') {
    if (value) paneSourceEditors.set(id, value as InstanceType<typeof SourceEditor>);
    else paneSourceEditors.delete(id);
  } else {
    const map = kind === 'scroll' ? paneScrolls : paneEditorScrolls;
    if (value) map.set(id, value as HTMLElement); else map.delete(id);
  }
}
function paneReadonly(doc: OpenDocument) {
  return updateLock.value || store.busy || !!workspace.value?.readOnly ||
    !!workspace.value?.files.find(file => file.id === doc.id)?.readOnly || !!doc.conflict ||
    (doc.id === store.activeId ? editorReadonly.value :
      readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false) || editing.isManaging(doc.id));
}
const documentUndoAvailable = ref(false);
const documentRedoAvailable = ref(false);
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
  documentUndoAvailable.value =
    !editorReadonly.value &&
    (source.value ? !!sourceEditor.value?.canUndo() : !!editor.value?.canUndo());
  documentRedoAvailable.value =
    !editorReadonly.value &&
    (source.value ? !!sourceEditor.value?.canRedo() : !!editor.value?.canRedo());
}
function documentMenuTriggerKeydown(event: KeyboardEvent) {
  if (!menu.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [
    ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ];
  if (!items.length) return;
  event.preventDefault();
  items[
    event.key === 'ArrowUp' || event.key === 'End' ? items.length - 1 : 0
  ]?.focus();
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
    ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
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
let headingFrame: number | undefined;
const fileInput = ref<HTMLInputElement>();
let attachmentTarget: { paneId: string; documentId: string } | undefined;
function pickFilesFor(paneId: string, doc: OpenDocument) {
  attachmentTarget = { paneId, documentId: doc.id };
  fileInput.value?.click();
}
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
  if (!attachments || !currentWorkspace || !doc) throw new Error('当前工作区不支持导入附件');
  const result = await attachments.importAttachment(currentWorkspace.id, doc.path, file, requireImage);
  if (workspace.value?.id !== currentWorkspace.id || !store.documents.some(item => item.id === doc.id))
    throw new Error('附件已保存到原工作空间的 assets；文档已切换，请重新插入链接');
  await store.refresh();
  if (workspace.value?.id !== currentWorkspace.id || !store.documents.some(item => item.id === doc.id))
    throw new Error('附件已导入，原文档已关闭');
  return { ...result, url: relativeWorkspaceReference(doc.path, result.path) };
}
async function insertSourceFiles(files: File[], position: number, requireImage: boolean, doc = active.value, paneId = store.activePaneId) {
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
    if (targetEditor && paneSourceEditors.get(paneId) === targetEditor &&
      store.panes.find(pane => pane.id === paneId)?.activeId === id) {
      targetEditor.insertText(text, at);
    } else store.editDocument(id, `${content.slice(0, at)}${text}${content.slice(at)}`);
  } catch (error) {
    store.report(error);
  } finally {
    attachmentBusy.value = false;
  }
}
function pickedFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const target = attachmentTarget;
  attachmentTarget = undefined;
  if (!target || !files.length) return;
  const doc = store.documents.find(item => item.id === target.documentId);
  const pane = store.panes.find(item => item.id === target.paneId);
  if (!doc || pane?.activeId !== doc.id || paneReadonly(doc)) return;
  if (paneSource(doc.id))
    void insertSourceFiles(files, paneSourceEditors.get(pane.id)?.cursor() ?? doc.content.length, false, doc, pane.id);
  else paneEditors.get(pane.id)?.importFiles(files);
}

async function openEntry(file: FileEntry, newTab = false) {
  if (isObjectPath(file.path)) {
    const record = store.objects.find((item) => item.path === file.path);
    if (record) showObjects(record.object.id);
    else store.report('对象文件不可用，请在工作区对象面板检查格式或重复 ID');
    return;
  }
  if (isMarkdown(file.path)) {
    if (newTab) await store.openFileInNewTab(file);
    else await store.openFile(file);
    if (window.innerWidth <= 700) sidebar.value = false;
    return;
  }
  if (workspace.value && attachments) {
    try {
      await attachments.exportAttachment(workspace.value.id, file.path);
    } catch (error) {
      store.report(error);
    }
  } else store.report('当前存储适配器不支持直接打开附件');
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
function directoryContextAction(action: 'document' | 'folder') {
  const parent = directoryContextMenu.value?.parent ?? '';
  closeDirectoryContextMenu();
  const target = parent
    ? workspace.value?.files.find((entry) => entry.kind === 'directory' && entry.path === parent)
    : undefined;
  if (parent && !target) return;
  void createNewEntry(action, parent);
}
function closePageContextMenu() {
  pageContextMenu.value = null;
}
function closeButtonVisibilityMenus() {
  closeFileContextMenu();
  closeDirectoryContextMenu();
  closePageContextMenu();
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
function togglePageOption(option: 'width' | 'title' | 'outline') {
  if (option === 'width') setLimitPageWidth(!limitPageWidth.value);
  if (option === 'title') showPageTitle.value = !showPageTitle.value;
  if (option === 'outline') showOutline.value = !showOutline.value;
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
    editing.isManaging(file.id)
  );
}
function directoryHasManagedFile(file: FileEntry) {
  return (
    file.kind === 'directory' &&
    managedFilePaths.value.some((path) => path.startsWith(`${file.path}/`))
  );
}
function fileDeleteDisabled(file: FileEntry) {
  return (
    fileMutationDisabled(file) ||
    (store.isWeb && file.kind !== 'file') ||
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
    : !editing.isManaging(file.id);
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
    for (const entry of entries) await store.moveEntry(entry, folder, drag.workspaceId);
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
    | 'rename'
    | 'delete'
    | 'copy'
    | 'copy-full-path'
    | 'duplicate'
    | 'open-default'
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
  if (
    fileMutationDisabled(file) ||
    (action === 'delete' && fileDeleteDisabled(file)) ||
    (action === 'rename' && directoryHasManagedFile(file))
  )
    return;
  if (action === 'duplicate') {
    if (!localNative || mobile) return;
    try {
      await store.duplicateEntry(file, workspace.value?.id);
    } catch (error) {
      store.report(error);
    }
    return;
  }
  if (action === 'folder' && store.isWeb) return;
  if (action === 'delete') {
    await removeDocument(file);
    return;
  }
  if (action === 'document' || action === 'folder') {
    await createNewEntry(action, file.path);
    return;
  }
  showModal(action, file);
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
async function openDocumentLink(reference: string) {
  if (!workspace.value || !active.value) return;
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
  const path = resolveWorkspaceReference(active.value.path, reference);
  const file = workspace.value.files.find((entry) => entry.path === path && entry.kind === 'file');
  if (file) await openEntry(file);
  else store.report('此链接不在当前工作空间；请复制链接到浏览器打开');
}
async function openWikiLink(target: string) {
  if (!workspace.value || !active.value) return;
  const result = resolveWikiLink(workspace.value.files, active.value.path, target);
  if ('error' in result) {
    store.report(
      result.error === 'ambiguous'
        ? '有多篇同名文档，请在双向链接中写明文件夹路径'
        : result.error === 'invalid'
          ? '双向链接目标无效'
          : '当前工作空间中找不到这篇文档',
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
    store.report('目标文档中找不到这个标题');
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
  store.report('文档已打开，但暂时无法定位到标题');
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
function updateActiveHeading() {
  const container = documentScroll.value;
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
const noteCount = computed(
  () => workspace.value?.files.filter((f) => f.kind === 'file' && isMarkdown(f.path)).length ?? 0,
);
const searchHits = ref<SearchHit[]>([]);
const searching = ref(false);
const searchError = ref('');
watch([input, modal, workspace], ([query, kind], _old, cleanup) => {
  searchHits.value = [];
  searchError.value = '';
  searching.value = kind === 'search' && !!query.trim();
  if (!searching.value) return;
  let cancelled = false;
  const timer = setTimeout(async () => {
    try {
      const results = await store.search(query);
      if (!cancelled) searchHits.value = results;
    } catch (error) {
      if (!cancelled) searchError.value = String(error);
    } finally {
      if (!cancelled) searching.value = false;
    }
  }, 160);
  cleanup(() => {
    cancelled = true;
    clearTimeout(timer);
  });
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
  return [workspace.value?.name ?? '工作区', ...path.split('/').slice(0, -1)].join(' › ');
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
    newTab: '打开文件',
    rename:
      modalTarget.value?.kind === 'directory'
        ? '重命名文件夹'
        : modalTarget.value && !isMarkdown(modalTarget.value.path)
          ? '重命名文件'
          : '重命名文档',
    search: '找到那一页',
    delete: `${store.isDemo ? '删除' : store.isWeb ? '删除在线文档' : mobile ? '移入手机回收站' : '移入回收站'}${modalDeleteEntries.value.length > 1 ? ` · ${modalDeleteEntries.value.length} 项` : ''}`,
    saveAs: '另存为新文档',
    workspace: store.isWeb ? '创建工作区' : '新建手机工作空间',
  };
  return modal.value ? titles[modal.value] : '';
});

function showModal(kind: Exclude<typeof modal.value, ''>, target?: FileEntry) {
  if (
    store.busy ||
    (workspace.value?.readOnly &&
      ['rename', 'delete', 'saveAs'].includes(kind))
  )
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
          : (workspace.value?.files.filter((file) => file.id === activeId.value) ?? [])
      : [];
  modalDeleteContents.value = kind === 'delete' ? [...(workspace.value?.files ?? [])] : [];
  modalDeleteWorkspaceId.value = kind === 'delete' ? workspace.value?.id : undefined;
  modalError.value = '';
  input.value =
    kind === 'rename'
      ? (target?.path ?? active.value?.path ?? '')
      : kind === 'saveAs'
        ? (active.value?.path.replace(/\.(md|markdown)$/i, '-副本.md') ?? '')
        : '';
  modal.value = kind;
  void nextTick(() => {
    inputEl.value?.focus();
    if (kind === 'rename') inputEl.value?.select();
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
  if (!target && (editorReadonly.value || !!editing.active || editing.activeBusy))
    return;
  const entries = target
    ? [target]
    : (workspace.value?.files.filter((file) => file.id === activeId.value) ?? []);
  await removeDocuments(entries);
}
async function createNewDocument() {
  await createNewEntry('document');
}
async function createNewEntry(kind: 'document' | 'folder', parent = '') {
  if (store.busy || workspace.value?.readOnly || updateLock.value) return;
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
    await store.createUntitledDocument(parent);
    if (window.innerWidth <= 700) sidebar.value = false;
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
const transferRollback = new Map<string, { tabId: string; created: boolean; priorIndex: number; priorActive: string; undoDock?: () => void; timer: ReturnType<typeof setTimeout> }>();

async function acceptTabTransfer(request: TabTransferRequest) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const targetLabel = getCurrentWindow().label;
  let actualId = request.tabId;
  let created = false;
  const priorActive = store.activeId;
  const priorIndex = store.tabs.findIndex((tab) => tab.id === request.tabId);
  let undoDock: (() => void) | undefined;
  let error: string | undefined;
  try {
    if (request.sourceLabel === targetLabel || !workspace.value ||
        workspace.value.id !== request.workspaceId || store.busy)
      throw new Error('目标窗口当前无法接收这个标签页');
    if (request.drop) {
      if (!store.panes.some(pane => pane.id === request.drop!.paneId)) throw new Error('目标分栏已关闭，请重新拖入');
      store.focusPane(request.drop.paneId);
    }
    if (request.tabId.startsWith('blank:')) {
      store.createBlankTab();
      actualId = store.activeId;
      created = true;
    } else if (request.tabId === GRAPH_TAB_ID) {
      created = priorIndex < 0;
      store.openGraphTab();
    } else if (request.tabId === PLUGINS_TAB_ID) {
      created = priorIndex < 0;
      store.openPluginsTab();
    } else if (request.tabId === CALENDAR_TAB_ID) {
      created = priorIndex < 0;
      store.openCalendarTab();
    } else if (extensionViews.some(view => view.id === request.tabId)) {
      const view = extensionViews.find(view => view.id === request.tabId)!;
      if (!view.detachable) throw new Error(view.detachBlockedMessage ?? '此扩展视图不支持移到其他窗口');
      created = priorIndex < 0;
      store.openViewTab(view.id);
    } else if (priorIndex < 0) {
      const file = workspace.value.files.find((entry) => entry.id === request.tabId && entry.kind === 'file');
      if (!file) throw new Error('目标窗口找不到拖入的文档');
      await store.openFileInNewTab(file);
      created = true;
    }
    if (!store.tabs.some((tab) => tab.id === actualId)) throw new Error('目标窗口未能打开拖入的标签页');
    if (request.drop) {
      if (!store.panes.some(pane => pane.id === request.drop!.paneId)) throw new Error('目标分栏已关闭，请重新拖入');
      undoDock = store.dockTab(actualId, request.drop);
    } else {
      const index = priorIndex >= 0 && priorIndex < request.index ? request.index - 1 : request.index;
      store.placeTab(actualId, index);
    }
    store.activeId = actualId;
    const timer = setTimeout(() => transferRollback.delete(request.requestId), 15_000);
    transferRollback.set(request.requestId, { tabId: actualId, created, priorIndex, priorActive, undoDock, timer });
  } catch (reason) {
    error = String(reason);
    if (created) await store.close(actualId);
    if (store.tabs.some(tab => tab.id === priorActive)) store.activeId = priorActive;
  }
  try {
    await emitTo(request.sourceLabel, TAB_TRANSFER_RESULT, {
      requestId: request.requestId, targetLabel,
      ...(error ? { error } : { tabId: actualId, created }),
    } satisfies TabTransferResult);
  } catch (reason) {
    await rollbackTabTransfer({ requestId: request.requestId });
    throw reason;
  } finally {
    window.dispatchEvent(new CustomEvent('tano-tab-transfer-settled', {
      detail: { sourceLabel: request.sourceLabel, tabId: request.tabId },
    }));
  }
  if (!error) void getCurrentWindow().setFocus().catch(store.report);
}

async function rollbackTabTransfer(request: TabTransferRollback) {
  const pending = transferRollback.get(request.requestId);
  if (!pending) return;
  transferRollback.delete(request.requestId);
  clearTimeout(pending.timer);
  if (pending.created) await store.close(pending.tabId);
  else if (pending.undoDock) pending.undoDock();
  else if (pending.priorIndex >= 0) store.placeTab(pending.tabId, pending.priorIndex);
  if (store.tabs.some((tab) => tab.id === pending.priorActive)) store.activeId = pending.priorActive;
}

async function detachTab(id: string, drop?: DetachedDropPoint, settled?: () => void) {
  if (!native || mobile || detachingTab || !workspace.value || store.busy) {
    settled?.();
    return;
  }
  const tab = store.tabs.find((item) => item.id === id);
  if (!tab) { settled?.(); return; }
  if (tab.view && !tab.view.detachable) {
    store.report(tab.view.detachBlockedMessage ?? '此视图保留在当前窗口，暂不支持移到其他窗口。');
    settled?.();
    return;
  }
  if (tab.document?.conflict || tab.document?.missing) {
    store.report('请先处理文档冲突或缺失，再拖出标签页。');
    settled?.();
    return;
  }
  detachingTab = true;
  // Collapse a departing single-tab pane before saving or starting a WebView.
  // For a drop still over this window, first confirm it belongs to another one.
  if (!drop?.insideSourceWindow) store.detachingTabId = id;
  try {
    await editing.flush();
    if (!(await store.flush())) throw new Error('还有未保存的修改，请先处理保存错误。');
    const dock = drop ? await findTabDockTarget(workspace.value.id, id, {
      x: drop.x, y: drop.y, centerOffset: (drop.width ?? 0) / 2 - drop.grabX,
    }) : null;
    if (dock === 'inside-window' || (!dock && drop?.insideSourceWindow)) return;
    store.detachingTabId = id;
    if (dock) {
      const transfer = await requestTabTransfer(dock.targetLabel, {
        workspaceId: workspace.value.id, tabId: id, index: dock.index, drop: dock.drop,
      });
      await store.close(id);
      if (store.tabs.some((item) => item.id === id)) {
        await emitTo(dock.targetLabel, TAB_TRANSFER_ROLLBACK, { requestId: transfer.requestId } satisfies TabTransferRollback);
        throw new Error('原标签页未能关闭，已取消跨窗口移动');
      }
      if (detachedWindow && !store.tabs.length) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().destroy();
      }
      return;
    }
    const title = tab.graph ? '关系图谱' : tab.plugins ? '插件' : tab.blank
      ? '新标签页' : basename(tab.path).replace(/\.(md|markdown)$/i, '');
    const detached = await createDetachedTabWindow(workspace.value.path, id, title, drop);
    await store.close(id);
    if (store.tabs.some((item) => item.id === id)) {
      await detached.destroy();
      throw new Error('原标签页未能关闭，已取消拖出。');
    }
  } catch (error) {
    store.report(error);
  } finally {
    if (store.detachingTabId === id) store.detachingTabId = '';
    detachingTab = false;
    settled?.();
  }
}
const settingsSnapshot = computed<SettingsSnapshot>(() => ({
  workspace: workspace.value ? {
    name: workspace.value.name, path: workspace.value.path, readOnly: workspace.value.readOnly,
  } : null,
  mode: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
  defaultSource: defaultSource.value,
  theme: theme.value,
  visualFontChoice: visualFontChoice.value,
  customFontName: customFontName.value,
  revealMarkdown: revealMarkdown.value,
  toolbarMode: toolbarMode.value,
  showPageTitle: showPageTitle.value,
  pageTitleSource: pageTitleSource.value,
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
watch(settingsSnapshot, () => { void syncSettingsWindow(); }, { deep: true });

function openSettings(page: SettingsPageId = 'appearance') {
  menu.value = false;
  workspaceMenu.value = false;
  if (native && !mobile) {
    requestedSettingsPage = page;
    void openSettingsWindow(page).then(() => { settingsWindowVisible = true; }).catch(store.report);
    return;
  }
  settingsPage.value = page === 'preferences' ? 'appearance' : page;
  settingsPanel.value = true;
}
function handleSettingsCommand(command: SettingsCommand) {
  if (command.type === 'ready') {
    settingsWindowVisible = true;
    void syncSettingsWindow();
    void emitTo(settingsWindowLabel(), SETTINGS_NAVIGATE, requestedSettingsPage).catch(store.report);
    return;
  }
  if (command.type === 'capability') { void store.updateCapabilities(command.value); return; }
  if (command.type === 'action') { settingsAction(command.value); return; }
  if (command.type === 'update') {
    if (updates.state.phase === 'available') void updates.download();
    else if (updates.state.phase === 'ready') void updates.install();
    else void updates.check();
    return;
  }
  switch (command.key) {
    case 'defaultSource': defaultSource.value = command.value as boolean; break;
    case 'theme': theme.value = command.value as typeof theme.value; break;
    case 'visualFontChoice': visualFontChoice.value = command.value as typeof visualFontChoice.value; break;
    case 'customFontName': customFontName.value = command.value as string; break;
    case 'revealMarkdown': revealMarkdown.value = command.value as boolean; break;
    case 'toolbarMode': toolbarMode.value = parseToolbarMode(command.value); break;
    case 'showPageTitle': showPageTitle.value = command.value as boolean; break;
    case 'pageTitleSource': pageTitleSource.value = parsePageTitleSource(command.value); break;
    case 'visualFontSize': visualFontSize.value = command.value as number; break;
    case 'sourceFontSize': sourceFontSize.value = command.value as number; break;
    case 'editorPreferences': editorPreferences.value = command.value as typeof editorPreferences.value; break;
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
  if (workspaceMenu.value && store.isWeb) void store.refreshWorkspaces();
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
      store.report('还有未保存的修改，请保存或另存副本后再返回首页。');
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
      (kind === 'rename' || kind === 'delete') &&
      editing.isManaging(modalTarget.value.id)
    )
      throw new Error('请先结束此文档的实时协作');
    if (kind === 'delete') {
      if (modalDeleteEntries.value.some(fileDeleteDisabled))
        throw new Error('所选条目中有无法移除的文件，请检查权限或实时协作状态');
      await store.removeEntries(
        modalDeleteEntries.value,
        modalDeleteWorkspaceId.value,
        modalDeleteContents.value,
      );
      selectActiveFileInTree();
    } else if (kind === 'workspace') {
      if (!input.value.trim()) throw new Error('请填写工作空间名称');
      store.fatal = '';
      await store.createWorkspace(input.value.trim());
      if (store.fatal) throw new Error(store.fatal);
    } else {
      let path = input.value.trim();
      if (
        !(
          kind === 'rename' &&
          modalTarget.value &&
          (modalTarget.value.kind === 'directory' || !isMarkdown(modalTarget.value.path))
        ) &&
        !isMarkdown(path)
      )
        path += '.md';
      const error = validatePath(path);
      if (error) throw new Error(error);
      if (!input.value.trim()) throw new Error('请填写一个名称');
      if (kind === 'rename' && modalTarget.value) await store.renameEntry(modalTarget.value, path);
      else if (kind === 'rename' && active.value) await store.rename(active.value, path);
      else if (kind === 'saveAs' && active.value) await store.saveCopy(active.value, path);
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
  const doc = active.value, currentWorkspace = workspace.value;
  if (!doc || exportBusy.value) return;
  const title = showPageTitle.value
    ? editorScroll.value?.querySelector<HTMLInputElement>('.document-title-input')?.value : undefined;
  const options = {
    id: doc.id, path: doc.path, content: doc.content, title,
    capabilities: store.capabilities, referenceTargets: store.referenceTargets,
    tableLayouts: doc.tableLayout?.file.tables,
    resolveImage: (reference: string) => attachments
      ? attachments.imageUrl(currentWorkspace, doc.path, reference) : safeRemoteImage(reference),
    fontFamily: selectedVisualFontFamily.value, fontSize: visualFontSize.value,
  };
  menu.value = false;
  exportBusy.value = true;
  try {
    const blob = await renderDocumentExport(options, format);
    const filename = exportFilename(doc.path, format);
    if (localNative) {
      const { saveDocumentExport } = await import('./native-document-export');
      await saveDocumentExport(blob, filename, format);
    } else downloadExport(blob, filename);
  } catch (reason) {
    store.report(reason);
  } finally {
    exportBusy.value = false;
  }
}
function jumpToHeading(index: number) {
  activeHeading.value = index;
  if (source.value) {
    const toolbarHeight = documentScroll.value?.querySelector('.editor-toolbar')?.clientHeight ?? 0;
    sourceEditor.value?.jumpToLine(outline.value[index].line, toolbarHeight);
  } else
    editorScroll.value
      ?.querySelectorAll(
        '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
      )
      [index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function toggleSidebar() {
  if (detachedWindow) return;
  sidebar.value = !sidebar.value;
  workspaceMenu.value = false;
}
function handleSidebarShortcut(event: KeyboardEvent) {
  if (importPanel.value) return;
  if (detachedWindow) return;
  if (!workspace.value || settingsPanel.value || updateLock.value) return;
  if (!isSidebarToggleShortcut(event)) return;
  event.preventDefault();
  event.stopPropagation();
  toggleSidebar();
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
        showModal('rename', file);
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
    if (window.innerWidth <= 700) sidebar.value = false;
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
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    void store.flush();
  }
  if (event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showModal('search');
  }
  if (event.key.toLowerCase() === 'o' && workspace.value) {
    event.preventDefault();
    showModal('newTab');
  }
  if (event.key.toLowerCase() === 'n' && workspace.value) {
    event.preventDefault();
    void createNewDocument();
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (store.pending) {
    event.preventDefault();
    event.returnValue = '';
  }
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
  if (!target.closest('.page-context-menu')) closePageContextMenu();
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
  if (!event.defaultPrevented) closePageContextMenu();
}
function dismissPageContextMenu() {
  closePageContextMenu();
}
watch(sidebar, (visible) => {
  if (!visible) {
    closeFileContextMenu();
    closeDirectoryContextMenu();
  }
});
let unlistenClose: (() => void) | undefined;
let unlistenWatchError: (() => void) | undefined;
let unlistenTabTransfer: (() => void) | undefined;
let unlistenTabRollback: (() => void) | undefined;
let unlistenSettingsCommand: (() => void) | undefined;
let settingsPrewarmTimer: number | undefined;
onMounted(async () => {
  if (!detachedWindow) window.addEventListener('keydown', handleSidebarShortcut, true);
  window.addEventListener('keydown', keydown);
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('click', outsideClick);
  window.addEventListener('contextmenu', outsideContextMenu);
  window.addEventListener('scroll', dismissFileContextMenu, true);
  window.addEventListener('scroll', closeDirectoryContextMenu, true);
  window.addEventListener('scroll', dismissPageContextMenu, true);
  window.addEventListener('resize', dismissFileContextMenu);
  window.addEventListener('resize', closeDirectoryContextMenu);
  window.addEventListener('resize', dismissPageContextMenu);
  if (!detachedWindow) window.addEventListener('resize', constrainSidebarToViewport);
  document.addEventListener('visibilitychange', mobileVisibility);
  await store.initialize();
  if (native && !mobile) {
    unlistenSettingsCommand = await listen<SettingsCommand>(SETTINGS_COMMAND, ({ payload }) => {
      handleSettingsCommand(payload);
    });
    unlistenTabTransfer = await listen<TabTransferRequest>(TAB_TRANSFER_REQUEST, ({ payload }) => {
      void acceptTabTransfer(payload).catch(store.report);
    });
    unlistenTabRollback = await listen<TabTransferRollback>(TAB_TRANSFER_ROLLBACK, ({ payload }) => {
      void rollbackTabTransfer(payload).catch(store.report);
    });
  }
  const detachedRequest = detachedWindow ? detachedTabRequest() : null;
  if (detachedRequest) {
    const opened = store.workspace?.path === detachedRequest.workspacePath &&
      store.tabs.length === 1 && (
        detachedRequest.tabId.startsWith('blank:') || store.tabs[0]?.id === detachedRequest.tabId
      );
    await reportDetachedReady(opened ? undefined : '独立窗口未能打开所选标签页');
  }
  if (native && !mobile && !detachedWindow) {
    void updates.initialize();
    settingsPrewarmTimer = window.setTimeout(() => {
      void prewarmSettingsWindow().catch(() => {});
    }, 800);
  }
  if (native) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (localNative)
      unlistenWatchError = await listen<string>('workspace-watch-error', (event) =>
        store.report(`文件监听遇到错误：${event.payload}。目录仍会定期自动检查。`),
      );
    if (!mobile)
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        if (updates.state.phase === 'installing') return;
        if (settingsPrewarmTimer !== undefined) {
          window.clearTimeout(settingsPrewarmTimer);
          settingsPrewarmTimer = undefined;
        }
        try {
          if (await store.flush()) {
            await assistant.settle();
            await editing.suspendAll();
            await closeSettingsWindow();
            await getCurrentWindow().destroy();
          } else store.report('还有未保存的内容，窗口已保留。请先保存或另存副本。');
        } catch (error) {
          store.report(error);
        }
      });
  }
});
onBeforeUnmount(() => {
  document.documentElement.style.removeProperty('--sidebar-width');
  if (headingFrame !== undefined) cancelAnimationFrame(headingFrame);
  void extensions.disconnect().catch(store.report);
  assistant.stop();
  void editing.dispose().catch(store.report);
  window.removeEventListener('keydown', handleSidebarShortcut, true);
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('click', outsideClick);
  window.removeEventListener('contextmenu', outsideContextMenu);
  window.removeEventListener('scroll', dismissFileContextMenu, true);
  window.removeEventListener('scroll', closeDirectoryContextMenu, true);
  window.removeEventListener('scroll', dismissPageContextMenu, true);
  window.removeEventListener('resize', dismissFileContextMenu);
  window.removeEventListener('resize', closeDirectoryContextMenu);
  window.removeEventListener('resize', dismissPageContextMenu);
  window.removeEventListener('resize', constrainSidebarToViewport);
  document.removeEventListener('visibilitychange', mobileVisibility);
  unlistenClose?.();
  unlistenWatchError?.();
  unlistenTabTransfer?.();
  unlistenTabRollback?.();
  unlistenSettingsCommand?.();
  if (settingsPrewarmTimer !== undefined) window.clearTimeout(settingsPrewarmTimer);
  for (const pending of transferRollback.values()) clearTimeout(pending.timer);
  transferRollback.clear();
  store.dispose();
});
watch(activeId, () => {
  closePageContextMenu();
  if (!pendingTreeOpenIds.has(activeId.value) || !selectedEntryIds.value.has(activeId.value))
    selectActiveFileInTree();
  historyPanel.value = false;
  panel.value = 'outline';
  outlineSearchOpen.value = false;
  outlineSearch.value = '';
  menu.value = false;
  activeHeading.value = 0;
  void nextTick(scheduleActiveHeading);
});
</script>

<template>
  <input ref="fileInput" type="file" multiple hidden @change="pickedFiles" />
  <Teleport v-if="native && !mobile && workspace && compactPanes" to="#desktop-window-tab-slot">
    <button
      v-if="!detachedWindow"
      :class="{ 'desktop-sidebar-toggle-hidden': sidebar }"
      class="desktop-sidebar-toggle"
      type="button"
      aria-label="展开侧栏"
      title="展开侧栏 · Ctrl B"
      :aria-hidden="sidebar"
      :tabindex="sidebar ? -1 : 0"
      :disabled="sidebar"
      @click="toggleSidebar"
    >
      <PanelLeftOpen :size="17" />
    </button>
    <DesktopTabs detachable :file-drag="tabFileDrag" @files-dropped="fileDragEnd" @new-tab="store.createBlankTab()" @new-document="createNewDocument" @detach-tab="detachTab" />
  </Teleport>
  <div
    class="app-shell"
    :class="{
      'sidebar-hidden': detachedWindow || !sidebar || !workspace,
      'detached-window': detachedWindow,
      'sidebar-resizing': resizingSidebar,
      'workspace-empty': !workspace,
    }"
  >
    <Transition name="sidebar-dismiss">
      <button
        v-if="workspace && sidebar && !detachedWindow"
        class="sidebar-dismiss"
        aria-label="收起侧栏"
        @click="toggleSidebar"
      />
    </Transition>
    <Transition name="sidebar">
      <aside
        v-if="workspace && sidebar && !detachedWindow"
        class="sidebar"
        aria-label="工作区侧栏"
        :inert="!sidebar"
        :aria-hidden="!sidebar"
      >
        <div class="sidebar-header">
          <div class="sidebar-brand-slot">
            <component
              :is="native ? 'div' : 'a'"
              class="brand"
              :href="native ? undefined : '/'"
              :aria-label="native ? undefined : '返回同页首页'"
              @click="returnHome"
            >
              <img src="/favicon-green.svg?v=3" alt="" />
            </component>
            <button
              type="button"
              class="icon-button sidebar-toggle"
              aria-label="收起侧栏"
              title="收起侧栏 · Ctrl B"
              @click="toggleSidebar"
            >
              <PanelLeftClose :size="17" :stroke-width="1.6" />
            </button>
          </div>
          <div class="sidebar-header-actions">
            <template v-for="view in extensionViews" :key="`header-${view.id}`">
              <component
                :is="view.header"
                v-if="view.header"
                :actions="viewActions[view.id]"
              />
            </template>
            <button
              type="button"
              class="icon-button"
              aria-label="打开关系图谱"
              title="关系图谱"
              :aria-pressed="activeId === GRAPH_TAB_ID"
              @click="store.openGraphTab()"
            >
              <GitFork :size="17" :stroke-width="1.6" />
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label="打开插件标签页"
              title="插件"
              :aria-pressed="activeId === PLUGINS_TAB_ID"
              @click="store.openPluginsTab()"
            >
              <Puzzle :size="17" :stroke-width="1.6" />
            </button>
          </div>
        </div>
        <SidebarNavigation
          v-slot="{ isVisible }"
          :items="sidebarNavigationItems"
          @open="closeButtonVisibilityMenus"
        >
          <button
            v-if="isVisible('repository')"
            type="button"
            class="sidebar-navigation-button"
            aria-label="仓库"
            title="仓库"
            aria-controls="sidebar-repository-panel"
            :aria-pressed="sidebarView === 'repository'"
            @click="sidebarView = 'repository'"
          >
            <FolderOpen :size="17" :stroke-width="1.8" aria-hidden="true" />
            <span :aria-hidden="sidebarView !== 'repository'">仓库</span>
          </button>
          <button
            v-if="isVisible('plan')"
            type="button"
            class="sidebar-navigation-button"
            aria-label="计划"
            title="计划"
            aria-controls="sidebar-plan-panel"
            :aria-pressed="sidebarView === 'plan'"
            @click="openCalendar()"
          >
            <CalendarDays :size="18" :stroke-width="1.6" aria-hidden="true" />
            <span :aria-hidden="sidebarView !== 'plan'">计划</span>
          </button>
          <template v-for="view in extensionViews" :key="view.id">
            <button
              v-if="view.sidebar && isVisible(view.id)"
              type="button"
              class="sidebar-navigation-button"
              :aria-label="view.label"
              :title="view.label"
              :aria-controls="`sidebar-${view.id}`"
              :aria-pressed="sidebarView === view.id"
              @click="openExtensionView(view.id)"
            >
              <component :is="view.icon" :size="18" :stroke-width="1.6" aria-hidden="true" />
              <span :aria-hidden="sidebarView !== view.id">{{ view.label }}</span>
            </button>
          </template>
        </SidebarNavigation>
        <div v-show="sidebarView === 'repository'" id="sidebar-repository-panel" class="sidebar-content">
          <div
            class="section-label"
            :class="{ 'drop-target': draggedEntry && dropFolder === '' }"
            @dragover="fileDragOver('', $event)"
            @dragleave="fileDragLeave('', $event)"
            @drop="fileDrop('', $event)"
          >
            <span v-if="draggedEntry">放到工作区根目录</span>
            <WorkspaceSwitcher
              v-else
              :active="sidebarView === 'repository' && !workspaceMenu && !modal && !settingsPanel"
              @open="closeButtonVisibilityMenus"
            />
            <div>
              <button
                type="button"
                class="icon-button"
                aria-label="查找文档"
                title="查找文档 · Ctrl K"
                @click="showModal('search')"
              >
                <Search :size="15" :stroke-width="1.6" />
              </button>
              <button
                class="icon-button"
                aria-label="新建文档"
                title="新建文档 · Ctrl N"
                :disabled="!workspace || workspace.readOnly || busy"
                @click="createNewDocument"
              >
                <SquarePen :size="15" :stroke-width="1.6" />
              </button>
            </div>
          </div>
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
              :selected-ids="selectedEntryIds"
              :context-selected="fileContextMenu?.file.id"
              :dragged-id="draggedEntry?.file.id"
              :drop-target="dropFolder"
              :can-drag="canDragEntry"
              @open="openTreeEntry"
              @select="selectFileTreeEntry"
              @context="openFileContextMenu"
              @context-blank="openDirectoryContextMenu"
              @drag-start="fileDragStart"
              @drag-end="fileDragEnd"
              @drag-over="fileDragOver"
              @drag-leave="fileDragLeave"
              @drop="fileDrop"
            />
            <div
              v-if="!noteCount"
              class="tree-empty"
              @contextmenu.prevent="openDirectoryContextMenu('', $event)"
            >
              你的下一页，<br />从一个新文档开始。
            </div>
          </div>
        </div>
        <SidebarPlan
          v-show="sidebarView === 'plan'"
          id="sidebar-plan-panel"
          :date="calendarDate"
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
                ? `${contextEntries.length} 个条目操作`
                : `${fileContextMenu.file.name} 操作`
            "
            :style="{ left: `${fileContextMenu.x}px`, top: `${fileContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <template v-if="multipleContextEntries">
              <div class="file-context-count" role="presentation">
                已选中 {{ contextEntries.length }} 个条目
              </div>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                :disabled="selectionDeleteDisabled"
                @click="fileContextAction('duplicate')"
              >
                <Copy :size="15" />为所选条目创建副本
              </button>
              <button role="menuitem" @click="fileContextAction('copy')">
                <Copy :size="15" />复制相对路径
              </button>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                @click="fileContextAction('copy-full-path')"
              >
                <Copy :size="15" />复制完整路径
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
                    ? '删除所选条目'
                    : store.isWeb
                      ? '删除所选文档'
                      : '将所选条目移入回收站'
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
                  <FileText :size="15" />在此新建文档
                </button>
                <button
                  v-if="!store.isWeb"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('folder')"
                >
                  <FolderPlus :size="15" />在此新建文件夹
                </button>
                <button
                  v-if="!store.isWeb"
                  role="menuitem"
                  :disabled="
                    fileMutationDisabled(fileContextMenu.file) ||
                    directoryHasManagedFile(fileContextMenu.file)
                  "
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />重命名文件夹
                </button>
              </template>
              <template v-else>
                <button
                  v-if="isMarkdown(fileContextMenu.file.path) || attachments"
                  role="menuitem"
                  @click="fileContextAction('open')"
                >
                  <FileText :size="15" />{{
                    isMarkdown(fileContextMenu.file.path) ? '打开文档' : '打开附件'
                  }}
                </button>
                <button
                  v-if="isMarkdown(fileContextMenu.file.path)"
                  role="menuitem"
                  @click="fileContextAction('open-new-tab')"
                >
                  <ExternalLink :size="15" />在新标签页中打开
                </button>
                <button
                  v-if="isMarkdown(fileContextMenu.file.path)"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />重命名文档
                </button>
                <button
                  v-else-if="attachments"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <Pencil :size="15" />重命名文件
                </button>
              </template>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                :disabled="fileMutationDisabled(fileContextMenu.file)"
                @click="fileContextAction('duplicate')"
              >
                <Copy :size="15" />创建副本
              </button>
              <button role="menuitem" @click="fileContextAction('copy')">
                <Copy :size="15" />复制相对路径
              </button>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                @click="fileContextAction('copy-full-path')"
              >
                <Copy :size="15" />{{
                  fileContextMenu.file.kind === 'directory' ? '复制文件夹路径' : '复制文件路径'
                }}
              </button>
              <template v-if="localNative && !mobile">
                <div class="menu-divider" role="separator" />
                <button role="menuitem" @click="fileContextAction('open-default')">
                  <ArrowUpRight :size="15" />使用默认应用打开
                </button>
                <button role="menuitem" @click="fileContextAction('reveal-entry')">
                  <ArrowUpRight :size="15" />在系统资源管理器中显示
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
                    store.isDemo ? '删除' : store.isWeb ? '删除在线文档' : '移入回收站'
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
            aria-label="目录操作"
            :style="{ left: `${directoryContextMenu.x}px`, top: `${directoryContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <button
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('document')"
            >
              <FileText :size="15" />新建文档
            </button>
            <button
              v-if="!store.isWeb"
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('folder')"
            >
              <FolderPlus :size="15" />新建文件夹
            </button>
          </div>
        </Teleport>
        <div class="sidebar-bottom">
          <div class="workspace-picker-wrap">
            <button
              class="workspace-picker"
              :aria-expanded="workspaceMenu"
              aria-controls="workspace-menu"
              aria-label="切换工作区"
              :title="workspace?.name ?? '选择工作区'"
              @click="toggleWorkspaceMenu"
            >
              <span class="workspace-avatar"><BookOpen :size="15" /></span>
              <span class="workspace-picker-text"
                ><strong>{{ workspace?.name ?? '选择工作区' }}</strong></span
              >
              <component :is="workspaceMenu ? ChevronUp : ChevronDown" :size="12" />
            </button>
            <div
              v-if="workspaceMenu"
              id="workspace-menu"
              class="dropdown compact-action-menu sidebar-popover workspace-dropdown"
            >
              <div class="workspace-menu-summary">
                <span class="workspace-menu-avatar"><BookOpen :size="16" /></span>
                <span class="workspace-menu-summary-text">
                  <strong>{{ workspace?.name ?? '选择工作区' }}</strong>
                  <small>{{
                    store.isDemo
                      ? '浏览器演示'
                      : store.isWeb
                        ? workspace?.readOnly
                          ? '在线工作区 · 只读'
                          : '在线工作区'
                        : '本地工作区'
                  }}</small>
                </span>
                <button
                  v-if="!store.isWeb && workspace"
                  class="workspace-menu-exit"
                  type="button"
                  aria-label="退出当前工作区"
                  title="退出当前工作区"
                  :disabled="busy"
                  @click="leaveWorkspace"
                ><LogOut :size="16" /></button>
              </div>
              <div class="menu-divider" />
              <button @click="openSettings()"><Settings2 :size="16" />设置</button>
              <button v-if="workspace" :disabled="workspace.readOnly || busy" @click="openImport"><ArrowDownToLine :size="16" />导入</button>
              <button v-if="workspace" :disabled="workspace.readOnly || busy" @click="workspaceMenu = false; templateDialog = true"><Files :size="16" />文档模板</button>
              <button @click="showObjects()"><Users :size="16" />工作区对象 · Level 2</button>
              <button
                v-if="workspace && localNative && !mobile"
                @click="
                  workspaceMenu = false;
                  store.reveal();
                "
              >
                <ExternalLink :size="16" />在资源管理器中显示
              </button>
              <button @click="openSettings('about')">
                <CircleHelp :size="16" />关于 Tano / 同页{{
                  updates.state.candidate ? ' · 有新版本' : ''
                }}
              </button>
              <div v-if="extensions.regions['account-note']" class="menu-divider" />
              <component  :is="extensions.regions['account-note']" v-if="extensions.regions['account-note']" :actions="extensionActions" />
              <div
                v-if="extensions.regions['mode-switch'] || (mobile && workspace) || (workspace && localNative) || extensions.regions['workspace-history'] || extensions.regions['sign-out']"
                class="menu-divider"
              />
              <component  :is="extensions.regions['mode-switch']" v-if="extensions.regions['mode-switch']" :actions="extensionActions" />
              <button
                v-if="mobile && workspace"
                @click="
                  workspaceMenu = false;
                  recyclePanel = true;
                "
              >
                <Trash2 :size="16" />手机回收站
              </button>
              <button v-if="workspace && assistant.available" @click="workspaceMenu = false; openAssistant()"><Bot :size="16" />Tano 助手</button>
              <button
                v-if="workspace && localNative"
                @click="
                  workspaceMenu = false;
                  agentPanel = true;
                "
              >
                <Bot :size="16" />与 Agent 一起工作
              </button>
              <component  :is="extensions.regions['workspace-history']" v-if="extensions.regions['workspace-history']" :actions="extensionActions" />
              <component  :is="extensions.regions['sign-out']" v-if="extensions.regions['sign-out']" :actions="extensionActions" />
              <component v-if="store.isWeb" :is="extensions.regions['workspace-menu']"  :actions="extensionActions" />
              <template v-else>
                <button
                  v-if="store.isDemo || mobile"
                  :disabled="busy"
                  @click="
                    workspaceMenu = false;
                    store.isDemo ? openSettings('about') : store.openWorkspace();
                  "
                >
                  <FolderOpen :size="16" />{{
                    store.isDemo ? '了解演示存储' : '打开默认手机空间'
                  }}
                </button>
                <component  :is="extensions.regions['local-menu-login']" v-if="extensions.regions['local-menu-login']" :actions="extensionActions" />
                <button v-if="mobile" :disabled="busy" @click="showModal('workspace')">
                  <FolderPlus :size="16" />新建手机空间
                </button>
                <template v-if="store.recent.length || (!store.isDemo && !mobile)">
                  <div class="menu-divider" />
                  <div class="workspace-recent-heading">
                    <span class="recent-label">最近工作空间</span>
                    <button
                      v-if="!store.isDemo && !mobile"
                      type="button"
                      class="workspace-recent-open"
                      aria-label="打开新的本地文件夹"
                      title="打开新的本地文件夹"
                      :disabled="busy"
                      @click="
                        workspaceMenu = false;
                        store.openWorkspace();
                      "
                    ><FolderPlus :size="16" :stroke-width="1.6" /></button>
                  </div>
                  <button
                    v-for="item in store.recent.slice(0, 5)"
                    :key="item.id"
                    :title="item.path"
                    :disabled="busy"
                    :aria-current="item.id === workspace?.id ? 'true' : undefined"
                    @click="
                      workspaceMenu = false;
                      store.openWorkspace(item.path);
                    "
                  >
                    <span class="workspace-list-avatar">{{ item.name.slice(0, 1) }}</span>
                    <span class="recent-name">{{ item.name }}</span>
                    <Check v-if="item.id === workspace?.id" :size="15" />
                  </button>
                </template>
              </template>
            </div>
          </div>
          <button
            class="icon-button sidebar-help"
            aria-label="帮助与快捷键"
            title="帮助与快捷键"
            @click="openSettings('about')"
          >
            <CircleHelp :size="17" />
          </button>
        </div>
        <div
          v-if="!mobile"
          class="sidebar-resize-handle"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          :aria-valuenow="sidebarWidth ?? defaultSidebarWidth()"
          :aria-valuemin="SIDEBAR_MIN_WIDTH"
          :aria-valuemax="sidebarWidthLimit()"
          tabindex="0"
          @pointerdown="startSidebarResize"
          @pointermove="moveSidebarResize"
          @pointerup="finishSidebarResize"
          @pointercancel="finishSidebarResize"
          @lostpointercapture="finishSidebarResize"
          @keydown="resizeSidebarWithKeyboard"
        />
      </aside>
    </Transition>

    <div class="main-column">
      <div v-if="workspace && compactPanes && (!native || mobile)" class="workspace-tabbar">
        <button v-if="!detachedWindow && !sidebar && activeId === GRAPH_TAB_ID"
          class="icon-button graph-sidebar-toggle" type="button" aria-label="展开侧栏" title="展开侧栏 · Ctrl B" @click="toggleSidebar">
          <PanelLeftOpen :size="17" />
        </button>
        <DesktopTabs :file-drag="tabFileDrag" @files-dropped="fileDragEnd" @new-tab="store.createBlankTab()" @new-document="createNewDocument" />
      </div>

      <WorkspacePanes v-if="workspace" :compact="compactPanes" :class="{ 'workspace-native-tabs': native && !mobile && !compactPanes }">
        <template #default="{ pane, rect, document: active }">
          <div v-if="!compactPanes" class="workspace-tabbar" :data-tab-pane-id="pane.id">
            <button v-if="native && !mobile && !detachedWindow && !sidebar && rect.top === 0 && rect.left === 0"
              class="desktop-sidebar-toggle" type="button" aria-label="展开侧栏" title="展开侧栏 · Ctrl B" @click="toggleSidebar">
              <PanelLeftOpen :size="17" />
            </button>
            <button v-if="(!native || mobile) && !detachedWindow && !sidebar && pane.activeId === GRAPH_TAB_ID"
              class="icon-button graph-sidebar-toggle" type="button" aria-label="展开侧栏" title="展开侧栏 · Ctrl B" @click="toggleSidebar">
              <PanelLeftOpen :size="17" />
            </button>
            <DesktopTabs :pane-id="pane.id" :detachable="native && !mobile" :file-drag="tabFileDrag"
              @files-dropped="fileDragEnd" @new-tab="store.focusPane(pane.id); store.createBlankTab()"
              @new-document="store.focusPane(pane.id); createNewDocument()" @detach-tab="detachTab" />
            <div v-if="native && !mobile" v-show="rect.top === 0" class="workspace-window-drag" title="拖动窗口"
              @mousedown="dragPaneWindow" @dblclick="maximizePaneWindow" />
          </div>
          <ButtonVisibilityGroup
            v-if="!detachedWindow && pane.activeId !== GRAPH_TAB_ID"
            v-slot="{ isVisible }"
            :items="topbarVisibilityItems(pane.activeId, !!active, pane.id === store.activePaneId)"
            preference-key="tano.preference.documentHiddenTools"
            tag="header"
            group-class="topbar"
            label="文档顶部栏"
            menu-label="顶部栏显示设置"
            @open="closeButtonVisibilityMenus"
          >
            <div
              v-if="isVisible('back') || isVisible('forward') || (!sidebar && !(native && !mobile && workspace))"
              class="topbar-navigation" role="group" aria-label="文档导航"
            >
              <button
                v-if="!sidebar && !(native && !mobile && workspace)"
                type="button"
                class="icon-button"
                aria-label="展开侧栏"
                title="展开侧栏 · Ctrl B"
                @click="toggleSidebar"
              >
                <PanelLeftOpen :size="18" />
              </button>
              <button
                v-if="isVisible('back')"
                type="button"
                class="icon-button"
                aria-label="后退"
                title="后退"
                :disabled="!store.canNavigateHistory(-1, pane.activeId)"
                @click="store.navigateHistory(-1, pane.id)"
              >
                <ArrowLeft :size="16" :stroke-width="1.6" />
              </button>
              <button
                v-if="isVisible('forward')"
                type="button"
                class="icon-button"
                aria-label="前进"
                title="前进"
                :disabled="!store.canNavigateHistory(1, pane.activeId)"
                @click="store.navigateHistory(1, pane.id)"
              >
                <ArrowRight :size="16" :stroke-width="1.6" />
              </button>
            </div>
            <nav v-if="isVisible('breadcrumb') && pane.activeId !== CALENDAR_TAB_ID" class="breadcrumb" aria-label="当前位置">
              <span class="breadcrumb-workspace"
                ><BookOpen :size="14" />{{ workspace?.name ?? 'Tano' }}</span
              ><template v-if="pane.activeId === PLUGINS_TAB_ID"><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current">插件</span></template
              ><template v-for="view in extensionViews.filter(view => view.id === pane.activeId)" :key="view.id"><ChevronRight :size="12" /><component :is="view.icon" :size="14" /><span class="breadcrumb-current">{{ view.label }}</span></template
              ><template v-for="(part, index) in (active?.path.split('/') ?? [])" :key="index"
                ><ChevronRight :size="12" /><component
                  :is="index === active!.path.split('/').length - 1 ? FileText : FolderOpen"
                  :size="14"
                /><span :class="{ 'breadcrumb-current': index === active!.path.split('/').length - 1 }">{{
                  index === active!.path.split('/').length - 1 ? basename(active!.path).replace(/\.(md|markdown)$/i, '') : part
                }}</span></template
              >
            </nav>
            <div class="topbar-right">
              <component  :is="extensions.regions['editing-status']" v-if="isVisible('editing-status') && pane.id === store.activePaneId && extensions.regions['editing-status']" :actions="extensionActions" />
              <span
                v-if="isVisible('workspace-status') && workspaceStatusLabel"
                :class="store.isDemo ? 'demo-badge' : 'local-badge'"
              >
                <LockKeyhole v-if="workspace?.readOnly" :size="14" />
                <span v-else-if="store.isDemo" />
                <Globe2 v-else-if="store.isWeb" :size="14" />
                {{ workspaceStatusLabel }}
              </span>
              <div v-if="pane.activeId === CALENDAR_TAB_ID && calendarToolItems.some(item => isVisible(item.id))" class="calendar-topbar-controls" role="group" aria-label="日历导航">
                <span v-if="isVisible('calendar-period')" class="calendar-topbar-period">{{ calendarPeriod }}</span>
                <button v-if="isVisible('calendar-today')" type="button" class="calendar-topbar-today" @click="calendarDate = new Date()">今天</button>
                <button v-if="isVisible('calendar-previous')" type="button" class="icon-button" aria-label="上一时段" title="上一时段" @click="moveCalendarPeriod(-1)"><ChevronLeft :size="17" /></button>
                <button v-if="isVisible('calendar-next')" type="button" class="icon-button" aria-label="下一时段" title="下一时段" @click="moveCalendarPeriod(1)"><ChevronRight :size="17" /></button>
                <div v-if="isVisible('calendar-mode')" class="calendar-view-picker" @keydown.esc.stop.prevent="calendarModeOpen = false">
                  <button
                    type="button"
                    class="calendar-topbar-mode"
                    aria-label="切换日历视图"
                    title="Ctrl + 滚轮：切换日历视图"
                    aria-haspopup="menu"
                    :aria-expanded="calendarModeOpen"
                    @click="calendarModeOpen = !calendarModeOpen"
                  >{{ calendarModeLabel }}<ChevronDown :size="14" /></button>
                  <div v-if="calendarModeOpen" class="calendar-view-menu" role="menu" aria-label="日历视图">
                    <button
                      v-for="option in calendarModeOptions"
                      :key="option.mode"
                      type="button"
                      role="menuitemradio"
                      :aria-checked="calendarMode === option.mode"
                      @click="selectCalendarMode(option.mode)"
                    >{{ option.label }}<Check v-if="calendarMode === option.mode" :size="15" /></button>
                  </div>
                </div>
                <button v-if="isVisible('calendar-events')" type="button" class="calendar-topbar-events" title="查看和管理事件" @click="managePlanEvents"><CalendarDays :size="15" />管理事件</button>
              </div>
              <template v-if="active">
                <div v-if="documentToolItems.some(item => isVisible(item.id))" class="document-tool-buttons">
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
                    :disabled="editing.isManaging(pane.activeId) || (pane.id === store.activePaneId && editing.activeBusy)"
                    :aria-label="paneSource(pane.activeId) ? '返回编辑' : '切换源码模式'"
                    :aria-pressed="paneSource(pane.activeId)"
                    :title="
                      editing.isManaging(pane.activeId)
                        ? '当前编辑扩展不支持切换源码模式'
                        : paneSource(pane.activeId)
                          ? '返回编辑'
                          : '切换源码模式'
                    "
                    @click="sourceModes[pane.activeId] = !paneSource(pane.activeId)"
                  >
                    <Code2 :size="17" />
                  </button>
                  <button
                    v-if="attachments && isVisible('attachments')"
                    type="button"
                    class="icon-button"
                    aria-label="导入图片或附件"
                    title="导入图片或附件"
                    :disabled="paneReadonly(active!) || attachmentBusy"
                    @click="pickFilesFor(pane.id, active!)"
                  ><Paperclip :size="17" /></button>
                </div>
                <div class="menu-wrap">
                  <button
                    class="icon-button"
                    aria-label="文档操作"
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
                    <button
                      type="button"
                      :disabled="editorReadonly || !documentUndoAvailable"
                      @click="undoDocument"
                    >
                      <Undo2 :size="15" />撤销<span class="menu-shortcut">Ctrl Z</span>
                    </button>
                    <button
                      type="button"
                      :disabled="editorReadonly || !documentRedoAvailable"
                      @click="redoDocument"
                    >
                      <Redo2 :size="15" />重做<span class="menu-shortcut">Ctrl Y</span>
                    </button>
                    <button
                      @click="
                        menu = false;
                        store.flush();
                      "
                    >
                      <CheckCheck :size="15" />立即保存<span class="menu-shortcut">Ctrl S</span>
                    </button>
                    <button
                      class="danger-text"
                      :disabled="editorReadonly || editing.isManaging(pane.activeId) || (pane.id === store.activePaneId && editing.activeBusy)"
                      @click="removeDocument()"
                    >
                      <Trash2 :size="15" />{{
                        store.isDemo ? '删除演示文档' : store.isWeb ? '删除在线文档' : '移入回收站'
                      }}
                    </button>
                    <div class="menu-divider" role="separator" />
                    <button
                      type="button"
                      class="page-toggle-menu-item"
                      role="switch"
                      :aria-checked="!limitPageWidth"
                      :disabled="!pageWidthWritable"
                      title="切换页面内容宽度"
                      @click="setLimitPageWidth(!limitPageWidth)"
                    >
                      <MoveHorizontal :size="15" />全宽<span
                        class="menu-switch"
                        :class="{ on: !limitPageWidth }"
                        aria-hidden="true"
                        ><span
                      /></span>
                    </button>
                    <div class="menu-divider" role="separator" />
                    <button
                      type="button"
                      class="page-toggle-menu-item"
                      role="switch"
                      :aria-checked="pageLocked"
                      :title="pageLocked ? '退出阅读模式' : '锁定后进入阅读模式'"
                      @click="togglePageLock"
                    >
                      <LockKeyhole :size="15" />锁定页面<span
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
                      <Archive :size="15" />版本历史<span class="menu-beta">Beta</span>
                    </button>
                    <button
                      @click="
                        menu = false;
                        historyPage = 'updates';
                        historyPanel = true;
                      "
                    >
                      <Clock3 :size="15" />更新历史
                    </button>
                    <div class="menu-divider" role="separator" />
                    <DocumentExportMenu :disabled="exportBusy" @select="exportDocument" />
                    <button type="button" :disabled="workspace?.readOnly || busy" @click="openImport"><ArrowDownToLine :size="15" />导入</button>
                    <button type="button" :disabled="workspace?.readOnly || busy" @click="templateDialog = true"><Files :size="15" />文档模板</button>
                  </div>
                </div>
              </template>
            </div>
          </ButtonVisibilityGroup>
          <KeepAlive v-if="pane.tabs.includes(GRAPH_TAB_ID)">
            <RelationGraph v-if="workspace && pane.activeId === GRAPH_TAB_ID" :key="`${workspace.id}:${workspace.path}`" />
          </KeepAlive>

          <CalendarView
            v-if="workspace && pane.activeId === CALENDAR_TAB_ID"
            :date="calendarDate"
            :mode="calendarMode"
            @select-mode="selectCalendarMode"
            @visible-month="calendarDate = $event"
            @visible-year="calendarDate = $event"
            @visible-timeline="calendarDate = $event"
            @select-date="showCalendarDay"
            @select-month="showCalendarMonth"
            @select-event="showPlanEvent"
          />

          <template v-for="view in extensionViews" :key="view.id">
            <component v-if="pane.activeId === view.id" :is="view.component" :actions="viewActions[view.id]" />
          </template>

          <main
            v-if="workspace && pane.tabs.includes(PLUGINS_TAB_ID)"
            v-show="pane.activeId === PLUGINS_TAB_ID"
            class="plugins-tab-page"
          >
            <div class="plugins-tab-content">
              <p v-if="!store.capabilities.features.objectReferences" class="tool-level-notice">
                Level 2 已关闭，插件对象和关系暂时只读。可在工作区设置中重新启用。
              </p>
              <p v-else-if="workspace.readOnly" class="tool-level-notice">
                此工作区为只读，无法修改对象和关系。
              </p>
              <PluginInstaller @objects="showObjects()" />
            </div>
          </main>

          <template v-if="active">
            <div :key="active.id" :ref="el => setPaneElement('scroll', pane.id, el)" class="document-layout"
              :data-toolbar-dock="pane.id === store.activePaneId && !paneSource(pane.activeId) && !paneReadonly(active!) ? toolbarMode : undefined"
              @scroll.passive="scheduleActiveHeading">
              <main class="document-main">
                <EditorTools
                  v-model:mode="toolbarMode"
                  :assistant="assistant.available"
                  @assistant="openAssistant(pane.id, active!.id)"
                  annotation
                  :todo="store.capabilities.features.objectReferences && !paneReadonly(active!) && !editing.isManaging(active!.id)"
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
                  <template v-if="detachedWindow || paneSource(pane.activeId)" #trailing>
                    <button v-if="paneSource(pane.activeId) && store.capabilities.features.objectReferences" type="button" class="icon-button" aria-label="从选区创建 Todo" title="从选区创建 Todo" :disabled="paneReadonly(active!) || !paneSourceSelections[pane.id] || editing.isManaging(active!.id)" @mousedown.prevent @click="beginSelectionTodo(pane.id, active!.id)"><ListTodo :size="17" /></button>
                    <ButtonVisibilityGroup
                      v-if="detachedWindow"
                      v-slot="{ isVisible }"
                      :items="documentToolItems"
                      preference-key="tano.preference.documentHiddenTools"
                      group-class="detached-editor-actions document-tool-buttons"
                      label="文档工具"
                      menu-label="文档工具按钮显示设置"
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
                        :aria-label="paneSource(pane.activeId) ? '返回编辑' : '切换源码模式'"
                        :aria-pressed="paneSource(pane.activeId)"
                        :title="paneSource(pane.activeId) ? '返回编辑' : '切换源码模式'"
                        @click="sourceModes[pane.activeId] = !paneSource(pane.activeId)"
                      ><Code2 :size="17" /></button>
                      <button
                        v-if="attachments && isVisible('attachments')"
                        type="button"
                        class="icon-button"
                        aria-label="导入图片或附件"
                        title="导入图片或附件"
                        :disabled="paneReadonly(active!) || attachmentBusy"
                        @click="pickFilesFor(pane.id, active!)"
                      ><Paperclip :size="17" /></button>
                    </ButtonVisibilityGroup>
                  </template>
                </EditorTools>

                <component  :is="extensions.regions['editing-panel']" v-if="pane.id === store.activePaneId && extensions.regions['editing-panel']" :actions="extensionActions" />
                <div v-if="active.conflict" class="conflict-banner" role="alert">
                  <AlertTriangle :size="19" />
                  <div>
                    <strong>这一页有两份新的想法</strong>
                    <p>外部修改与你的修改重叠。你的内容已保存为 conflict 副本，原文件保留外部版本。</p>
                    <button @click="store.resolveConflict(active!, true)">
                      打开我的副本 <ArrowUpRight :size="14" /></button
                    ><button @click="store.resolveConflict(active!, false)">载入磁盘版本</button>
                    <button
                      @click="
                        selectedDiff = {
                          title: active.path,
                          before: active.conflict.disk.content,
                          after: active.content,
                          beforeLabel: '磁盘版本',
                          afterLabel: '我的副本',
                        }
                      "
                    >
                      比较两个版本
                    </button>
                  </div>
                </div>
                <div v-else-if="active.missing || active.error" class="conflict-banner" role="alert">
                  <AlertTriangle :size="19" />
                  <div>
                    <strong>{{
                      active.missing ? '文件已在工作文件夹中移除' : '这次保存没有完成'
                    }}</strong>
                    <p>{{ active.error ?? '编辑器中的内容仍然保留，你可以把它另存为一个新文档。' }}</p>
                    <button @click="showModal('saveAs')">另存副本 <ArrowUpRight :size="14" /></button
                    ><button v-if="!active.missing" @click="store.flush()">重试保存</button>
                  </div>
                </div>
                <div
                  :ref="el => setPaneElement('editor', pane.id, el)"
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
                  @mousedown.self="!paneSource(pane.activeId) && paneEditors.get(pane.id)?.focusTrailingParagraph($event)"
                  @contextmenu="openPageContextMenu"
                >
                  <DocumentTitle
                    v-if="workspace && showPageTitle"
                    :key="`${workspace.id}:${active.id}`"
                    :workspace-id="workspace.id"
                    :document-id="active.id"
                    :path="active.path"
                    :title-source="pageTitleSource"
                    :model-value="active.content"
                    :files="workspace.files"
                    :readonly="
                      paneReadonly(active!) ||
                      active.missing ||
                      !!editing.active ||
                      editing.activeBusy
                    "
                    :rename="renameDocumentTitle"
                    @update:model-value="store.editDocument(active!.id, $event)"
                    @enter="insertBlockBelowTitle"
                  />
                  <SourceEditor
                    v-if="paneSource(pane.activeId)"
                    :key="active.id"
                    :ref="el => setPaneElement('source', pane.id, el)"
                    :model-value="active.content"
                    :readonly="paneReadonly(active!)"
                    :local-native="!!attachments"
                    :comment-anchors="commentAnchors[active.id]"
                    @selection-change="paneSourceSelections[pane.id] = $event"
                    @update:model-value="store.editDocument(active!.id, $event)"
                    @files="
                      (files, requireImage, position) =>
                        insertSourceFiles(files, position, requireImage, active, pane.id)
                    "
                  />
                  <MarkdownEditor
                    v-else
                    :key="`${active.id}:${active.id === store.activeId ? editing.active?.key ?? 'local' : 'local'}`"
                    :ref="el => setPaneEditor(pane.id, el)"
                    :document-id="active.id"
                    :readonly="paneReadonly(active!)"
                    :open-links-on-tap="mobile"
                    :reveal-markdown="revealMarkdown"
                    :capabilities="store.capabilities"
                    :reference-targets="store.referenceTargets"
                    :preferences="editorPreferences"
                    :extension="active.id === store.activeId ? editing.active?.extension : undefined"
                    :model-value="active.content"
                    :table-layouts="active.tableLayout?.file.tables"
                    :comment-anchors="commentAnchors[active.id]"
                    :resolve-image="reference => attachments ? attachments.imageUrl(workspace, active!.path, reference) : safeRemoteImage(reference)"
                    :resource-revision="resourceRevision"
                    :import-file="attachments ? (file, image) => uploadFile(file, image, active) : undefined"
                    @update:model-value="store.editDocument(active!.id, $event)"
                    @table-layout-change="store.editTableLayout(active!.id, $event)"
                    @error="store.report"
                    @open-link="openDocumentLink"
                    @open-wiki-link="openWikiLink"
                    @open-reference="openReference"
                    @edit-source="sourceModes[pane.activeId] = true"
                    @selection-change="paneSelections[pane.id] = $event"
                  />
                  <ReferenceConnections class="document-references" :identity="{ type: 'document', id: active.id }" @open="openReference" />
                  <DocumentComments
                    v-if="workspace"
                    :ref="el => setPaneComments(pane.id, el)"
                    :workspace-id="workspace.id"
                    :document="active"
                    :assistant="assistant.available"
                    @assistant="discussWithAssistant(pane.id, active!.id, $event)"
                    :readonly="paneReadonly(active!)"
                    :author="extensions.commentAuthor?.() ?? { id: 'local', name: '本机用户' }"
                    :capture-selection="() => capturePaneCommentSelection(pane.id, active!.id)"
                    :focus-anchor="anchor => focusPaneComment(pane.id, active!.id, anchor)"
                    :editor-element="paneEditorScrolls.get(pane.id)"
                    :geometry="anchors => paneCommentGeometry(pane.id, active!.id, anchors)"
                    @annotations="commentAnchors[active!.id] = $event"
                  />
                </div>
              </main>
            </div>

          </template>

          <main v-else-if="workspace && pane.activeId !== GRAPH_TAB_ID && pane.activeId !== PLUGINS_TAB_ID && pane.activeId !== CALENDAR_TAB_ID && !extensionViews.find(view => view.id === pane.activeId)" class="workspace-no-tabs">
            <EmptyEditor
              :create-disabled="busy || workspace.readOnly || updateLock"
              @create="createNewDocument"
              @open="showModal('newTab')"
              @search="showModal('search')"
            />
          </main>

            <aside
              v-if="active && !assistant.opened && !detachedWindow && pane.id === store.activePaneId && (panel !== 'outline' || showOutline)"
              class="inspector"
              :class="{
                'inspector-outline': panel === 'outline',
                'inspector-hover-outline':
                  panel === 'outline' && hoverOutline && !outlinePinned && !outlineSearchOpen,
                'inspector-activity': panel === 'activity',
              }"
              :aria-label="panel === 'outline' ? '文档目录' : '文档动态'"
            >
              <div class="inspector-surface">
                <div v-if="panel === 'activity'" class="inspector-tabs">
                  <button @click="panel = 'outline'"><List :size="14" />大纲</button
                  ><button class="active" @click="panel = 'activity'">
                    <History :size="14" />动态
                  </button>
                </div>
                <div v-if="panel === 'outline'" class="outline-controls">
                  <span>文档大纲</span>
                  <button
                    class="outline-control"
                    type="button"
                    aria-label="搜索大纲标题"
                    title="搜索大纲标题"
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
                    :aria-label="outlinePinned ? '取消固定大纲' : '固定大纲'"
                    :title="outlinePinned ? '取消固定大纲' : '固定大纲'"
                    :aria-pressed="outlinePinned"
                    @click="toggleOutlinePin"
                  >
                    <Pin :size="15" :fill="outlinePinned ? 'currentColor' : 'none'" />
                  </button>
                  <button
                    class="outline-control"
                    type="button"
                    aria-label="关闭目录"
                    title="关闭目录"
                    @click="showOutline = false"
                  >
                    <X :size="15" />
                  </button>
                </div>
                <div v-if="panel === 'outline' && outlineSearchOpen" class="outline-search">
                  <Search :size="14" aria-hidden="true" />
                  <input
                    ref="outlineSearchInput"
                    v-model="outlineSearch"
                    type="search"
                    aria-label="搜索当前文档标题"
                    placeholder="搜索标题"
                    autocomplete="off"
                    @keydown.enter="visibleOutline[0] && jumpToHeading(visibleOutline[0].index)"
                    @keydown.esc.stop.prevent="toggleOutlineSearch"
                  />
                </div>
                <nav v-if="panel === 'outline'" class="outline" aria-label="文档大纲">
                  <button
                    v-for="{ heading, index } in visibleOutline"
                    :key="index"
                    :class="{
                      'outline-active': activeHeading === index,
                    }"
                    :style="{
                      '--outline-indent': `${Math.max(0, heading.level - 2) * 12}px`,
                      '--outline-marker-width': `${Math.max(9, 20 - heading.level * 2)}px`,
                    }"
                    :aria-label="`跳转到${heading.text}`"
                    :aria-current="activeHeading === index ? 'location' : undefined"
                    @click="jumpToHeading(index)"
                  >
                    <span class="outline-marker" aria-hidden="true" />
                    <span class="outline-text">{{ heading.text }}</span>
                  </button>
                  <p v-if="!outline.length" class="panel-empty">
                    <span class="outline-empty-marker" aria-hidden="true" />
                    写下一个标题，<br />让思路有迹可循。
                  </p>
                  <p v-else-if="!visibleOutline.length" class="outline-no-results" role="status">
                    没有匹配的标题
                  </p>
                </nav>
                <div v-else class="activity-list">
                  <p class="activity-explainer">这个会话中的文件变化。外部编辑者身份暂不可识别。</p>
                  <button v-if="localNative" class="secondary-button" @click="agentPanel = true">
                    <Bot :size="14" />工作区指引与 MCP 活动
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
                        查看差异
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
                      ? '浏览器本地存储'
                      : store.isWeb
                        ? '定期检查服务器修改'
                        : '正在监听工作文件夹'
                  }}
                </div>
              </div>
            </aside>
        </template>
      </WorkspacePanes>
      <main v-else-if="!workspace" class="welcome">
        <div class="welcome-mark"><img src="/favicon-green.svg?v=3" alt="Tano 标志" /></div>
        <h1>
          <span
            v-for="(part, index) in welcomeSloganParts"
            :key="index"
            :class="{ 'welcome-latin': part.latin }"
            >{{ part.text }}</span
          >
        </h1>
        <p>
          {{
            store.isWeb
              ? '为不同的项目创建工作区，文档会自动保存到服务器。'
              : mobile
                ? '把工作空间带在身边，离线也能继续写作。'
                : '打开一个文件夹，让你的 Markdown 成为共同的语言。'
          }}
        </p>
        <div class="welcome-actions">
          <button class="secondary-button" @click="plans.view = 'personal'; personalHome = true">
            <CalendarDays :size="18" />个人计划
          </button>
          <button
            class="primary-button"
            :disabled="busy"
            @click="store.isWeb ? showModal('workspace') : store.openWorkspace()"
          >
            <FolderOpen :size="18" />{{
              busy
                ? '正在打开…'
                : store.isWeb
                  ? '创建工作区'
                  : mobile
                    ? '打开手机工作空间'
                    : '本地仓库'
            }}<ArrowRight :size="17" />
          </button>
          <component  :is="extensions.regions['welcome-login']" v-if="extensions.regions['welcome-login']" :actions="extensionActions" />
        </div>
        <div
          v-if="!workspace && store.recent.length"
          class="recent-spaces"
          aria-label="最近工作空间"
        >
          <span class="recent-label">最新打开仓库</span>
          <button
            v-for="item in store.recent.slice(0, 4)"
            :key="item.id"
            :disabled="busy"
            @click="store.openWorkspace(item.path)"
          >
            <FolderOpen :size="16" /><span
              ><strong>{{ item.name }}</strong
              ><small>{{
                store.isWeb ? '在线工作区' : mobile ? '保存在这台设备' : item.path
              }}</small></span
            ><ArrowRight :size="14" />
          </button>
        </div>
      </main>


            <Teleport to="body">
              <div
                v-if="pageContextMenu"
                ref="pageContextMenuElement"
                class="dropdown compact-action-menu page-context-menu"
                role="menu"
                aria-label="页面显示选项"
                :style="{ left: `${pageContextMenu.x}px`, top: `${pageContextMenu.y}px` }"
                @keydown="pageContextKeydown"
              >
                <button
                  type="button"
                  role="menuitemcheckbox"
                  :aria-checked="limitPageWidth"
                  :disabled="!pageWidthWritable"
                  @click="togglePageOption('width')"
                >
                  <Ruler :size="15" />限制行宽<Check
                    v-if="limitPageWidth"
                    class="page-context-check"
                    :size="14"
                  />
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  :aria-checked="showPageTitle"
                  @click="togglePageOption('title')"
                >
                  <Heading1 :size="15" />页面内标题<Check
                    v-if="showPageTitle"
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
                  <List :size="15" />显示目录<Check
                    v-if="showOutline"
                    class="page-context-check"
                    :size="14"
                  />
                </button>
              </div>
            </Teleport>
    </div>

    <AssistantPanel v-if="workspace && assistant.available && assistant.opened" @open-reference="openReference" />
    <ImportPanel v-if="importPanel && workspace" :key="workspace.id" :attachments="attachments" :records="importRecords"
      @close="importPanel = false" @completed="importRecords.unshift($event)" />
    <TemplateDialog v-if="templateDialog && workspace" :key="workspace.id" :source="store.active?.content" @close="templateDialog = false" />
    <component  :is="extensions.regions['sync-dialog']" v-if="extensions.regions['sync-dialog']" :actions="extensionActions" />
    <MobileRecycle
      v-if="mobile && recyclePanel && workspace"
      :workspace-id="workspace.id"
      @close="recyclePanel = false"
    />
    <AgentPanel
      v-if="agentPanel && workspace && localNative"
      :workspace-id="workspace.id"
      @close="agentPanel = false"
    />
    <DiffDialog v-if="selectedDiff" v-bind="selectedDiff" @close="selectedDiff = undefined" />
    <component  :is="extensions.regions['history-dialog']" v-if="extensions.regions['history-dialog']" :actions="extensionActions" />
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
      v-show="objectPanel"
      :open="objectPanel"
      :selected-id="selectedObjectId"
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
    <PlanDetailPanel v-if="planDetail" :key="`${planDetail.source?.scope}:${planDetail.source?.id}:${planDetail.object.id}`" :record="planDetail" @close="planDetail = undefined" @open-reference="openPlanReference" @open-record="planDetail = $event" />
    <SelectionTodoDialog v-if="selectionTodo" :session="selectionTodo" @close="selectionTodo = undefined" @open-task="selectionTodo = undefined; showPlanEvent($event)" />
    <PersonalPlanDialog v-if="personalHome" :date="calendarDate" @close="personalHome = false" @select-date="calendarDate = $event" @select-event="showPlanEvent" />
    <template v-for="view in extensionViews" :key="view.id">
      <component :is="view.overlay" v-if="workspace && view.overlay" :actions="viewActions[view.id]" />
    </template>
    <SettingsPanel
      v-if="settingsPanel"
      :workspace="workspace"
      :extra-pages="extensions.settingsPages"
      :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
      :native="native"
      :mobile="mobile"
      :default-source="defaultSource"
      :theme="theme"
      :visual-font-choice="visualFontChoice"
      :custom-font-name="customFontName"
      :reveal-markdown="revealMarkdown"
      :toolbar-mode="toolbarMode"
      :show-page-title="showPageTitle"
      :page-title-source="pageTitleSource"
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
      @update:editor-preferences="editorPreferences = $event"
      @close="settingsPanel = false"
      @update:default-source="defaultSource = $event"
      @update:theme="theme = $event"
      @update:visual-font-choice="visualFontChoice = $event"
      @update:custom-font-name="customFontName = $event"
      @update:reveal-markdown="revealMarkdown = $event"
      @update:toolbar-mode="toolbarMode = $event"
      @update:show-page-title="showPageTitle = $event"
      @update:page-title-source="pageTitleSource = $event"
      @update:visual-font-size="visualFontSize = $event"
      @update:source-font-size="sourceFontSize = $event"
      @action="settingsAction"
    />
    <div v-if="fatal || store.sessionError" class="error-toast" role="alert">
      <AlertTriangle :size="18" /><span>{{ fatal || store.sessionError }}</span
      ><button v-if="fatal" class="icon-button" aria-label="关闭通知" @click="fatal = ''">
        <X :size="16" />
      </button>
    </div>

    <NewTabPicker v-if="modal === 'newTab'" @close="modal = ''" @new-document="createNewDocument" />
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
            aria-label="关闭弹窗"
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
              aria-label="搜索文档名称和正文"
              placeholder="搜索文件名、路径或正文…"
              @keydown.enter="searchResults[0] && (store.openFile(searchResults[0]), (modal = ''))"
            /><button
              type="button"
              aria-label="关闭搜索"
              title="关闭搜索"
              @click="modal = ''"
            >
              <X :size="18" />
            </button>
          </div>
          <div v-if="input.trim()" class="search-results">
            <button
              v-for="file in searchResults"
              :key="file.id"
              @click="
                store.openFile(file);
                modal = '';
              "
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
              {{ searching ? '正在查找…' : searchError || '没有找到这篇文档，试试其他关键词。' }}
            </p>
          </div></template
        >
        <form v-else @submit.prevent="submitModal">
          <template v-if="modal === 'delete'"
            ><p class="modal-description">
              {{
                store.isDemo
                  ? '将删除浏览器中的演示文档，此操作无法在应用内撤销。'
                  : store.isWeb
                    ? '将从在线工作区移除所选文件。服务端按配置保留版本历史。'
                    : mobile
                      ? '文件将保留在手机回收站。可从工作空间菜单恢复副本。'
                      : '文件将移入系统回收站，你可以在回收站中恢复。'
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
                  >还有 {{ modalDeleteEntries.length - 6 }} 项…</span
                >
              </span>
            </div></template
          ><template v-else
            ><p class="modal-description">
              {{
                modal === 'rename'
                  ? '更换名称，文件的身份保持不变。'
                  : modal === 'saveAs'
                    ? '把当前编辑内容保存为独立的 Markdown 文件。'
                    : '从一个名字开始，把想法留在这一页。'
              }}
            </p>
            <label for="file-name">{{
              modal === 'workspace'
                ? '工作空间名称'
                : modal === 'rename' && modalTarget?.kind === 'directory'
                  ? '文件夹路径'
                  : modal === 'rename' && modalTarget && !isMarkdown(modalTarget.path)
                    ? '文件路径'
                    : '文档路径'
            }}</label
            ><input
              id="file-name"
              ref="inputEl"
              v-model="input"
              :placeholder="
                modal === 'workspace'
                  ? '例如：研究笔记'
                  : modal === 'rename' && modalTarget?.kind === 'directory'
                    ? '例如：灵感'
                    : '例如：我的新想法.md'
              "
              autocomplete="off"
              :maxlength="modal === 'workspace' ? 120 : 220"
            />
            <p class="input-hint">
              {{
                modal === 'workspace'
                  ? store.isWeb
                    ? '工作区及文档保存在服务器；不会自动复制到本地文件夹。'
                    : mobile
                      ? '保存在当前手机应用内。'
                      : '本地文件夹是此工作区的唯一保存源。'
                  : store.isWeb
                    ? '可使用「项目/新想法.md」创建文档及所在目录。'
                    : '相对于工作空间，可使用已有目录，例如「项目/新想法.md」。'
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
              取消</button
            ><button
              class="primary-button"
              :class="{ destructive: modal === 'delete' }"
              :disabled="modalBusy || (modal === 'delete' && !modalDeleteEntries.length)"
            >
              <LoaderCircle v-if="modalBusy" class="spinning" :size="16" />{{
                modalBusy
                  ? '正在处理…'
                  : modal === 'delete'
                    ? '确认移除'
                    : modal === 'rename'
                      ? '保存名称'
                      : modal === 'workspace'
                        ? '创建空间'
                        : '创建文档'
              }}<ArrowRight v-if="!modalBusy" :size="16" />
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
