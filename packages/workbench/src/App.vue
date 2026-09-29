<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { version as appVersion } from '../package.json';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
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
  ArrowDownToLine,
  Archive,
  Clock3,
  History,
  List,
  CircleHelp,
  Monitor,
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
} from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import { defaultEditorPreferences } from '@tano/editor/runtime';
import type { EditorPreferences } from '@tano/editor/runtime';
import { defaultSelectionContext } from '@tano/editor/document-model';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import SourceEditor from './components/SourceEditor.vue';
import DocumentTitle from './components/DocumentTitle.vue';
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
import type { WorkspaceArchiveResult } from '@tano/protocol';
import {
  imageUrl,
  importAttachment,
  exportAttachment,
  resourceMarkdown,
  openExternalUrl,
  openWorkspaceEntry,
  workspaceEntryPath,
} from './attachments';
import { headings } from '@tano/markdown';
import FileTree from './components/FileTree.vue';
import DesktopTabs from './components/DesktopTabs.vue';
import { GRAPH_TAB_ID } from './document-graph';
const RelationGraph = defineAsyncComponent(() => import('./components/RelationGraph.vue'));
import NewTabPicker from './components/NewTabPicker.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import DocumentHistoryPanel from './components/DocumentHistoryPanel.vue';
import AgentPanel from './components/AgentPanel.vue';
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
import WorkspaceTools from './components/WorkspaceTools.vue';
import WorkspaceRecoveryDialog from './components/WorkspaceRecoveryDialog.vue';
import type { WorkspaceTool } from './components/WorkspaceTools.vue';
import { relationPath } from '@tano/protocol';
import { isObjectPath, resolveReference } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import { sloganParts, welcomeSlogans } from './welcome-slogans';
import { useUpdatesStore } from './stores/updates';
import { resolveWikiLink } from './wiki-links';
import { applyFileMovePreview, planFileMovePreview, type FileMovePreview } from './file-move';
import { isSidebarToggleShortcut } from './shortcuts';
import { selectTreeEntry, topLevelEntries } from './file-selection';
import { isBlankPageTarget } from './page-context-menu';
import { applyTheme, readThemePreference, saveThemePreference } from './theme';
import type { ThemePreference } from './theme';
import { parseVisualFontChoice, sanitizeCustomFontName, visualFontFamily } from './editor-font';
import type { VisualFontChoice } from './editor-font';
import { listen } from '@tauri-apps/api/event';

const store = useWorkspaceStore();
const welcomeSlogan = welcomeSlogans[Math.floor(Math.random() * welcomeSlogans.length)];
const welcomeSloganParts = sloganParts(welcomeSlogan);
const localNative = native && !store.isWeb;
const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
const editing = extensions.editing;
const extensionActions: WorkbenchActions = {
  closeMenus: () => { workspaceMenu.value = false; settingsMenu.value = false; menu.value = false; },
  createWorkspace: () => showModal('workspace'), openSettings,
  showDiff: value => { selectedDiff.value = value; },
};
const updates = useUpdatesStore();
const updateLock = computed(() => ['downloading', 'installing'].includes(updates.state.phase));
const historyPanel = ref(false);
const historyPage = ref<'versions' | 'updates'>('versions');
const agentPanel = ref(false);
const recyclePanel = ref(false);
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
    settingsMenu.value = false;
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
const sidebar = ref(window.innerWidth > 700);
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
const defaultSource = ref(readPreference('defaultSource', false));
const revealMarkdown = ref(readPreference('revealMarkdown', true));
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
const source = ref(defaultSource.value);
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
const outlinePinned = ref(readPreference('outlinePinned', false));
const outlineSearchOpen = ref(false);
const outlineSearch = ref('');
const outlineSearchInput = ref<HTMLInputElement>();
watch(outlinePinned, (pinned) => savePreference('outlinePinned', pinned));
const menu = ref(false);
const documentMenuButton = ref<HTMLButtonElement>();
const documentMenuElement = ref<HTMLElement>();
const workspaceMenu = ref(false);
const settingsMenu = ref(false);
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
const archiveBusy = ref(false);
const archiveResult = ref<{ kind: 'export' | 'import'; value: WorkspaceArchiveResult } | null>(null);
const settingsPage = ref<'preferences' | 'workspace' | 'about'>('preferences');
watch(defaultSource, (value) => {
  savePreference('defaultSource', value);
  if (!editing.active && !editing.activeBusy) source.value = value;
});
watch(revealMarkdown, (value) => savePreference('revealMarkdown', value));
const modal = ref<
  '' | 'newTab' | 'document' | 'folder' | 'rename' | 'search' | 'delete' | 'saveAs' | 'workspace'
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
const editor = ref<InstanceType<typeof MarkdownEditor>>();
const objectPanel = ref(false);
const toolsOpen = ref(false);
const workspaceTool = ref<WorkspaceTool>('plugins');
function showWorkspaceTool(tab: WorkspaceTool) {
  workspaceTool.value = tab;
  toolsOpen.value = true;
  settingsMenu.value = false;
}
const selectedObjectId = ref<string>();
function showObjects(id?: string) {
  selectedObjectId.value = id;
  objectPanel.value = true;
  settingsMenu.value = false;
}
async function openReference(identity: ReferenceIdentity) {
  const result = resolveReference(store.referenceTargets, identity);
  if (!result.target) {
    store.report('当前工作区中引用目标不可用，请检查对象是否被移除或 ID 是否重复');
    return;
  }
  if (identity.type !== 'document') {
    showObjects(identity.id);
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
const assetInput = ref<HTMLInputElement>();
const assetImportBusy = ref(false);
async function importObjectAssets(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const selectedWorkspace = workspace.value;
  if (
    !localNative ||
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
      await importAttachment(selectedWorkspace.id, '', file, false);
    }
  } catch (error) {
    store.report(error);
  } finally {
    if (workspace.value?.id === selectedWorkspace.id) await store.refresh();
    assetImportBusy.value = false;
  }
}
function assetPreview(target: ReferenceTarget) {
  return localNative &&
    target.type === 'asset' &&
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(target.mime ?? '')
    ? imageUrl(workspace.value, '', relativeWorkspaceReference('', target.path))
    : null;
}
const editorSelection = ref<EditorSelectionContext>({ ...defaultSelectionContext });
watch([activeId, source], () => {
  editorSelection.value = { ...defaultSelectionContext };
});
const documentScroll = ref<HTMLElement>();
const editorScroll = ref<HTMLElement>();
const sourceEditor = ref<InstanceType<typeof SourceEditor>>();
const documentUndoAvailable = ref(false);
const documentRedoAvailable = ref(false);
async function toggleDocumentMenu() {
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
const attachmentBusy = ref(false);
const resourceRevision = computed(
  () =>
    `${active.value?.path}:${workspace.value?.files
      .filter((file) => !isMarkdown(file.path))
      .map((file) => `${file.path}:${file.modified}:${file.size}`)
      .join('|')}`,
);
const resolveImage = (reference: string) =>
  localNative
    ? imageUrl(workspace.value, active.value?.path ?? '', reference)
    : safeRemoteImage(reference);
async function uploadFile(file: File, requireImage: boolean) {
  const currentWorkspace = workspace.value,
    doc = active.value;
  if (!localNative || !currentWorkspace || !doc) throw new Error('请在本地工作空间中导入附件');
  const result = await importAttachment(currentWorkspace.id, doc.path, file, requireImage);
  if (workspace.value?.id !== currentWorkspace.id || active.value?.id !== doc.id)
    throw new Error('附件已保存到原工作空间的 assets；文档已切换，请重新插入链接');
  await store.refresh();
  if (workspace.value?.id !== currentWorkspace.id || active.value?.id !== doc.id)
    throw new Error('附件已导入，原文档已关闭');
  return { ...result, url: relativeWorkspaceReference(active.value.path, result.path) };
}
async function insertSourceFiles(files: File[], position: number, requireImage: boolean) {
  if (!active.value || active.value.conflict || attachmentBusy.value) return;
  const id = active.value.id,
    before = active.value.content;
  attachmentBusy.value = true;
  try {
    const links: string[] = [];
    for (const file of files.slice(0, 10))
      links.push(resourceMarkdown(await uploadFile(file, requireImage)));
    if (active.value?.id !== id) return;
    // Preserve typing that happened while the bytes were being imported.
    const content = active.value.content;
    const at = content === before ? position : content.length;
    store.edit(`${content.slice(0, at)}\n${links.join('\n')}\n${content.slice(at)}`);
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
  if (source.value)
    void insertSourceFiles(
      files,
      sourceEditor.value?.cursor() ?? active.value?.content.length ?? 0,
      false,
    );
  else editor.value?.importFiles(files);
}
async function openEntry(file: FileEntry, newTab = false) {
  if (file.path === relationPath) {
    showWorkspaceTool('relations');
    return;
  }
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
  if (workspace.value && localNative) {
    try {
      await exportAttachment(workspace.value.id, file.path);
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
  settingsMenu.value = false;
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
  showModal(action, target);
}
function closePageContextMenu() {
  pageContextMenu.value = null;
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
function togglePageOption(option: 'width' | 'title') {
  if (option === 'width') setLimitPageWidth(!limitPageWidth.value);
  if (option === 'title') showPageTitle.value = !showPageTitle.value;
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
    (store.isWeb && (file.kind !== 'file' || !isMarkdown(file.path))) ||
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
  event.dataTransfer.effectAllowed = 'move';
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
const breadcrumbs = computed(() => active.value?.path.split('/') ?? []);
const activeTitle = computed(() =>
  basename(active.value?.path ?? '').replace(/\.(md|markdown)$/i, ''),
);
const modalTitle = computed(() => {
  const titles = {
    newTab: '打开文件',
    document: '新建文档',
    folder: '新建文件夹',
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
      ['document', 'folder', 'rename', 'delete', 'saveAs'].includes(kind))
  )
    return;
  menu.value = false;
  workspaceMenu.value = false;
  settingsMenu.value = false;
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
        : (kind === 'folder' || kind === 'document') && target?.kind === 'directory'
          ? `${target.path}/`
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
  if (store.busy || workspace.value?.readOnly || updateLock.value) return;
  menu.value = false;
  workspaceMenu.value = false;
  settingsMenu.value = false;
  modal.value = '';
  try {
    await store.createUntitledDocument();
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
function openSettings(page: 'preferences' | 'workspace' | 'about' = 'preferences') {
  menu.value = false;
  workspaceMenu.value = false;
  settingsMenu.value = false;
  settingsPage.value = page;
  settingsPanel.value = true;
}
function settingsAction(
  action: 'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'backup' | 'export' | 'import' | 'sign-out',
) {
  settingsPanel.value = false;
  if (action === 'open-folder') void store.openWorkspace();
  else if (action === 'reveal') void store.reveal();
  else if (action === 'agent') agentPanel.value = true;
  else if (action === 'history') extensions.showHistory?.();
  else if (action === 'backup') void store.openRecovery();
  else if (action === 'export' || action === 'import') void runArchive(action);
  else if (action === 'recycle') recyclePanel.value = true;
}
async function runArchive(kind: 'export' | 'import') {
  if (archiveBusy.value) return;
  archiveBusy.value = true;
  try {
    const value = kind === 'export' ? await store.exportFullArchive() : await store.importFullArchive();
    if (value) archiveResult.value = { kind, value };
  } catch (error) {
    store.report(error);
  } finally {
    archiveBusy.value = false;
  }
}
function toggleWorkspaceMenu() {
  settingsMenu.value = false;
  workspaceMenu.value = !workspaceMenu.value;
  if (workspaceMenu.value && store.isWeb) void store.refreshWorkspaces();
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
        kind !== 'folder' &&
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
      else await store.create(path, kind === 'folder');
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
async function exportDocument() {
  if (!active.value) return;
  if (mobile && workspace.value) {
    menu.value = false;
    try {
      const workspaceId = workspace.value.id,
        path = active.value.path;
      if (!(await store.flush())) throw new Error('请先处理保存错误再导出');
      await exportAttachment(workspaceId, path);
    } catch (reason) {
      store.report(reason);
    }
    return;
  }
  const url = URL.createObjectURL(
    new Blob([active.value.content], { type: 'text/markdown;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = basename(active.value.path);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  menu.value = false;
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
  sidebar.value = !sidebar.value;
  workspaceMenu.value = false;
  settingsMenu.value = false;
}
function handleSidebarShortcut(event: KeyboardEvent) {
  if (!workspace.value || settingsPanel.value || toolsOpen.value || updateLock.value) return;
  if (!isSidebarToggleShortcut(event)) return;
  event.preventDefault();
  event.stopPropagation();
  toggleSidebar();
}
function keydown(event: KeyboardEvent) {
  if (toolsOpen.value) return;
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
        (!store.isWeb || (file.kind === 'file' && isMarkdown(file.path)))
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
    settingsMenu.value = false;
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
  if (!target.closest('.file-context-menu')) closeFileContextMenu();
  if (!target.closest('.directory-context-menu')) closeDirectoryContextMenu();
  if (!target.closest('.page-context-menu')) closePageContextMenu();
  if (!target.closest('.dropdown, .menu-wrap, .sidebar-bottom')) {
    menu.value = false;
    workspaceMenu.value = false;
    settingsMenu.value = false;
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
let unlistenBackupError: (() => void) | undefined;
onMounted(async () => {
  window.addEventListener('keydown', handleSidebarShortcut, true);
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
  document.addEventListener('visibilitychange', mobileVisibility);
  await store.initialize();
  if (native && !mobile) void updates.initialize();
  if (native) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (localNative)
      unlistenWatchError = await listen<string>('workspace-watch-error', (event) =>
        store.report(`文件监听遇到错误：${event.payload}。目录仍会定期自动检查。`),
      );
    if (localNative)
      unlistenBackupError = await listen<string>('workspace-backup-error', (event) =>
        store.report(event.payload),
      );
    if (!mobile)
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        if (updates.state.phase === 'installing') return;
        try {
          if (await store.flush()) {
            await editing.suspendAll();
            await getCurrentWindow().destroy();
          } else store.report('还有未保存的内容，窗口已保留。请先保存或另存副本。');
        } catch (error) {
          store.report(error);
        }
      });
  }
});
onBeforeUnmount(() => {
  if (headingFrame !== undefined) cancelAnimationFrame(headingFrame);
  void extensions.disconnect().catch(store.report);
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
  document.removeEventListener('visibilitychange', mobileVisibility);
  unlistenClose?.();
  unlistenWatchError?.();
  unlistenBackupError?.();
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
  source.value = defaultSource.value && !editing.active;
  menu.value = false;
  activeHeading.value = 0;
  if (documentScroll.value) documentScroll.value.scrollTop = 0;
  void nextTick(scheduleActiveHeading);
});
</script>

<template>
  <Teleport v-if="native && !mobile && workspace" to="#desktop-window-tab-slot">
    <button
      v-if="!sidebar"
      class="desktop-sidebar-toggle"
      type="button"
      aria-label="展开侧栏"
      title="展开侧栏 · Ctrl B"
      @click="toggleSidebar"
    >
      <PanelLeftOpen :size="17" />
    </button>
    <DesktopTabs @new-tab="store.createBlankTab()" @new-document="createNewDocument" />
  </Teleport>
  <div
    class="app-shell"
    :class="{
      'sidebar-hidden': !sidebar || !workspace,
      'workspace-empty': !workspace,
    }"
  >
    <Transition name="sidebar-dismiss">
      <button
        v-if="workspace && sidebar"
        class="sidebar-dismiss"
        aria-label="收起侧栏"
        @click="toggleSidebar"
      />
    </Transition>
    <Transition name="sidebar">
      <aside
        v-if="workspace && sidebar"
        class="sidebar"
        aria-label="工作区侧栏"
        :inert="!sidebar"
        :aria-hidden="!sidebar"
      >
        <div class="sidebar-header">
          <component
            :is="native ? 'div' : 'a'"
            class="brand"
            :href="native ? undefined : '/'"
            :aria-label="native ? undefined : '返回同页首页'"
            @click="returnHome"
          >
            <img src="/favicon-green.svg?v=3" alt="" />
          </component>
          <div class="sidebar-header-actions">
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
              aria-label="查找文档"
              title="查找文档 · Ctrl K"
              @click="showModal('search')"
            >
              <Search :size="17" :stroke-width="1.6" />
            </button>
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
        </div>
        <nav class="sidebar-tools" aria-label="工作区工具入口">
          <button title="插件安装器 · Level 2" @click="showWorkspaceTool('plugins')">
            <Puzzle :size="16" /><span>插件</span>
          </button>
          <button title="关系引擎 · Level 2" @click="showWorkspaceTool('relations')">
            <GitFork :size="16" /><span>关系</span>
          </button>
          <button title="日历视图 · Level 2" @click="showWorkspaceTool('calendar')">
            <CalendarDays :size="16" /><span>日历</span>
          </button>
        </nav>
        <div class="sidebar-content">
          <div
            class="section-label"
            :class="{ 'drop-target': draggedEntry && dropFolder === '' }"
            @dragover="fileDragOver('', $event)"
            @dragleave="fileDragLeave('', $event)"
            @drop="fileDrop('', $event)"
          >
            <span
              >{{ draggedEntry ? '放到工作区根目录' : '文档目录'
              }}<span v-if="!draggedEntry" class="document-count">{{ noteCount }}</span></span
            >
            <div>
              <button
                v-if="!store.isWeb"
                class="icon-button"
                aria-label="新建文件夹"
                title="新建文件夹"
                :disabled="!workspace || workspace.readOnly || busy"
                @click="showModal('folder')"
              >
                <FolderPlus :size="15" :stroke-width="1.6" />
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
                  v-if="isMarkdown(fileContextMenu.file.path) || localNative"
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
                  v-else-if="!store.isWeb"
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
                <span class="workspace-menu-avatar"><BookOpen :size="18" /></span>
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
              </div>
              <div class="menu-divider" />
              <button @click="openSettings()"><Settings2 :size="16" />设置</button>
              <component v-if="store.isWeb" :is="extensions.regions['workspace-menu']"  :actions="extensionActions" />
              <template v-else>
                <button
                  :disabled="busy"
                  @click="
                    workspaceMenu = false;
                    store.isDemo ? openSettings('about') : store.openWorkspace();
                  "
                >
                  <FolderOpen :size="16" />{{
                    store.isDemo ? '了解演示存储' : mobile ? '打开默认手机空间' : '打开工作文件夹'
                  }}
                </button>
                <component  :is="extensions.regions['local-menu-login']" v-if="extensions.regions['local-menu-login']" :actions="extensionActions" />
                <button v-if="mobile" :disabled="busy" @click="showModal('workspace')">
                  <FolderPlus :size="16" />新建手机空间
                </button>
                <template v-if="store.recent.length">
                  <div class="menu-divider" />
                  <span class="recent-label">最近工作空间</span>
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
            class="icon-button sidebar-settings"
            aria-label="工作区设置"
            title="工作区设置"
            :aria-expanded="settingsMenu"
            aria-controls="workspace-settings"
            @click="
              settingsMenu = !settingsMenu;
              workspaceMenu = false;
            "
          >
            <Settings2 :size="17" />
          </button>
          <button
            class="icon-button sidebar-help"
            aria-label="帮助与快捷键"
            title="帮助与快捷键"
            @click="openSettings('about')"
          >
            <CircleHelp :size="17" />
          </button>
          <div
            v-if="settingsMenu"
            id="workspace-settings"
            class="dropdown compact-action-menu sidebar-popover sidebar-settings-dropdown"
          >
            <span class="recent-label">工作区设置</span>
            <button @click="openSettings()"><Settings2 :size="16" />打开设置面板</button>
            <button @click="showObjects()"><Users :size="16" />工作区对象 · Level 2</button>
            <div class="menu-divider" />
            <component  :is="extensions.regions['account-note']" v-if="extensions.regions['account-note']" :actions="extensionActions" />
            <div class="local-note">
              <span class="local-note-icon"
                ><component :is="store.isWeb ? Globe2 : Monitor" :size="17"
              /></span>
              <div>
                <strong>{{
                  store.isDemo ? '浏览器演示空间' : store.isWeb ? '在线工作区' : '本地工作空间'
                }}</strong>
                <p>
                  {{
                    store.isDemo
                      ? '内容保存在当前浏览器'
                      : store.isWeb
                        ? 'Markdown 保存在服务器'
                        : 'Markdown 文件 · 自动保存'
                  }}
                </p>
              </div>
            </div>
            <div class="menu-divider" />
            <component  :is="extensions.regions['mode-switch']" v-if="extensions.regions['mode-switch']" :actions="extensionActions" />
            <button
              v-if="workspace && localNative && !mobile"
              @click="
                settingsMenu = false;
                store.reveal();
              "
            >
              <ExternalLink :size="16" />在资源管理器中显示
            </button>
            <button
              v-if="mobile && workspace"
              @click="
                settingsMenu = false;
                recyclePanel = true;
              "
            >
              <Trash2 :size="16" />手机回收站
            </button>
            <button
              v-if="workspace && localNative"
              @click="
                settingsMenu = false;
                agentPanel = true;
              "
            >
              <Bot :size="16" />与 Agent 一起工作
            </button>
            <component  :is="extensions.regions['workspace-history']" v-if="extensions.regions['workspace-history']" :actions="extensionActions" />
            <button @click="openSettings('about')">
              <CircleHelp :size="16" />关于 Tano / 同页{{
                updates.state.candidate ? ' · 有新版本' : ''
              }}
            </button>
            <component  :is="extensions.regions['sign-out']" v-if="extensions.regions['sign-out']" :actions="extensionActions" />
          </div>
        </div>
      </aside>
    </Transition>

    <div class="main-column">
      <div v-if="workspace && (!native || mobile)" class="workspace-tabbar">
        <DesktopTabs @new-tab="store.createBlankTab()" @new-document="createNewDocument" />
      </div>
      <header v-if="workspace" class="topbar">
        <div class="topbar-navigation" role="group" aria-label="文档导航">
          <button
            type="button"
            class="icon-button"
            aria-label="后退"
            title="后退"
            :disabled="!store.canGoBack"
            @click="store.navigateHistory(-1)"
          >
            <ArrowLeft :size="16" :stroke-width="1.6" />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="前进"
            title="前进"
            :disabled="!store.canGoForward"
            @click="store.navigateHistory(1)"
          >
            <ArrowRight :size="16" :stroke-width="1.6" />
          </button>
        </div>
        <nav class="breadcrumb" aria-label="当前位置">
          <button
            v-if="!sidebar && !(native && !mobile && workspace)"
            class="icon-button"
            aria-label="展开侧栏"
            title="展开侧栏 · Ctrl B"
            @click="toggleSidebar"
          >
            <PanelLeftOpen :size="18" /></button
          ><span class="breadcrumb-workspace"
            ><BookOpen :size="14" />{{ workspace?.name ?? 'Tano' }}</span
          ><template v-if="activeId === GRAPH_TAB_ID"><ChevronRight :size="12" /><GitFork :size="14" /><span class="breadcrumb-current">关系图谱</span></template
          ><template v-for="(part, index) in breadcrumbs" :key="index"
            ><ChevronRight :size="12" /><component
              :is="index === breadcrumbs.length - 1 ? FileText : FolderOpen"
              :size="14"
            /><span :class="{ 'breadcrumb-current': index === breadcrumbs.length - 1 }">{{
              index === breadcrumbs.length - 1 ? activeTitle : part
            }}</span></template
          >
        </nav>
        <div class="topbar-right">
          <component  :is="extensions.regions['editing-status']" v-if="extensions.regions['editing-status']" :actions="extensionActions" />
          <span v-if="store.isDemo" class="demo-badge"><span />浏览器演示</span
          ><span v-else-if="store.isWeb" class="local-badge"
            ><Globe2 :size="14" />{{ workspace?.readOnly ? '只读权限' : '在线工作区' }}</span
          >
          <template v-if="active">
            <button
              type="button"
              class="icon-button source-mode-button"
              :class="{ active: source }"
              :disabled="!!editing.active || editing.activeBusy"
              :aria-label="source ? '返回编辑' : '切换源码模式'"
              :aria-pressed="source"
              :title="
                editing.active
                  ? '当前编辑扩展不支持切换源码模式'
                  : source
                    ? '返回编辑'
                    : '切换源码模式'
              "
              @click="source = !source"
            >
              <Code2 :size="17" />
            </button>
            <button
              v-if="localNative"
              class="icon-button"
              aria-label="导入图片或附件"
              title="导入图片或附件；也可直接粘贴图片"
              :disabled="editorReadonly || attachmentBusy"
              @click="fileInput?.click()"
            >
              <Paperclip :size="17" />
            </button>
            <input ref="fileInput" type="file" multiple hidden @change="pickedFiles" />
            <div class="menu-wrap">
              <button
                ref="documentMenuButton"
                class="icon-button"
                aria-label="文档操作"
                :aria-expanded="menu"
                @click="toggleDocumentMenu"
                @keydown="documentMenuTriggerKeydown"
              >
                <MoreHorizontal :size="19" />
              </button>
              <div
                v-if="menu"
                ref="documentMenuElement"
                class="dropdown compact-action-menu document-dropdown"
                @keydown="documentMenuKeydown"
              >
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
                <div class="menu-divider" />
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
                  :disabled="editorReadonly || !!editing.active || editing.activeBusy"
                  @click="showModal('rename')"
                >
                  <Pencil :size="15" />重命名文档</button
                ><button :disabled="workspace?.readOnly || busy" @click="showModal('saveAs')">
                  <FileText :size="15" />另存副本</button
                ><button
                  @click="
                    menu = false;
                    historyPage = 'versions';
                    historyPanel = true;
                  "
                >
                  <Archive :size="15" />版本历史<span class="menu-beta">Beta</span></button
                ><button
                  @click="
                    menu = false;
                    historyPage = 'updates';
                    historyPanel = true;
                  "
                >
                  <Clock3 :size="15" />更新历史</button
                ><button @click="exportDocument"><ArrowDownToLine :size="15" />导出 Markdown</button
                ><button
                  @click="
                    menu = false;
                    store.flush();
                  "
                >
                  <CheckCheck :size="15" />立即保存<span class="menu-shortcut">Ctrl S</span>
                </button>
                <div class="menu-divider" />
                <button
                  class="danger-text"
                  :disabled="editorReadonly || !!editing.active || editing.activeBusy"
                  @click="removeDocument()"
                >
                  <Trash2 :size="15" />{{
                    store.isDemo ? '删除演示文档' : store.isWeb ? '删除在线文档' : '移入回收站'
                  }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </header>

      <KeepAlive v-if="store.tabs.some(tab => tab.graph)">
        <RelationGraph v-if="workspace && activeId === GRAPH_TAB_ID" :key="`${workspace.id}:${workspace.path}`" />
      </KeepAlive>

      <template v-if="active">
        <div ref="documentScroll" class="document-layout" @scroll.passive="scheduleActiveHeading">
          <main class="document-main">
            <EditorToolbar
              :features="store.capabilities.features"
              :context="editorSelection"
              :source="source"
              :disabled="editorReadonly"
              @command="(name, value) => editor?.command(name, value)"
            />

            <component  :is="extensions.regions['editing-panel']" v-if="extensions.regions['editing-panel']" :actions="extensionActions" />
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
              ref="editorScroll"
              class="editor-scroll"
              :style="{
                '--tano-prose-font-family': selectedVisualFontFamily,
                '--tano-prose-font-size': `${visualFontSize}px`,
                '--tano-source-font-size': `${sourceFontSize}px`,
              }"
              :class="{
                'source-view': source,
                'conflicted-editor': active.conflict,
                'width-unlimited': !limitPageWidth,
              }"
              tabindex="-1"
              @mousedown.self="!source && editor?.focusTrailingParagraph($event)"
              @contextmenu="openPageContextMenu"
            >
              <DocumentTitle
                v-if="workspace && showPageTitle"
                :key="`${workspace.id}:${active.id}`"
                :workspace-id="workspace.id"
                :document-id="active.id"
                :path="active.path"
                :files="workspace.files"
                :readonly="
                  editorReadonly ||
                  active.missing ||
                  !!editing.active ||
                  editing.activeBusy
                "
                :rename="renameDocumentTitle"
                @enter="insertBlockBelowTitle"
              />
              <SourceEditor
                v-if="source"
                :key="active.id"
                ref="sourceEditor"
                :model-value="active.content"
                :readonly="editorReadonly"
                :local-native="localNative"
                @update:model-value="store.edit"
                @files="
                  (files, requireImage, position) =>
                    insertSourceFiles(files, position, requireImage)
                "
              />
              <MarkdownEditor
                v-else
                :key="`${active.id}:${editing.active?.key ?? 'local'}`"
                ref="editor"
                :document-id="active.id"
                :readonly="editorReadonly"
                :open-links-on-tap="mobile"
                :reveal-markdown="revealMarkdown"
                :capabilities="store.capabilities"
                :reference-targets="store.referenceTargets"
                :preferences="editorPreferences"
                :extension="editing.active?.extension"
                :model-value="active.content"
                :resolve-image="resolveImage"
                :resource-revision="resourceRevision"
                :import-file="localNative ? uploadFile : undefined"
                @update:model-value="store.edit"
                @error="store.report"
                @open-link="openDocumentLink"
                @open-wiki-link="openWikiLink"
                @open-reference="openReference"
                @edit-source="source = true"
                @selection-change="editorSelection = $event"
              />
            </div>
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
              </div>
            </Teleport>
          </main>
        </div>

        <aside
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

      <main v-else-if="workspace && activeId.startsWith('blank:')" class="blank-tab-page">
        <div class="blank-tab-actions">
          <button :disabled="workspace.readOnly" @click="createNewDocument">
            创建新文件 <span>Ctrl + N</span>
          </button>
          <button @click="showModal('newTab')">打开文件 <span>Ctrl + O</span></button>
          <button @click="store.close(activeId)">关闭标签页</button>
        </div>
      </main>

      <main v-else-if="workspace && activeId !== GRAPH_TAB_ID" class="workspace-no-tabs">
        <div class="workspace-no-tabs-content">
          <FileText :size="32" :stroke-width="1.4" aria-hidden="true" />
          <h1>当前没有打开的文档</h1>
          <p>工作区已打开。创建新文件，或打开工作区中的文档继续。</p>
          <div class="workspace-no-tabs-actions">
            <button
              class="primary-button"
              :disabled="busy || workspace.readOnly || updateLock"
              @click="createNewDocument"
            >
              <Plus :size="17" />创建新文件 <kbd>Ctrl + N</kbd>
            </button>
            <button class="secondary-button" @click="showModal('newTab')">
              <FolderOpen :size="17" />打开文件 <kbd>Ctrl + O</kbd>
            </button>
          </div>
        </div>
      </main>

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
          <button v-if="localNative && !mobile" class="secondary-button" :disabled="busy || archiveBusy" @click="runArchive('import')">
            <ArrowDownToLine :size="16" />导入工作区归档
          </button>
        </div>
        <span v-if="store.isWeb" class="welcome-footnote">在线工作区 · Markdown 保存在服务器</span>
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
    </div>

    <component  :is="extensions.regions['sync-dialog']" v-if="extensions.regions['sync-dialog']" :actions="extensionActions" />
    <WorkspaceRecoveryDialog
      v-if="store.recovery"
      :catalog="store.recovery"
      :preview="store.recoveryPreview"
      :busy="store.recoveryBusy"
      :error="store.recoveryError"
      @close="store.closeRecovery()"
      @select="store.previewRecovery($event)"
      @restore="store.restoreRecovery($event)"
    />
    <div v-if="archiveResult" class="modal-backdrop" @mousedown.self="archiveResult = null">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="archive-result-title">
        <header><h2 id="archive-result-title">{{ archiveResult.kind === 'export' ? '整库导出完成' : '工作区导入完成' }}</h2>
          <button class="icon-button" type="button" aria-label="关闭" @click="archiveResult = null"><X :size="19" /></button></header>
        <p class="modal-description">{{ archiveResult.value.fileCount }} 个文件已校验，包含 Markdown、附件和 .tano。</p>
        <p class="modal-description" style="overflow-wrap: anywhere">{{ archiveResult.value.path }}</p>
        <footer><button class="primary-button" type="button" @click="archiveResult = null">完成</button></footer>
      </section>
    </div>
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
      :history-view="localNative && extensions.historyEnabled ? extensions.historyView : undefined"
      :initial-page="historyPage"
      @close="historyPanel = false"
      @diff="
        historyPanel = false;
        selectedDiff = $event;
      "
    />
    <input ref="assetInput" type="file" multiple hidden @change="importObjectAssets" />
    <WorkspaceTools
      v-if="workspace"
      :open="toolsOpen"
      :tab="workspaceTool"
      @close="toolsOpen = false"
      @tab="workspaceTool = $event"
      @objects="
        toolsOpen = false;
        showObjects();
      "
      @open-object="
        toolsOpen = false;
        openReference($event);
      "
    />
    <ObjectPanel
      v-show="objectPanel"
      :open="objectPanel"
      :selected-id="selectedObjectId"
      :can-open-asset="localNative"
      :can-import-asset="localNative && !assetImportBusy"
      :preview-asset="assetPreview"
      @close="objectPanel = false"
      @open-resource="openObjectResource"
      @create-document="
        objectPanel = false;
        createNewDocument();
      "
      @import-asset="assetInput?.click()"
    />
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
      :show-page-title="showPageTitle"
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
      @update:show-page-title="showPageTitle = $event"
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
                    ? '将从在线工作区移除文档。服务端按配置保留版本历史；网页暂不提供恢复入口。'
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
                modal === 'folder'
                  ? '给新的想法留一个位置。'
                  : modal === 'rename'
                    ? '更换名称，文件的身份保持不变。'
                    : modal === 'saveAs'
                      ? '把当前编辑内容保存为独立的 Markdown 文件。'
                      : '从一个名字开始，把想法留在这一页。'
              }}
            </p>
            <label for="file-name">{{
              modal === 'workspace'
                ? '工作空间名称'
                : modal === 'folder' || (modal === 'rename' && modalTarget?.kind === 'directory')
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
                  : modal === 'folder'
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
                        : modal === 'folder'
                          ? '创建文件夹'
                          : '创建文档'
              }}<ArrowRight v-if="!modalBusy" :size="16" />
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
