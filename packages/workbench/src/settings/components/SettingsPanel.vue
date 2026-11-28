<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import {
  BookOpen,
  Bot,
  CircleHelp,
  ExternalLink,
  FileText,
  FileType,
  House,
  Keyboard,
  Palette,
  PanelTop,
  PencilLine,
  Search,
  Server,
  UserRound,
  X,
} from 'lucide-vue-next';
import { defaultCapabilities, defaultEditorPreferences, type EditorPreferences } from '@tano/editor/runtime';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { isFeatureEnabled } from '../../features';
import { SettingsSshPage } from '../../shell/workbench-async-components';
import { glassMaterials, type AppearanceSelection } from '../../appearance/appearance';
import { defaultSplitFontSettings, type SplitFontSettings, type VisualFontChoice } from '../../appearance/editor-font';
import { glassWallpaper } from '../../appearance/glass-wallpaper';
import { t, uiSearchText } from '../../i18n/i18n';
import { vEnterStagger } from '../../shell/enter-stagger';
import { readSettingsPage, rememberSettingsPage } from '../settings-preference';
import { defaultShortcutBindings, type ShortcutBindings } from '../../shell/shortcuts';
import { fixedColorMode, type ThemePreference } from '../../appearance/theme';
import type { ToolbarMode } from '../../shell/toolbar-preference';
import { useWindowContext } from '../../windows/context';
import type { CapabilityPatch } from '../../workspace/workspace-capabilities';
import type { WorkspaceSettingsPatch } from '../../workspace/workspace-settings';
import '../../styles/settings.css';
import AssistantSettings from '../../assistant/components/AssistantSettings.vue';
import ModalBackdrop from '../../shell/components/ModalBackdrop.vue';
import PluginSurface from '../../plugins/components/PluginSurface.vue';
import ShortcutSettings from './ShortcutSettings.vue';
import WorkspaceIcon from '../../workspace/components/WorkspaceIcon.vue';
import SettingsAboutPage from './SettingsAboutPage.vue';
import SettingsAppearancePage from './SettingsAppearancePage.vue';
import SettingsDocumentAppearancePage from './SettingsDocumentAppearancePage.vue';
import SettingsDocumentsPage from './SettingsDocumentsPage.vue';
import SettingsEditingPage from './SettingsEditingPage.vue';
import SettingsWorkspacePage from './SettingsWorkspacePage.vue';
import {
  settingsPanelContextKey,
  type SettingsAction,
  type SettingsPanelProps,
} from './settings-context';
import { buildSettingSearchEntries, type SettingSearchEntry } from './settings-search';

const { window, document } = useWindowContext();
type Page = string;

const props = defineProps<SettingsPanelProps>();

const emit = defineEmits<{
  close: [];
  'open-tab': [page: string];
  'open-window': [page: string];
  'page-change': [page: string];
  'drag-window': [event: MouseEvent];
  'update:developerMode': [value: boolean];
  'update:defaultSource': [value: boolean];
  'update:theme': [value: ThemePreference];
  appearance: [selection: AppearanceSelection];
  'update:visualFontChoice': [value: VisualFontChoice];
  'update:customFontName': [value: string];
  'update:splitFontSettings': [value: SplitFontSettings];
  'update:revealMarkdown': [value: boolean];
  'update:toolbarMode': [value: ToolbarMode];
  'update:shortcuts': [value: ShortcutBindings];
  'update:showPageTitle': [value: boolean];
  'update:showDocumentProperties': [value: boolean];
  'update:showDocumentDiscussion': [value: boolean];
  'update:showOutline': [value: boolean];
  'update:outlineOnLeft': [value: boolean];
  'update:visualFontSize': [value: number];
  'update:sourceFontSize': [value: number];
  action: [value: SettingsAction];
  capability: [value: CapabilityPatch];
  'update:editorPreferences': [value: EditorPreferences];
  'assistant-changed': [];
  'workspace-setting': [workspaceId: string, patch: WorkspaceSettingsPatch];
  'workspace-settings-reload': [];
  'workspace-export': [workspaceId: string];
  'workspace-delete': [workspaceId: string];
}>();

const fixedDisplayMode = computed(() => fixedColorMode(props.appearance?.color));
/** The background image only exists for the glass materials (frosted and liquid), so its row follows the active material. */
const frostActive = computed(
  () => !!glassWallpaper() && glassMaterials.includes(props.appearance?.active.material ?? ''),
);
const displayMode = computed(() => fixedDisplayMode.value ?? props.theme);
const displayModeDescription = computed(() =>
  fixedDisplayMode.value === 'light'
    ? '当前配色主题仅支持浅色。'
    : fixedDisplayMode.value === 'dark'
      ? '当前配色主题仅支持深色。'
      : '选择浅色、深色或跟随系统，偏好在工作区间共用。',
);
const showDeveloperMode = computed(() => !props.mobile);
const developerModeDescription = computed(() =>
  props.native
    ? '开启后，可在插件中心访问开发者区（导入、工坊、调试与投稿），也可右键顶部标签栏空白处打开调试窗口。'
    : '开启后，可在插件中心访问开发者区（导入插件、工坊、开发监听、运行日志与投稿）。',
);
const rules = computed(() => props.capabilities ?? defaultCapabilities);
const splitFonts = computed(
  () =>
    props.splitFontSettings ?? defaultSplitFontSettings(props.visualFontChoice, props.customFontName),
);
const display = computed(() => props.editorPreferences ?? defaultEditorPreferences);
const rulesDisabled = computed(
  () =>
    !props.workspace ||
    props.workspace.readOnly ||
    !(props.workspace.canManageSettings ?? props.mode !== 'web') ||
    props.capabilitySaving ||
    !!props.capabilityError,
);

const search = ref('');
const settingsDialog = ref<HTMLElement>();
const mainContent = ref<HTMLElement>();
const page = ref<Page>(
  props.initialPage === 'preferences'
    ? 'appearance'
    : (props.initialPage ?? readSettingsPage()),
);
watch(
  () => props.initialPage,
  (value) => {
    if (value) page.value = value === 'preferences' ? 'appearance' : value;
  },
);
const originalFocus = document.activeElement as HTMLElement | null;

const pages = [
  {
    id: 'appearance',
    get label() { return t('界面外观'); },
    get group() { return t('个人偏好'); },
    icon: Palette,
    get terms() { return uiSearchText('界面外观') + ' ' + uiSearchText('外观设置') + ' ' + uiSearchText('外观 主题 白天 黑夜 深色 浅色 跟随系统 界面字体 语言 材质 布局 图标 形态 密度 界面动效 减少界面动态效果 减少动态效果 页面入场动画 帮助 上手 引导 气泡 偶尔显示使用提示'); },
  },
  {
    id: 'document-appearance',
    get label() { return t('文档外观'); },
    get group() { return t('个人偏好'); },
    icon: FileType,
    get terms() { return uiSearchText('文档外观') + ' ' + uiSearchText('字体 系统字体 衬线字体 等宽字体 Mono Maple 自定义字体 中文字体 英文字体 字号 字体大小 正文自动间距 页面内标题 属性 文档属性 文档讨论 评论 显示目录 文档大纲 目录位置 左侧 右侧 编辑工具栏 选区 顶部 固定 编辑动效 减少编辑动态效果 光标平滑移动 打字 段落 动效'); },
  },
  {
    id: 'editing',
    get label() { return t('编辑器'); },
    get group() { return t('个人偏好'); },
    icon: PencilLine,
    get terms() { return uiSearchText('编辑设置') + ' ' + uiSearchText('编辑器 Markdown 源码 默认编辑模式 光标 语法 展开 编辑 Reveal 数学 公式 KaTeX Mermaid 标题 列表 折叠 复制 剪贴板 AI 符号 包裹 自动配对 斜体 粗体 删除线 高亮 代码 上标 下标 下划线 注释 自动补全 中文输入优化'); },
  },
  {
    id: 'shortcuts',
    get label() { return t('快捷键'); },
    get group() { return t('个人偏好'); },
    icon: Keyboard,
    get terms() { return uiSearchText('键盘 快捷键 按键 组合键 热键 shortcut keybinding Ctrl Command 保存 搜索 查找 替换 侧栏 新建 默认'); },
  },
  {
    id: 'assistant',
    get label() { return t('助手'); },
    get group() { return t('个人偏好'); },
    icon: Bot,
    get terms() { return uiSearchText('助手设置') + ' ' + uiSearchText('助手 模型 连接 API 密钥 Codex CLI Claude CLI token 工具调用 个人设置'); },
  },
  {
    id: 'ssh',
    get label() { return t('SSH 远程'); },
    get group() { return t('个人偏好'); },
    icon: Server,
    get terms() { return uiSearchText('SSH 远程 服务器 SFTP known_hosts 指纹 密钥 跳板机 远端工作区'); },
  },
  {
    id: 'workspace',
    get label() { return t('基本设置'); },
    get group() { return t('工作区设置'); },
    icon: BookOpen,
    get terms() { return uiSearchText('文件夹 历史 回收站 Agent 存储 当前空间 名称 图标 表情 默认页面 首页 页面标题来源 文件名 YAML title 侧栏 计划 图谱 插件 导出 ZIP 浏览统计 人物 目录 活动 悬浮卡片 ID 删除'); },
  },
  {
    id: 'documents',
    get label() { return t('Markdown 与格式'); },
    get group() { return t('工作区设置'); },
    icon: FileText,
    get terms() { return `${uiSearchText('文档能力')} ${uiSearchText('Markdown 数学 公式 Math Mermaid Wiki Links 提示块 脚注 HTML 嵌入 对象 引用 折叠 标签页 分栏 附件 输出 语法 方言 无序列表 标记 Obsidian GitHub Pandoc CommonMark')}`; },
  },
  {
    id: 'about',
    get label() { return t('关于同页'); },
    get group() { return t('帮助'); },
    icon: CircleHelp,
    get terms() { return uiSearchText('版本 更新 检查更新 Tano 存储 Markdown Agent'); },
  },
] as const;

const settingSearchEntries = computed<SettingSearchEntry[]>(() =>
  buildSettingSearchEntries({
    displayModeDescription: displayModeDescription.value,
    hasAppearance: !!props.appearance,
    frostActive: frostActive.value,
    splitFontsEnabled: splitFonts.value.enabled,
    showDeveloperMode: showDeveloperMode.value,
    developerModeDescription: developerModeDescription.value,
  }),
);
const availableExtraPages = computed(() =>
  (props.extraPages ?? []).filter(
    (item) =>
      (props.workspace || t(item.group) !== t('工作区设置')) &&
      (!item.isVisible ||
        item.isVisible({
          mode: props.mode,
          workspace: props.workspace,
          activeFile: props.activeFile ?? null,
        })),
  ),
);
const availablePluginPages = computed(() =>
  props.workspace
    ? (props.pluginPages ?? []).filter((item) => item.workspaceId === props.workspace!.id)
    : [],
);
const availablePages = computed(() => [
  ...pages.filter(
    (item) =>
      (props.workspace || (item.id !== 'workspace' && item.id !== 'documents')) &&
      (item.id !== 'ssh' || (isFeatureEnabled('sshRemoteWorkspace') && props.native && !props.mobile)),
  ),
  ...availableExtraPages.value.map((item) => ({ ...item, group: t(item.group), icon: item.icon ?? UserRound })),
  ...availablePluginPages.value.map((item) => ({
    id: item.view.key,
    label: item.view.label,
    group: t('插件设置'),
    terms: item.view.pluginName,
    icon: UserRound,
  })),
]);
const settingSearchMatches = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return [];
  return settingSearchEntries.value.filter(
    (item) =>
      availablePages.value.some((candidate) => candidate.id === item.page) &&
      `${item.label} ${item.description ?? ''} ${item.terms}`.toLocaleLowerCase().includes(query),
  );
});
const settingMatchesByPage = computed(() => {
  const result = new Map<Page, SettingSearchEntry[]>();
  for (const item of settingSearchMatches.value)
    result.set(item.page, [...(result.get(item.page) ?? []), item]);
  return result;
});
// Validate against scope independently of search, including direct navigation requests.
watch(
  [availablePages, page],
  ([items]) => {
    if (!items.some((item) => item.id === page.value)) page.value = 'appearance';
  },
  { immediate: true },
);
const visiblePages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return availablePages.value.filter(
    (item) =>
      `${item.group} ${item.label} ${item.terms}`.toLocaleLowerCase().includes(query) ||
      settingMatchesByPage.value.has(item.id),
  );
});
const navigationGroups = computed(() =>
  [t('账号'), t('个人偏好'), t('工作区设置'), t('插件设置'), t('帮助')]
    .map((label) => ({ label, pages: visiblePages.value.filter((item) => item.group === label) }))
    .filter((group) => group.pages.length),
);
const workspacePage = computed(() => page.value === 'workspace' || page.value === 'documents');
const scopeLabel = computed(() =>
  workspacePage.value
    ? t('工作区设置 · {0}', [props.workspace?.name ?? t('尚未打开工作区')])
    : t('个人偏好 · 当前设备'),
);

provide(settingsPanelContextKey, {
  props,
  scopeLabel,
  display,
  rules,
  rulesDisabled,
  fixedDisplayMode,
  frostActive,
  displayMode,
  displayModeDescription,
  showDeveloperMode,
  developerModeDescription,
  splitFonts,
  emitUpdateDeveloperMode: (value) => emit('update:developerMode', value),
  emitUpdateDefaultSource: (value) => emit('update:defaultSource', value),
  emitUpdateTheme: (value) => emit('update:theme', value),
  emitAppearance: (selection) => emit('appearance', selection),
  emitUpdateVisualFontChoice: (value) => emit('update:visualFontChoice', value),
  emitUpdateCustomFontName: (value) => emit('update:customFontName', value),
  emitUpdateSplitFontSettings: (value) => emit('update:splitFontSettings', value),
  emitUpdateRevealMarkdown: (value) => emit('update:revealMarkdown', value),
  emitUpdateToolbarMode: (value) => emit('update:toolbarMode', value),
  emitUpdateShortcuts: (value) => emit('update:shortcuts', value),
  emitUpdateShowPageTitle: (value) => emit('update:showPageTitle', value),
  emitUpdateShowDocumentProperties: (value) => emit('update:showDocumentProperties', value),
  emitUpdateShowDocumentDiscussion: (value) => emit('update:showDocumentDiscussion', value),
  emitUpdateShowOutline: (value) => emit('update:showOutline', value),
  emitUpdateOutlineOnLeft: (value) => emit('update:outlineOnLeft', value),
  emitUpdateVisualFontSize: (value) => emit('update:visualFontSize', value),
  emitUpdateSourceFontSize: (value) => emit('update:sourceFontSize', value),
  emitAction: (value) => emit('action', value),
  emitCapability: (value) => emit('capability', value),
  emitUpdateEditorPreferences: (value) => emit('update:editorPreferences', value),
  emitWorkspaceSetting: (workspaceId, patch) => emit('workspace-setting', workspaceId, patch),
  emitWorkspaceSettingsReload: () => emit('workspace-settings-reload'),
  emitWorkspaceExport: (workspaceId) => emit('workspace-export', workspaceId),
  emitWorkspaceDelete: (workspaceId) => emit('workspace-delete', workspaceId),
});

const focusedSetting = ref('');
function focusSetting(id: string) {
  focusedSetting.value = id;
  const target = mainContent.value?.querySelector<HTMLElement>(`[data-settings-key="${id}"]`);
  target?.classList.add('settings-search-target');
  target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  window.setTimeout(() => {
    target?.classList.remove('settings-search-target');
    if (focusedSetting.value === id) focusedSetting.value = '';
  }, 1500);
}
function selectSetting(item: SettingSearchEntry) {
  focusedSetting.value = item.id;
  page.value = item.page;
  void nextTick(() => focusSetting(item.id));
}
watch(search, (value) => {
  if (!value.trim()) return;
  const first =
    settingSearchMatches.value.find((item) => item.page === page.value) ??
    settingSearchMatches.value[0];
  if (first) selectSetting(first);
});
watch(
  visiblePages,
  (items) => {
    if (items.length && !items.some((item) => item.id === page.value)) page.value = items[0].id;
  },
  { immediate: true },
);
const atTop = ref(true);
watch(
  page,
  () => {
    if (mainContent.value) mainContent.value.scrollTop = 0;
    atTop.value = true;
    emit('page-change', page.value);
  },
  { immediate: true },
);
watch(
  [page, () => props.rememberPage],
  ([value, remember]) => {
    if (remember !== false) rememberSettingsPage(value);
  },
  { immediate: true },
);
onMounted(() =>
  void nextTick(() => {
    const dialog = settingsDialog.value;
    const selectedPage = dialog?.querySelector<HTMLElement>(
      '.settings-nav button[aria-current="page"]',
    );
    (selectedPage ?? dialog)?.focus({ preventScroll: true });
  }),
);
onBeforeUnmount(() => {
  if (originalFocus?.isConnected) originalFocus.focus();
});

function keydown(event: KeyboardEvent) {
  if (props.tabbed) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
    ),
  ];
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<template>
  <ModalBackdrop
    v-surface-motion="!windowed && !tabbed ? 'SettingsPanel:0' : false"
    :active="!windowed && !tabbed"
    class="modal-backdrop settings-backdrop"
    :class="{ 'settings-windowed': windowed, 'settings-tabbed': tabbed }"
    :data-surface-role="!windowed && !tabbed ? 'backdrop' : undefined"
    @close="emit('close')"
  >
    <section
      ref="settingsDialog"
      class="settings-dialog workbench-modal-surface"
      :class="{ 'settings-tabbed-dialog': tabbed }"
      :data-surface-role="!windowed && !tabbed ? 'dialog' : undefined"
      tabindex="-1"
      :role="tabbed ? 'region' : 'dialog'"
      :aria-modal="!windowed && !tabbed ? true : undefined"
      aria-labelledby="settings-title"
      @keydown="keydown"
    >
      <div
        v-if="windowed"
        class="settings-window-drag-region"
        aria-hidden="true"
        @mousedown="emit('drag-window', $event)"
      />
      <aside class="settings-nav" :aria-label="t('设置分类')">
        <label class="settings-search">
          <Search :size="16" />
          <input
            v-model="search"
            type="search"
            :placeholder="t('搜索设置…')"
            :aria-label="t('搜索设置')"
          />
        </label>
        <div class="settings-nav-scroll panel-scrollbar">
          <div
            v-for="group in navigationGroups"
            :key="group.label"
            class="settings-nav-section"
            role="group"
            :aria-label="group.label"
          >
            <span v-if="group.label !== t('账号') || group.pages.length > 1" class="settings-nav-group">{{ group.label }}</span>
            <div class="settings-nav-items">
              <button
                v-for="item in group.pages"
                :key="item.id"
                type="button"
                :class="{ selected: page === item.id }"
                :aria-current="page === item.id ? 'page' : undefined"
                @click="page = item.id"
              >
                <component :is="item.icon" :size="16" :stroke-width="1.75" />{{ item.label }}
              </button>
            </div>
            <template v-for="item in group.pages" :key="`${item.id}-search-results`">
              <div v-if="search.trim() && settingMatchesByPage.has(item.id)" class="settings-nav-setting-results">
                <button
                  v-for="setting in settingMatchesByPage.get(item.id)"
                  :key="setting.id"
                  type="button"
                  class="settings-nav-setting"
                  :class="{ selected: focusedSetting === setting.id }"
                  @click="selectSetting(setting)"
                >
                  <span>{{ setting.label }}</span>
                </button>
              </div>
            </template>
          </div>
          <p v-if="!visiblePages.length" class="settings-search-empty">{{ t('没有找到相关设置') }}</p>
        </div>
        <div class="settings-nav-foot">
          <span class="settings-workspace-icon">
            <WorkspaceIcon v-if="workspace" :icon="workspaceSettings?.icon" :mode="mode" :size="17" />
            <House v-else :size="17" />
          </span>
          <div>
            <span>{{ workspace?.name ?? t('主页') }}</span>
            <small>{{
              !workspace
                ? t('个人偏好 · 当前设备')
                : mode === 'demo'
                  ? t('浏览器演示')
                  : mode === 'web'
                    ? t('在线工作区')
                    : t('本地工作区')
            }}</small>
          </div>
        </div>
      </aside>

      <button
        v-if="canOpenWindow && !windowed && !tabbed"
        class="settings-close settings-open-window"
        :class="{ 'settings-open-window-with-tab': canOpenTab, 'settings-action-hidden': !atTop }"
        :inert="!atTop"
        :aria-hidden="!atTop"
        type="button"
        :disabled="openingWindow"
        :aria-label="t('在新窗口打开')"
        :data-tooltip="t('在新窗口打开')"
        @click="emit('open-window', page)"
      >
        <ExternalLink :size="18" />
      </button>
      <button
        v-if="canOpenTab && !windowed && !tabbed"
        class="settings-close settings-open-tab"
        :class="{ 'settings-action-hidden': !atTop }"
        :inert="!atTop"
        :aria-hidden="!atTop"
        type="button"
        :aria-label="t('作为标签页打开')"
        :data-tooltip="t('作为标签页打开')"
        @click="emit('open-tab', page)"
      >
        <PanelTop :size="18" />
      </button>
      <button
        v-if="!windowed && !tabbed"
        class="settings-close"
        type="button"
        :aria-label="t('关闭设置')"
        :data-tooltip="t('关闭设置')"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>

      <!-- Switching sections builds the new page up row by row (About
           included). Pages wrap their sections differently (ShortcutSettings,
           SSH, plugin pages), so instead of naming each layout, `split`
           opens any block taller than a row into its stacked children; whole
           sections would otherwise rise as a few big slabs.
           As a dialog it already pops in, so opening does not replay it; as a
           tab or window it enters like any page. -->
      <main
        ref="mainContent"
        v-enter-stagger="{
          items: '.settings-content > *, .settings-main > .plugin-surface',
          split: 120,
          key: page,
          initial: !!(windowed || tabbed),
          spread: 300,
        }"
        class="settings-main panel-scrollbar"
        @scroll="atTop = ($event.target as HTMLElement).scrollTop <= 0"
      >
        <div v-if="!visiblePages.length" class="settings-content">
          <h2 id="settings-title">{{ t('搜索设置') }}</h2>
          <p class="settings-lead">{{ t('没有找到相关设置，请尝试其他关键词。') }}</p>
        </div>
        <SettingsAppearancePage v-else-if="page === 'appearance'" />
        <SettingsDocumentAppearancePage v-else-if="page === 'document-appearance'" />
        <SettingsEditingPage v-else-if="page === 'editing'" />
        <AssistantSettings v-else-if="page === 'assistant'" @changed="emit('assistant-changed')" />
        <div v-else-if="page === 'ssh'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ t('SSH 远程') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <UserRound :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">
            {{ t('连接远端 SSH 服务器，直接浏览、预览和编辑服务器上的工作区目录。') }}
          </p>
          <SettingsSshPage />
        </div>
        <SettingsDocumentsPage v-else-if="page === 'documents'" />
        <SettingsWorkspacePage v-else-if="page === 'workspace'">
          <template #workspace-members-export><slot name="workspace-members-export" /></template>
        </SettingsWorkspacePage>
        <div v-else-if="page === 'shortcuts'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ t('快捷键') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <UserRound :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">{{ t('为常用操作设置顺手的组合键。') }}</p>
          <ShortcutSettings
            :bindings="shortcuts ?? defaultShortcutBindings"
            @change="emit('update:shortcuts', $event)"
          />
        </div>
        <PluginSurface
          v-else-if="availablePluginPages.some((item) => item.view.key === page) && executePlugin"
          :key="page"
          :view="availablePluginPages.find((item) => item.view.key === page)!.view"
          :workspace-id="availablePluginPages.find((item) => item.view.key === page)!.workspaceId"
          :runtime="availablePluginPages.find((item) => item.view.key === page)!.runtime"
          :execute="executePlugin"
        />
        <component
          v-else-if="availableExtraPages.some((item) => item.id === page)"
          :is="availableExtraPages.find((item) => item.id === page)?.component"
          :mode="mode"
          :workspace="workspace"
          :active-file="activeFile ?? null"
        />
        <SettingsAboutPage v-else>
          <template #update-panel><slot name="update-panel" /></template>
        </SettingsAboutPage>
      </main>
    </section>
  </ModalBackdrop>
</template>
