import { computed, onBeforeUnmount, onMounted, provide, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { installInteractionMotion } from '@tano/editor/motion';
import {
  defaultEditorPreferences,
  normalizeChineseInput,
  normalizeCopyFormat,
  normalizeMarkdownAutocomplete,
  normalizeSelectionWrapping,
  type EditorPreferences,
} from '@tano/editor/runtime';
import { AppearanceController } from '../appearance';
import {
  parseSplitFontSettings,
  parseVisualFontChoice,
  sanitizeCustomFontName,
  type VisualFontChoice,
} from '../editor-font';
import { featureChannel } from '../features';
import { fileIconRegistryKey, FileIconRegistry } from '../file-icons/registry';
import {
  GlassWallpaperController,
  indexedDbWallpaperStore,
  setGlassWallpaper,
} from '../glass-wallpaper';
import {
  builtinThumbnail,
  customThumbnail,
  decodeImage,
  normalizeImport,
  paintBuiltin,
  renderWallpaper,
} from '../glass-wallpaper-render';
import { LiquidGlassController } from '../liquid-glass';
import { useWorkbenchRuntime, type WorkbenchExtensions } from '../runtime';
import {
  readShortcutBindings,
  saveShortcutBindings,
  shortcutKeys,
  shortcutLabel,
  shortcutPreferenceKey,
  type ShortcutId,
} from '../shortcuts';
import type { useWorkspaceStore } from '../stores/workspace';
import { applyAppearance, applyTheme, resolveThemeMode, type ThemePreference } from '../theme';
import { parseToolbarMode, toolbarPreferenceKey } from '../toolbar-preference';
import { useEditorFontFamily } from '../use-editor-font';
import type { WindowContext } from '../windows/context';

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_COLLAPSE_WIDTH = SIDEBAR_MIN_WIDTH - 80;

export function readPreference(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(`tano.preference.${key}`);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function savePreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(`tano.preference.${key}`, String(value));
  } catch {
    // The setting still works for this session when device storage is unavailable.
  }
}

export function readTextPreference(key: string): string {
  try {
    return window.localStorage.getItem(`tano.preference.${key}`) ?? '';
  } catch {
    return '';
  }
}

export function saveTextPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(`tano.preference.${key}`, value);
  } catch {
    // The setting still works for this session when device storage is unavailable.
  }
}

export function pageLockPreferenceKey(workspaceId: string, documentId: string) {
  return `pageLocked.${workspaceId}.${documentId}`;
}

function readSelectionWrapping() {
  try {
    return normalizeSelectionWrapping(JSON.parse(readTextPreference('selectionWrapping') || 'null'));
  } catch {
    return normalizeSelectionWrapping();
  }
}

function readMarkdownAutocomplete() {
  try {
    return normalizeMarkdownAutocomplete(
      JSON.parse(readTextPreference('markdownAutocomplete') || 'null'),
    );
  } catch {
    return normalizeMarkdownAutocomplete();
  }
}

function readChineseInput() {
  let value: unknown;
  let legacy: unknown;
  try {
    value = JSON.parse(readTextPreference('chineseInput') || 'null');
  } catch {
    /* Use safe defaults. */
  }
  try {
    legacy = JSON.parse(readTextPreference('selectionWrapping') || 'null');
  } catch {
    /* No legacy preference. */
  }
  return normalizeChineseInput(value, legacy);
}

export interface WorkbenchPreferencesDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  mainWindow: WindowContext;
  activeWindow: Ref<WindowContext>;
  isAuxiliaryWindow: boolean;
  viewportWidth: Ref<number>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  editing: WorkbenchExtensions['editing'];
  onDefaultSourceChange: (value: boolean, previous: boolean) => void;
}

export function useWorkbenchPreferences(deps: WorkbenchPreferencesDeps) {
  const {
    store,
    mainWindow,
    activeWindow,
    isAuxiliaryWindow,
    viewportWidth,
    compactPanes,
    sidebar,
    workspaceMenu,
    editing,
    onDefaultSourceChange,
  } = deps;
  const { workspace, active, activeId } = storeToRefs(store);

  function readFontSizePreference(key: string, fallback: number): number {
    const { window: activeWin } = activeWindow.value;
    try {
      const value = Number(activeWin.localStorage.getItem(`tano.preference.${key}`));
      return Number.isInteger(value) && value >= 12 && value <= 24 ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function saveFontSizePreference(key: string, value: number) {
    const { window: activeWin } = activeWindow.value;
    try {
      activeWin.localStorage.setItem(`tano.preference.${key}`, String(value));
    } catch {
      // The setting still works for this session when device storage is unavailable.
    }
  }

  // Sidebar width & pointer/keyboard resize
  const sidebarWidth = ref<number | null>(null);
  const resizingSidebar = ref(false);
  let sidebarResizePointerId: number | null = null;
  let sidebarResizeCaptureElement: HTMLElement | null = null;
  let sidebarResizeStartX = 0;
  let sidebarResizeStartWidth = 0;
  let sidebarSnapRestoreWidth: number | null = null;
  let preferredSidebarWidth: number | null = null;

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
    sidebarWidth.value = Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(sidebarWidthLimit(), requestedWidth),
    );
    preferredSidebarWidth = preservePreference ? requestedWidth : sidebarWidth.value;
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth.value}px`);
  }

  function currentSidebarWidth() {
    const { document } = mainWindow;
    return (
      document.querySelector<HTMLElement>('.sidebar')?.getBoundingClientRect().width ??
      defaultSidebarWidth()
    );
  }

  watch(sidebar, (open) => {
    // Restore on reopening so the closing animation keeps its current width.
    if (open && sidebarSnapRestoreWidth !== null) {
      setSidebarWidth(sidebarSnapRestoreWidth);
      sidebarSnapRestoreWidth = null;
    }
  });

  const savedSidebarWidth = Number(readTextPreference('sidebarWidth'));
  if (
    !isAuxiliaryWindow &&
    Number.isInteger(savedSidebarWidth) &&
    savedSidebarWidth >= SIDEBAR_MIN_WIDTH &&
    savedSidebarWidth <= SIDEBAR_MAX_WIDTH
  ) {
    setSidebarWidth(savedSidebarWidth, true);
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

  // Appearance, wallpaper, liquid glass & interaction motion
  const appearanceIcons = new FileIconRegistry();
  provide(fileIconRegistryKey, appearanceIcons);
  const glassWallpaperController = new GlassWallpaperController(
    useWorkbenchRuntime().plugins?.principal ?? 'device',
    {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    indexedDbWallpaperStore(),
    {
      normalizeImport,
      decode: decodeImage,
      builtin: paintBuiltin,
      thumbnail: builtinThumbnail,
      customThumbnail,
      render: renderWallpaper,
    },
  );
  const appearanceController = new AppearanceController(
    appearanceIcons,
    useWorkbenchRuntime().plugins?.principal ?? 'device',
    {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      get length() {
        return window.localStorage.length;
      },
      key: (index) => window.localStorage.key(index),
      removeItem: (key) => window.localStorage.removeItem(key),
    },
    (color, layout, shape, mode, material) => {
      glassWallpaperController.applyWithWallpaper(
        material,
        () => resolveThemeMode(mode ?? 'system', color),
        () => applyAppearance(color, layout, shape, mode, material),
      );
    },
  );
  const appearance = appearanceController.state;
  watch(
    [() => store.workspace?.id ?? '', () => store.installedPlugins, () => store.installedPluginWorkspace],
    ([id, installed, loadedFor]) => {
      appearanceController.sync(id, id === loadedFor ? installed : []);
    },
    { immediate: true, deep: true },
  );
  onBeforeUnmount(() => appearanceController.dispose());

  const theme = computed<ThemePreference>({
    get: () => appearance.value.mode,
    set: (mode) =>
      appearanceController.select({
        workspaceId: appearance.value.workspaceId,
        kind: 'mode',
        id: mode,
      }),
  });
  setGlassWallpaper(glassWallpaperController);
  onMounted(() => {
    void glassWallpaperController.load();
  });
  onBeforeUnmount(() => {
    glassWallpaperController.dispose();
    setGlassWallpaper(undefined);
  });

  const onAppearanceStorage = (event: StorageEvent) => {
    appearanceController.refreshPreferences(event.key);
    glassWallpaperController.refreshPreferences(event.key);
  };
  onMounted(() => window.addEventListener('storage', onAppearanceStorage));
  onBeforeUnmount(() => window.removeEventListener('storage', onAppearanceStorage));

  // Liquid glass bends its backdrop through per-surface SVG filters (Chromium only; see liquid-glass.ts).
  const liquidGlass = new LiquidGlassController();
  onMounted(() => liquidGlass.start());
  onBeforeUnmount(() => liquidGlass.dispose());

  // Delegated press/hover springs for every button in the workbench and its
  // teleported surfaces (dialogs, menus, settings).
  let disposeInteractionMotion: (() => void) | undefined;
  onMounted(() => {
    disposeInteractionMotion = installInteractionMotion();
  });
  onBeforeUnmount(() => disposeInteractionMotion?.());

  const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => {
    if (theme.value === 'system') applyTheme('system');
  };
  applyTheme(theme.value);
  onMounted(() => systemThemeMedia?.addEventListener('change', onSystemThemeChange));
  onBeforeUnmount(() => systemThemeMedia?.removeEventListener('change', onSystemThemeChange));

  // Editor & UI preferences
  const defaultSource = ref(readPreference('defaultSource', false));
  const revealMarkdown = ref(readPreference('revealMarkdown', true));
  const toolbarMode = ref(parseToolbarMode(readTextPreference('toolbarMode')));
  const shortcuts = ref(readShortcutBindings());
  watch(shortcuts, saveShortcutBindings, { deep: true });
  function syncShortcutPreferences(event: StorageEvent) {
    if (event.key === shortcutPreferenceKey || event.key === null)
      shortcuts.value = readShortcutBindings();
  }
  onMounted(() => window.addEventListener('storage', syncShortcutPreferences));
  onBeforeUnmount(() => window.removeEventListener('storage', syncShortcutPreferences));

  function shortcutHint(id: ShortcutId) {
    const first = shortcutKeys(shortcuts.value[id])[0];
    return first ? shortcutLabel(first) : '';
  }
  provide('tano-shortcut-bindings', shortcuts);

  watch(toolbarMode, (value) => saveTextPreference('toolbarMode', value));
  function syncToolbarPreference(event: StorageEvent) {
    if (event.key === toolbarPreferenceKey || event.key === null)
      toolbarMode.value = parseToolbarMode(event.newValue);
  }
  onMounted(() => window.addEventListener('storage', syncToolbarPreference));
  onBeforeUnmount(() => window.removeEventListener('storage', syncToolbarPreference));

  watch(defaultSource, (value, previous) => {
    savePreference('defaultSource', value);
    if (!editing.active && !editing.activeBusy) onDefaultSourceChange(value, previous);
  });
  watch(revealMarkdown, (value) => savePreference('revealMarkdown', value));

  const visualFontChoice = ref<VisualFontChoice>(
    parseVisualFontChoice(readTextPreference('visualFontChoice')),
  );
  const customFontName = ref(sanitizeCustomFontName(readTextPreference('customFontName')));
  const savedSplitFontSettings = readTextPreference('splitFontSettings');
  const splitFontSettings = ref(
    savedSplitFontSettings
      ? parseSplitFontSettings(savedSplitFontSettings, visualFontChoice.value, customFontName.value)
      : undefined,
  );
  const selectedVisualFontFamily = useEditorFontFamily(
    () => visualFontChoice.value,
    () => customFontName.value,
    () => splitFontSettings.value,
  );
  watch(
    splitFontSettings,
    (value) => {
      if (value) saveTextPreference('splitFontSettings', JSON.stringify(value));
    },
    { deep: true },
  );
  watch(visualFontChoice, (value) => saveTextPreference('visualFontChoice', value));
  watch(customFontName, (value) => saveTextPreference('customFontName', value));

  const visualFontSize = ref(readFontSizePreference('visualFontSize', 16));
  const sourceFontSize = ref(readFontSizePreference('sourceFontSize', 14));
  watch(visualFontSize, (value) => saveFontSizePreference('visualFontSize', value));
  watch(sourceFontSize, (value) => saveFontSizePreference('sourceFontSize', value));

  const showPageTitle = ref(readPreference('showPageTitle', true));
  const developerMode = ref(readPreference('developerMode', featureChannel === 'dev'));
  glassWallpaperController.setDeveloperMode(developerMode.value);
  watch(developerMode, (enabled) => {
    savePreference('developerMode', enabled);
    glassWallpaperController.setDeveloperMode(enabled);
  });
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
    const doc = active.value;
    if (!doc || !pageWidthWritable.value) return;
    void store.updateCapabilities({ pageWidth: { documentId: doc.id, limited: value } });
  }

  try {
    window.localStorage.removeItem('tano.preference.tableSource');
    window.localStorage.removeItem('tano.preference.renderMath');
    window.localStorage.removeItem('tano.preference.showMathSource');
  } catch {
    // Device storage may be unavailable in restricted browser contexts.
  }

  const editorPreferences = ref<EditorPreferences>({
    copyFormat: normalizeCopyFormat(readTextPreference('copyFormat')),
    autoSpacing: readPreference('autoSpacing', defaultEditorPreferences.autoSpacing ?? false),
    completeTextSpacing: readPreference('completeTextSpacing', false),
    previewMathWhileEditing: readPreference(
      'previewMathWhileEditing',
      defaultEditorPreferences.previewMathWhileEditing,
    ),
    previewMermaidWhileEditing: readPreference(
      'previewMermaidWhileEditing',
      defaultEditorPreferences.previewMermaidWhileEditing ?? true,
    ),
    folding: readPreference('folding', defaultEditorPreferences.folding),
    blankBlockAiShortcut: readPreference(
      'blankBlockAiShortcut',
      defaultEditorPreferences.blankBlockAiShortcut,
    ),
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
      savePreference('completeTextSpacing', preferences.completeTextSpacing === true);
      savePreference('previewMathWhileEditing', preferences.previewMathWhileEditing);
      savePreference(
        'previewMermaidWhileEditing',
        preferences.previewMermaidWhileEditing !== false,
      );
      savePreference('folding', preferences.folding);
      savePreference('blankBlockAiShortcut', preferences.blankBlockAiShortcut);
      saveTextPreference(
        'selectionWrapping',
        JSON.stringify(normalizeSelectionWrapping(preferences.selectionWrapping)),
      );
      saveTextPreference(
        'markdownAutocomplete',
        JSON.stringify(normalizeMarkdownAutocomplete(preferences.markdownAutocomplete)),
      );
      saveTextPreference(
        'chineseInput',
        JSON.stringify(normalizeChineseInput(preferences.chineseInput)),
      );
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
      else if (document.documentElement.dataset.motion === 'reduced')
        delete document.documentElement.dataset.motion;
    },
    { immediate: true },
  );

  // Page & workspace read-only locks
  const pageLocked = ref(false);
  const workspaceLocked = ref(false);
  watch(
    () => workspace.value?.id,
    (id) => {
      workspaceLocked.value = !!id && readPreference(`workspaceLocked.${id}`, false);
    },
    { immediate: true },
  );
  function toggleWorkspaceLock() {
    const id = workspace.value?.id;
    if (!id) return;
    workspaceLocked.value = !workspaceLocked.value;
    savePreference(`workspaceLocked.${id}`, workspaceLocked.value);
  }
  function togglePageLock() {
    const currentWorkspace = workspace.value;
    const doc = active.value;
    if (!currentWorkspace || !doc || workspaceLocked.value) return;
    pageLocked.value = !pageLocked.value;
    savePreference(pageLockPreferenceKey(currentWorkspace.id, doc.id), pageLocked.value);
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

  return {
    sidebarWidth,
    resizingSidebar,
    SIDEBAR_MIN_WIDTH,
    sidebarWidthLimit,
    defaultSidebarWidth,
    startSidebarResize,
    moveSidebarResize,
    finishSidebarResize,
    resizeSidebarWithKeyboard,
    constrainSidebarToViewport,
    appearanceController,
    appearance,
    theme,
    defaultSource,
    revealMarkdown,
    toolbarMode,
    shortcuts,
    shortcutHint,
    visualFontChoice,
    customFontName,
    splitFontSettings,
    selectedVisualFontFamily,
    visualFontSize,
    sourceFontSize,
    showPageTitle,
    developerMode,
    showAllLineNumbers,
    showDocumentProperties,
    showDocumentDiscussion,
    limitPageWidth,
    pageWidthWritable,
    setLimitPageWidth,
    editorPreferences,
    pageLocked,
    workspaceLocked,
    toggleWorkspaceLock,
    togglePageLock,
  };
}
