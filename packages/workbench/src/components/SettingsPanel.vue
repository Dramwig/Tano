<script setup lang="ts">
import ModalBackdrop from './ModalBackdrop.vue';
import { t, uiLocale, setUiLocale, uiSearchText } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CircleHelp,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Keyboard,
  LogOut,
  Minus,
  Monitor,
  PanelTop,
  Palette,
  PencilLine,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next';
import type { SettingsPage, SettingsPageContext } from '../runtime';
import type { PluginSettingsPage, PluginInteraction } from '../plugins/workbench';
import PluginSurface from './PluginSurface.vue';
import UpdatePanel from './UpdatePanel.vue';
import AssistantSettings from './AssistantSettings.vue';
import {
  featureDefinitions,
  defaultCapabilities,
  defaultEditorPreferences,
  normalizeSelectionWrapping,
  selectionWrappingOptions,
} from '@tano/editor/runtime';
import type { WorkspaceCapabilities, EditorPreferences } from '@tano/editor/runtime';
import type { CapabilityPatch } from '../workspace-capabilities';
import type { ThemePreference } from '../theme';
import { sanitizeCustomFontName, visualFontFamily } from '../editor-font';
import type { VisualFontChoice } from '../editor-font';
import type { ToolbarMode } from '../toolbar-preference';
import type { WorkspaceSettings, WorkspaceSettingsPatch } from '../workspace-settings';
import WorkspaceGeneralSettings from './WorkspaceGeneralSettings.vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
import WorkspaceDeletionSettings from './WorkspaceDeletionSettings.vue';
import ShortcutSettings from './ShortcutSettings.vue';
import { defaultShortcutBindings, shortcutDefinitions } from '../shortcuts';
import type { ShortcutBindings } from '../shortcuts';
import { useHelpPreferences } from '../help-guidance';

type Page = string;
type Action =
  'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out';

const props = defineProps<{
  workspace: SettingsPageContext['workspace'];
  workspaceSettings?: WorkspaceSettings;
  workspacePages?: { id: string; path: string }[];
  workspaceSettingsError?: string;
  workspaceSettingsSaving?: boolean;
  workspaceExporting?: boolean;
  workspaceExportError?: string;
  workspaceDeletionSupported?: boolean;
  workspaceDeleting?: boolean;
  workspaceDeletionError?: string;
  activeFile?: SettingsPageContext['activeFile'];
  windowed?: boolean;
  tabbed?: boolean;
  canOpenTab?: boolean;
  canOpenWindow?: boolean;
  openingWindow?: boolean;
  extraPages?: SettingsPage[];
  pluginPages?: PluginSettingsPage[];
  executePlugin?: (interaction: PluginInteraction) => Promise<void>;
  mode: 'demo' | 'web' | 'local';
  native: boolean;
  mobile: boolean;
  defaultSource: boolean;
  theme: ThemePreference;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  revealMarkdown: boolean;
  toolbarMode?: ToolbarMode;
  shortcuts?: ShortcutBindings;
  showPageTitle: boolean;
  showDocumentProperties: boolean;
  showDocumentDiscussion: boolean;
  showOutline: boolean;
  outlineOnLeft?: boolean;
  visualFontSize: number;
  sourceFontSize: number;
  historyEnabled: boolean;
  version: string;
  initialPage?: Page;
  capabilities?: WorkspaceCapabilities;
  editorPreferences?: EditorPreferences;
  capabilityError?: string;
  capabilitySaving?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  'open-tab': [page: string];
  'open-window': [page: string];
  'page-change': [page: string];
  'drag-window': [event: MouseEvent];
  'update:defaultSource': [value: boolean];
  'update:theme': [value: ThemePreference];
  'update:visualFontChoice': [value: VisualFontChoice];
  'update:customFontName': [value: string];
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
  action: [value: Action];
  capability: [value: CapabilityPatch];
  'update:editorPreferences': [value: EditorPreferences];
  'assistant-changed': [];
  'workspace-setting': [workspaceId: string, patch: WorkspaceSettingsPatch];
  'workspace-settings-reload': [];
  'workspace-export': [workspaceId: string];
  'workspace-delete': [workspaceId: string];
}>();
const rules = computed(() => props.capabilities ?? defaultCapabilities);
const { preferences: helpPreferences, setEnabled: setHelpEnabled } = useHelpPreferences();
const display = computed(() => props.editorPreferences ?? defaultEditorPreferences);
const wrapping = computed(() => normalizeSelectionWrapping(display.value.selectionWrapping));
const wrappingOptions = computed(() => selectionWrappingOptions.map(option => {
  const [input, output] = option.example.split('；')[0]!.split(' → ');
  const [opening, closing] = output!.split('文字');
  return { ...option, example: t(option.example), input: input?.replaceAll('文字', t('文字')), opening, closing };
}));
function setWrapping(key: keyof typeof wrapping.value, enabled: boolean) {
  emit('update:editorPreferences', { ...display.value, selectionWrapping: { ...wrapping.value, [key]: enabled } });
}
function displayOptionActive(key: keyof EditorPreferences) {
  return display.value[key] && (key !== 'previewMathWhileEditing' || props.revealMarkdown);
}
const rulesDisabled = computed(
  () =>
    !props.workspace ||
    props.workspace.readOnly ||
    !(props.workspace.canManageSettings ?? props.mode !== 'web') ||
    props.capabilitySaving ||
    !!props.capabilityError,
);
const displayOptions = [
  {
    key: 'previewMathWhileEditing',
    get label() { return t('编辑时预览公式'); },
    get description() { return t('展开 Markdown 源码编辑公式时同步显示排版效果。'); },
  },
  {
    key: 'folding',
    get label() { return t('标题与列表折叠'); },
    get description() { return t('显示折叠按钮，临时收起标题下的内容或列表项。'); },
  },
] as const;

const search = ref('');
const searchInput = ref<HTMLInputElement>();
const mainContent = ref<HTMLElement>();
const page = ref<Page>(props.initialPage === 'preferences' ? 'appearance' : props.initialPage ?? 'appearance');
watch(() => props.initialPage, value => {
  if (value) page.value = value === 'preferences' ? 'appearance' : value;
});
const originalFocus = document.activeElement as HTMLElement | null;
const pages = [
  {
    id: 'appearance',
    get label() { return t('外观设置'); },
    get group() { return t('个人偏好'); },
    icon: Palette,
    get terms() { return uiSearchText('外观 主题 白天 黑夜 深色 浅色 跟随系统 字体 系统字体 衬线字体 等宽字体 Mono Maple 自定义字体 字号 字体大小 页面内标题 属性 文档属性 文档讨论 评论 显示目录 文档大纲 目录位置 左侧 右侧 帮助 上手 引导 气泡 偶尔显示使用提示'); },
  },
  {
    id: 'editing',
    get label() { return t('编辑设置'); },
    get group() { return t('个人偏好'); },
    icon: PencilLine,
    get terms() { return uiSearchText('编辑器 Markdown 源码 默认编辑模式 光标 语法 展开 编辑 Reveal 数学 公式 KaTeX 标题 列表 折叠 工具栏 选区 顶部 固定 胶囊 符号 包裹 自动配对 斜体 粗体 删除线 高亮 代码 上标 下标 下划线 注释'); },
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
    get label() { return t('助手设置'); },
    get group() { return t('个人偏好'); },
    icon: Bot,
    get terms() { return uiSearchText('助手 模型 连接 API 密钥 Codex CLI Claude CLI token 工具调用 个人设置'); },
  },
  {
    id: 'workspace',
    get label() { return t('工作区'); },
    get group() { return t('工作区设置'); },
    icon: BookOpen,
    get terms() { return uiSearchText('文件夹 历史 回收站 Agent 存储 当前空间 名称 图标 表情 默认页面 首页 页面标题来源 文件名 YAML title 侧栏 计划 图谱 插件 导出 ZIP 浏览统计 人物 目录 活动 悬浮卡片 ID 删除'); },
  },
  {
    id: 'documents',
    get label() { return t('文档能力'); },
    get group() { return t('工作区设置'); },
    icon: FileText,
    get terms() { return uiSearchText('Markdown 数学 公式 Math Mermaid Wiki Links 提示块 脚注 HTML 嵌入 对象 引用 折叠 标签页 分栏 附件 输出 语法 方言 无序列表 标记 Obsidian GitHub Pandoc CommonMark'); },
  },
  {
    id: 'about',
    get label() { return t('关于同页'); },
    get group() { return t('帮助'); },
    icon: CircleHelp,
    get terms() { return uiSearchText('版本 更新 检查更新 Tano 存储 Markdown Agent'); },
  },
] as const;

type SettingSearchEntry = {
  id: string;
  page: Page;
  label: string;
  description?: string;
  terms: string;
};

function settingSearchEntry(page: Page, id: string, label: string, description = '', extra = ''): SettingSearchEntry {
  return {
    id,
    page,
    label: t(label),
    description: description ? t(description) : undefined,
    terms: `${uiSearchText(label)} ${uiSearchText(description)} ${extra}`,
  };
}

const settingSearchEntries = computed<SettingSearchEntry[]>(() => [
  settingSearchEntry('appearance', 'appearance-auto-spacing', '正文自动间距', '在中文与英文、数字、行内公式及引用之间自动留白，仅影响显示，不修改原文。', 'spacing typography 中英文 数字 公式 引用 空格 排版'),
  settingSearchEntry('appearance', 'appearance-language', '界面语言', '立即切换界面语言，仅保存在当前设备。', 'language English 中文'),
  settingSearchEntry('appearance', 'appearance-theme', '主题', '选择应用外观，或随系统外观自动切换。', 'theme light dark system 白天 黑夜 深色 浅色'),
  settingSearchEntry('appearance', 'appearance-visual-font', '可视化编辑字体', '选择内置字体，或使用本机已安装的字体。', 'font system serif mono Maple custom'),
  settingSearchEntry('appearance', 'appearance-custom-font', '字体名称', '输入本机字体名称；未安装时会回退到系统字体。', 'custom font'),
  settingSearchEntry('appearance', 'appearance-visual-size', '可视化编辑字号', '调整正文、标题和编辑中的内容大小。', 'font size'),
  settingSearchEntry('appearance', 'appearance-source-size', 'Markdown 源码字号', '调整源码视图中的文字大小。', 'source font size'),
  settingSearchEntry('appearance', 'appearance-page-title', '页面内标题', '在编辑区顶部显示当前文档标题。', 'title'),
  settingSearchEntry('appearance', 'appearance-properties', '文档属性', '在可视化编辑区显示文档属性。', 'properties frontmatter'),
  settingSearchEntry('appearance', 'appearance-discussion', '文档讨论', '有讨论时在文档底部显示，没有讨论时自动隐藏。', 'comments discussion'),
  settingSearchEntry('appearance', 'appearance-outline', '显示目录', '', 'outline table of contents'),
  settingSearchEntry('appearance', 'appearance-outline-position', '目录显示在左侧', '将文档大纲放到编辑区左侧。', 'outline left right'),
  settingSearchEntry('appearance', 'appearance-help', '偶尔显示使用提示', '在你停下来时，在帮助按钮上方显示简短的用法提示。关闭后仍可手动查看帮助。', 'help tips hints'),
  settingSearchEntry('editing', 'editing-default-mode', '默认编辑模式', '选择打开文档时使用的视图。', 'editor visual Markdown source'),
  settingSearchEntry('editing', 'editing-reveal-markdown', '光标进入时展开 Markdown 源码', '类似 Typora、Obsidian 的实时预览：光标进入时显示 Markdown 语法，离开后恢复排版。', 'live preview source syntax'),
  settingSearchEntry('editing', 'editing-toolbar', '编辑工具栏', '随选区显示，或停靠在顶部、底部、左侧、右侧；也可拖动工具栏手柄调整。仅影响当前设备。', 'toolbar selection top bottom left right'),
  settingSearchEntry('editing', 'editing-preview-math', '编辑时预览公式', '展开 Markdown 源码编辑公式时同步显示排版效果。', 'math formula preview'),
  settingSearchEntry('editing', 'editing-folding', '标题与列表折叠', '显示折叠按钮，临时收起标题下的内容或列表项。', 'heading list folding collapse'),
  settingSearchEntry('editing', 'editing-ai-shortcut', '空白块按空格启动 AI', '在空白 block 中按空格，直接展开一次性 AI 编辑输入框。', 'AI space block'),
  settingSearchEntry('editing', 'editing-wrapping', '输入符号包裹选区', '选中文字后输入符号，自动补齐两端。可视化与源码模式通用。', 'selection wrapping symbols'),
  ...selectionWrappingOptions.map(option => settingSearchEntry('editing', `editing-wrapping-${option.key}`, option.label, option.example, 'selection wrapping Markdown')),
  ...shortcutDefinitions.map(item => settingSearchEntry('shortcuts', `shortcut-${item.id}`, item.label, 'scope' in item ? item.scope : '', 'shortcut keybinding keyboard')),
  settingSearchEntry('assistant', 'assistant-connections', '模型连接', '管理助手使用的 API 或 CLI 连接。', 'assistant model connection API CLI'),
  ...featureDefinitions.map(feature => settingSearchEntry('documents', `documents-${feature.key}`, feature.label, '', 'Markdown extension')),
  settingSearchEntry('documents', 'documents-dialect', 'Markdown 方言', '决定新公式的默认写法：Pandoc 使用 LaTeX 定界符，其余使用美元符号。解析始终兼容两种写法。', 'dialect Obsidian GitHub Pandoc CommonMark'),
  settingSearchEntry('documents', 'documents-math-syntax', '公式输出语法', '默认保留已有公式的原始定界符。选择统一语法后，在下一次编辑保存正文时应用。', 'math formula syntax LaTeX Dollar'),
  settingSearchEntry('documents', 'documents-bullet-marker', '无序列表标记', '选择无序列表与待办列表的 Markdown 标记，在下一次编辑保存正文时应用。', 'bullet list marker'),
  settingSearchEntry('workspace', 'workspace-name', '工作区名称', '最多 65 个字符，显示在侧栏和工作区菜单中。', 'workspace name'),
  settingSearchEntry('workspace', 'workspace-icon', '图标', '选择内置图标、表情符号或上传图片，显示在侧栏和工作区菜单中。', 'workspace icon emoji'),
  settingSearchEntry('workspace', 'workspace-home-page', '默认打开页面', '首次打开时进入此页面；已有会话会恢复上次打开的标签页。', 'home page default'),
  settingSearchEntry('workspace', 'workspace-title-source', '页面标题来源', '适用于当前工作区的所有页面。仅“YAML title 优先”在字段为空或无效时使用文件名。', 'title source filename YAML'),
  settingSearchEntry('workspace', 'workspace-show-plan', '显示计划', '在侧栏显示计划与日历入口。', 'sidebar plan calendar'),
  settingSearchEntry('workspace', 'workspace-show-graph', '显示关系图谱', '在侧栏顶部显示关系图谱入口。', 'sidebar graph'),
  settingSearchEntry('workspace', 'workspace-show-plugins', '显示插件', '在侧栏顶部显示插件管理入口。', 'sidebar plugins'),
  settingSearchEntry('workspace', 'workspace-show-collaboration-views', '显示协作应用', '在在线工作区侧栏显示聊天、收件箱等协作入口。', 'sidebar collaboration chat inbox'),
  settingSearchEntry('workspace', 'workspace-export', '工作区内容', '将已保存的 Markdown、附件和工作区设置导出为 ZIP，保留文件夹结构。', 'export ZIP backup'),
  settingSearchEntry('workspace', 'workspace-page-views', '保存并显示页面浏览统计', '页面浏览量统计尚未实现，当前不会收集浏览数据。', 'analytics statistics views'),
  settingSearchEntry('workspace', 'workspace-people', '人物目录', '在工作区对象列表中显示人物；关闭后仍可通过已有引用访问人物。', 'people directory'),
  settingSearchEntry('workspace', 'workspace-id', '工作区 ID', '', 'workspace id identifier'),
  settingSearchEntry('workspace', 'workspace-delete', '删除当前工作区', '移除当前设备上的工作区注册。', 'workspace delete remove'),
  settingSearchEntry('about', 'about-updates', '版本与更新', '检查并安装同页更新。', 'version update'),
]);
const settingSearchMatches = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return [];
  return settingSearchEntries.value.filter(item => `${item.label} ${item.description ?? ''} ${item.terms}`.toLocaleLowerCase().includes(query));
});
const settingMatchesByPage = computed(() => {
  const result = new Map<Page, SettingSearchEntry[]>();
  for (const item of settingSearchMatches.value) result.set(item.page, [...(result.get(item.page) ?? []), item]);
  return result;
});
const visiblePages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return [...pages, ...(props.extraPages ?? []).map(item => ({ ...item, group: t(item.group), icon: item.icon ?? UserRound })),
    ...(props.pluginPages ?? []).map(item => ({ id: item.view.key, label: item.view.label, get group() { return t('插件设置'); }, terms: item.view.pluginName, icon: UserRound }))].filter(
    (item) =>
      `${item.group} ${item.label} ${item.terms}`.toLocaleLowerCase().includes(query) ||
      settingMatchesByPage.value.has(item.id),
  );
});
const navigationGroups = computed(() =>
  [t('个人偏好'), t('工作区设置'), t('插件设置'), t('帮助')]
    .map((label) => ({ label, pages: visiblePages.value.filter((item) => item.group === label) }))
    .filter((group) => group.pages.length),
);
const workspacePage = computed(() => page.value === 'workspace' || page.value === 'documents');
const scopeLabel = computed(() =>
  workspacePage.value
    ? t('工作区设置 · {0}', [props.workspace?.name ?? t('尚未打开工作区')])
    : t('个人偏好 · 当前设备'),
);
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
watch(search, value => {
  if (!value.trim()) return;
  const first = settingSearchMatches.value.find(item => item.page === page.value) ?? settingSearchMatches.value[0];
  if (first) selectSetting(first);
});
watch(visiblePages, (items) => {
  if (items.length && !items.some((item) => item.id === page.value)) page.value = items[0].id;
});
const atTop = ref(true);
watch(page, () => {
  if (mainContent.value) mainContent.value.scrollTop = 0;
  atTop.value = true;
  emit('page-change', page.value);
});
onMounted(() => void nextTick(() => searchInput.value?.focus()));
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
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function customFontInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = sanitizeCustomFontName(input.value);
  if (input.value !== value) input.value = value;
  emit('update:customFontName', value);
}
</script>

<template>
  <ModalBackdrop :active="!windowed && !tabbed" class="modal-backdrop settings-backdrop" :class="{ 'settings-windowed': windowed, 'settings-tabbed': tabbed }" @close="emit('close')">
    <section
      class="settings-dialog workbench-modal-surface"
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
            ref="searchInput"
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
            <span class="settings-nav-group">{{ group.label }}</span>
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
          <span class="settings-workspace-icon"><WorkspaceIcon :icon="workspaceSettings?.icon" :mode="mode" :size="17" /></span>
          <div>
            <span>{{ workspace?.name ?? t('尚未打开工作区') }}</span>
            <small>{{
              mode === 'demo' ? t('浏览器演示') : mode === 'web' ? t('在线工作区') : t('本地工作区')
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
      ><ExternalLink :size="18" /></button>
      <button
        v-if="canOpenTab && !tabbed"
        class="settings-close settings-open-tab"
        :class="{ 'settings-action-hidden': !atTop }"
        :inert="!atTop"
        :aria-hidden="!atTop"
        type="button"
        :aria-label="t('作为标签页打开')"
        :data-tooltip="t('作为标签页打开')"
        @click="emit('open-tab', page)"
      ><PanelTop :size="18" /></button>
      <button
        v-if="!tabbed"
        class="settings-close"
        type="button"
        :aria-label="t('关闭设置')"
        :data-tooltip="t('关闭设置')"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
      <main ref="mainContent" class="settings-main panel-scrollbar" @scroll="atTop = ($event.target as HTMLElement).scrollTop <= 0">
        <div v-if="!visiblePages.length" class="settings-content">
          <h2 id="settings-title">{{ t('搜索设置') }}</h2>
          <p class="settings-lead">{{ t('没有找到相关设置，请尝试其他关键词。') }}</p>
        </div>
        <div v-else-if="page === 'appearance' || page === 'editing'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ page === 'appearance' ? t('外观设置') : t('编辑设置') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <Monitor :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">{{ page === 'appearance' ? t('适用于这台设备上的所有工作区，仅影响你的显示效果。') : t('适用于这台设备上的所有工作区，仅影响你的编辑体验。') }}</p>
          <section v-if="page === 'appearance'" class="settings-section" :aria-label="t('外观')">
            <h3>{{ t('外观') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="appearance-language">
                <div>
                  <strong>{{ t('界面语言') }}</strong>
                  <p>{{ t('立即切换界面语言，仅保存在当前设备。') }}</p>
                </div>
                <select :value="uiLocale" :aria-label="t('界面语言')"
                  @change="setUiLocale(($event.target as HTMLSelectElement).value)">
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
              <div class="settings-row" data-settings-key="appearance-theme">
                <div>
                  <strong>{{ t('主题') }}</strong>
                  <p>{{ t('选择应用外观，或随系统外观自动切换。') }}</p>
                </div>
                <select
                  :value="theme"
                  :aria-label="t('主题')"
                  @change="emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"
                >
                  <option value="light">{{ t('白天') }}</option>
                  <option value="dark">{{ t('黑夜') }}</option>
                  <option value="system">{{ t('跟随系统') }}</option>
                </select>
              </div>
            </div>
          </section>
          <section v-if="page === 'editing'" class="settings-section" aria-labelledby="settings-editor">
            <h3 id="settings-editor">{{ t('编辑器') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="editing-default-mode">
                <div>
                  <strong>{{ t('默认编辑模式') }}</strong>
                  <p>{{ t('选择打开文档时使用的视图。') }}</p>
                </div>
                <select
                  :value="defaultSource ? 'source' : 'visual'"
                  :aria-label="t('默认编辑模式')"
                  @change="
                    emit(
                      'update:defaultSource',
                      ($event.target as HTMLSelectElement).value === 'source',
                    )
                  "
                >
                  <option value="visual">{{ t('可视化编辑') }}</option>
                  <option value="source">{{ t('Markdown 源码') }}</option>
                </select>
              </div>
              <div class="settings-row" data-settings-key="editing-reveal-markdown">
                <div>
                  <strong>{{ t('光标进入时展开 Markdown 源码') }}</strong>
                  <p>{{ t('类似 Typora、Obsidian 的实时预览：光标进入时显示 Markdown 语法，离开后恢复排版。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: revealMarkdown }"
                  role="switch"
                  :aria-checked="revealMarkdown"
                  :aria-label="t('光标进入时展开 Markdown 源码')"
                  @click="emit('update:revealMarkdown', !revealMarkdown)"
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
          <section v-if="page === 'appearance'" class="settings-section" data-settings-key="appearance-custom-font" :aria-label="t('编辑字体与字号')">
            <h3>{{ t('编辑字体与字号') }}</h3>
            <div class="settings-card settings-font-card">
              <div class="settings-row" data-settings-key="appearance-visual-font">
                <div>
                  <strong>{{ t('可视化编辑字体') }}</strong>
                  <p>{{ t('选择内置字体，或使用本机已安装的字体。') }}</p>
                </div>
                <select
                  :value="visualFontChoice"
                  :aria-label="t('可视化编辑字体')"
                  @change="emit('update:visualFontChoice', ($event.target as HTMLSelectElement).value as VisualFontChoice)"
                >
                  <option value="system">{{ t('系统字体') }}</option>
                  <option value="serif">{{ t('衬线字体') }}</option>
                  <option value="mono">{{ t('等宽字体') }}</option>
                  <option value="custom">{{ t('自定义字体') }}</option>
                </select>
              </div>
              <div v-if="visualFontChoice === 'custom'" class="settings-row settings-custom-font-row" data-settings-key="appearance-custom-font">
                <div>
                  <strong>{{ t('字体名称') }}</strong>
                  <p>{{ t('输入本机字体名称；未安装时会回退到系统字体。') }}</p>
                </div>
                <input
                  :value="customFontName"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  :aria-label="t('自定义字体名称')"
                  :placeholder="t('例如：霞鹜文楷')"
                  @input="customFontInput"
                />
              </div>
              <div class="settings-row settings-font-row" data-settings-key="appearance-visual-size">
                <div>
                  <strong>{{ t('可视化编辑字号') }}</strong>
                  <p>{{ t('调整正文、标题和编辑中的内容大小。') }}</p>
                </div>
                <div class="settings-font-controls">
                  <button
                    type="button"
                    :aria-label="t('减小可视化编辑字号')"
                    :disabled="visualFontSize <= 12"
                    @click="emit('update:visualFontSize', visualFontSize - 1)"
                  ><Minus :size="15" :stroke-width="1.75" /></button>
                  <output :aria-label="t('可视化编辑字号')">{{ visualFontSize }} px</output>
                  <button
                    type="button"
                    :aria-label="t('增大可视化编辑字号')"
                    :disabled="visualFontSize >= 24"
                    @click="emit('update:visualFontSize', visualFontSize + 1)"
                  ><Plus :size="15" :stroke-width="1.75" /></button>
                  <button
                    type="button"
                    class="settings-font-reset"
                    :aria-label="t('重置可视化编辑字号')"
                    :disabled="visualFontSize === 16"
                    @click="emit('update:visualFontSize', 16)"
                  >{{ t('重置') }}</button>
                </div>
              </div>
              <div class="settings-row settings-font-row" data-settings-key="appearance-source-size">
                <div>
                  <strong>{{ t('Markdown 源码字号') }}</strong>
                  <p>{{ t('调整源码视图中的文字大小。') }}</p>
                </div>
                <div class="settings-font-controls">
                  <button
                    type="button"
                    :aria-label="t('减小 Markdown 源码字号')"
                    :disabled="sourceFontSize <= 12"
                    @click="emit('update:sourceFontSize', sourceFontSize - 1)"
                  ><Minus :size="15" :stroke-width="1.75" /></button>
                  <output :aria-label="t('Markdown 源码字号')">{{ sourceFontSize }} px</output>
                  <button
                    type="button"
                    :aria-label="t('增大 Markdown 源码字号')"
                    :disabled="sourceFontSize >= 24"
                    @click="emit('update:sourceFontSize', sourceFontSize + 1)"
                  ><Plus :size="15" :stroke-width="1.75" /></button>
                  <button
                    type="button"
                    class="settings-font-reset"
                    :aria-label="t('重置 Markdown 源码字号')"
                    :disabled="sourceFontSize === 14"
                    @click="emit('update:sourceFontSize', 14)"
                  >{{ t('重置') }}</button>
                </div>
              </div>
              <div class="settings-font-preview" :aria-label="t('字体与字号预览')">
                <div class="settings-font-preview-samples">
                  <div class="settings-font-preview-sample" role="group" :aria-label="t('可视化编辑预览')">
                    <p
                      class="settings-visual-font-sample"
                      :style="{
                        fontFamily: visualFontFamily(visualFontChoice, customFontName),
                        fontSize: `${visualFontSize}px`,
                      }"
                    >{{ t('在同一页写下新的想法。') }}<br />Tano 123</p>
                  </div>
                  <div class="settings-font-preview-sample" role="group" :aria-label="t('Markdown 源码预览')">
                    <p class="settings-source-font-sample" :style="{
                      fontFamily: visualFontFamily(visualFontChoice, customFontName),
                      fontSize: `${sourceFontSize}px`,
                    }">
                      {{ t('# 在同一页写下新的想法') }}<br />Tano 123
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p class="settings-local-note">{{ t('所选字体应用于可视化编辑、Markdown 源码和页面内标题；两种编辑模式的字号可分别调整。') }}</p>
          </section>
          <section v-if="page === 'editing'" class="settings-section" :aria-label="t('编辑行为')">
            <h3>{{ t('编辑行为') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="editing-toolbar">
                <div>
                  <strong>{{ t('编辑工具栏') }}</strong>
                  <p>{{ t('随选区显示，或停靠在顶部、底部、左侧、右侧；也可拖动工具栏手柄调整。仅影响当前设备。') }}</p>
                </div>
                <select :aria-label="t('编辑工具栏')" :value="toolbarMode ?? 'selection'"
                  @change="emit('update:toolbarMode', ($event.target as HTMLSelectElement).value as ToolbarMode)">
                  <option value="selection">{{ t('随选区显示（默认）') }}</option>
                  <option value="fixed">{{ t('固定在顶部') }}</option>
                  <option value="bottom">{{ t('吸附在底部') }}</option>
                  <option value="left">{{ t('靠左停靠') }}</option>
                  <option value="right">{{ t('靠右停靠') }}</option>
                </select>
              </div>
              <div
                v-for="option in displayOptions"
                :key="option.key"
                class="settings-row"
                :data-settings-key="`editing-${option.key === 'previewMathWhileEditing' ? 'preview-math' : 'folding'}`"
                :class="{ 'is-disabled': option.key === 'previewMathWhileEditing' && !revealMarkdown }"
              >
                <div>
                  <strong>{{ t(option.label) }}</strong>
                  <p>{{
                    option.key === 'previewMathWhileEditing' && !revealMarkdown
                      ? t('仅控制 Markdown 源码展开时的预览；公式面板仍会实时渲染。')
                      : option.description
                  }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: displayOptionActive(option.key) }"
                  role="switch"
                  :aria-checked="displayOptionActive(option.key)"
                  :aria-label="option.label"
                  :disabled="option.key === 'previewMathWhileEditing' && !revealMarkdown"
                  @click="
                    emit('update:editorPreferences', {
                      ...display,
                      [option.key]: !display[option.key],
                    })
                  "
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
          <section v-if="page === 'editing'" class="settings-section" :aria-label="t('AI 功能')">
            <h3>{{ t('AI 功能') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="editing-ai-shortcut">
                <div>
                  <strong>{{ t('空白块按空格启动 AI') }}</strong>
                  <p>{{ t('在空白 block 中按空格，直接展开一次性 AI 编辑输入框。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: displayOptionActive('blankBlockAiShortcut') }"
                  role="switch"
                  :aria-checked="displayOptionActive('blankBlockAiShortcut')"
                  :aria-label="t('空白块按空格启动 AI')"
                  @click="emit('update:editorPreferences', {
                    ...display,
                    blankBlockAiShortcut: !display.blankBlockAiShortcut,
                  })"
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
          <section v-if="page === 'editing'" class="settings-section" :aria-label="t('选区符号包裹')">
            <h3>{{ t('选区符号包裹') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="editing-wrapping">
                <div>
                  <strong>{{ t('输入符号包裹选区') }}</strong>
                  <p>{{ t('选中文字后输入符号，自动补齐两端。可视化与源码模式通用。') }}</p>
                </div>
                <button type="button" class="settings-switch" role="switch" :aria-label="t('输入符号包裹选区')"
                  :class="{ on: wrapping.enabled }" :aria-checked="wrapping.enabled"
                  @click="setWrapping('enabled', !wrapping.enabled)"><span /></button>
              </div>
              <div v-for="option in wrappingOptions" :key="option.key" class="settings-row settings-row-compact"
                :data-settings-key="`editing-wrapping-${option.key}`"
                :class="{ 'is-disabled': !wrapping.enabled }">
                <div class="settings-inline-copy">
                  <strong>{{ t(option.label) }}</strong>
                  <span class="settings-inline-example" :title="option.example" :aria-label="option.example">
                    <kbd aria-hidden="true">{{ option.input }}</kbd>
                    <ArrowRight :size="12" aria-hidden="true" />
                    <code aria-hidden="true"><span>{{ option.opening }}</span>{{ t('文字') }}<span>{{ option.closing }}</span></code>
                  </span>
                </div>
                <button type="button" class="settings-switch" role="switch" :aria-label="t(option.label)"
                  :class="{ on: wrapping[option.key] }" :aria-checked="wrapping[option.key]" :disabled="!wrapping.enabled"
                  @click="setWrapping(option.key, !wrapping[option.key])"><span /></button>
              </div>
            </div>
            <p class="settings-local-note">{{ t('设置仅影响当前设备。扩展语法默认关闭，其他 Markdown 应用可能不支持。') }}</p>
          </section>
          <section v-if="page === 'appearance'" class="settings-section" :aria-label="t('内容显示')">
            <h3>{{ t('内容显示') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="appearance-auto-spacing">
                <div>
                  <strong>{{ t('正文自动间距') }}</strong>
                  <p>{{ t('在中文与英文、数字、行内公式及引用之间自动留白，仅影响显示，不修改原文。') }}</p>
                </div>
                <button type="button" class="settings-switch" :class="{ on: display.autoSpacing }"
                  role="switch" :aria-checked="display.autoSpacing ?? false" :aria-label="t('正文自动间距')"
                  @click="emit('update:editorPreferences', { ...display, autoSpacing: !display.autoSpacing })">
                  <span />
                </button>
              </div>
              <div class="settings-row" data-settings-key="appearance-page-title">
                <div>
                  <strong>{{ t('页面内标题') }}</strong>
                  <p>{{ t('在编辑区顶部显示当前文档标题。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: showPageTitle }"
                  role="switch"
                  :aria-checked="showPageTitle"
                  :aria-label="t('页面内标题')"
                  @click="emit('update:showPageTitle', !showPageTitle)"
                >
                  <span />
                </button>
              </div>
              <div class="settings-row" data-settings-key="appearance-properties">
                <div>
                  <strong>{{ t('文档属性') }}</strong>
                  <p>{{ t('在可视化编辑区显示文档属性。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: showDocumentProperties }"
                  role="switch"
                  :aria-checked="showDocumentProperties"
                  :aria-label="t('文档属性')"
                  @click="emit('update:showDocumentProperties', !showDocumentProperties)"
                >
                  <span />
                </button>
              </div>
              <div class="settings-row" data-settings-key="appearance-discussion">
                <div>
                  <strong>{{ t('文档讨论') }}</strong>
                  <p>{{ t('有讨论时在文档底部显示，没有讨论时自动隐藏。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: showDocumentDiscussion }"
                  role="switch"
                  :aria-checked="showDocumentDiscussion"
                  :aria-label="t('文档讨论')"
                  @click="emit('update:showDocumentDiscussion', !showDocumentDiscussion)"
                >
                  <span />
                </button>
              </div>
              <div class="settings-row" data-settings-key="appearance-outline">
                <div>
                  <strong>{{ t('显示目录') }}</strong>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: showOutline }"
                  role="switch"
                  :aria-checked="showOutline"
                  :aria-label="t('显示目录')"
                  @click="emit('update:showOutline', !showOutline)"
                >
                  <span />
                </button>
              </div>
              <div class="settings-row" data-settings-key="appearance-outline-position">
                <div>
                  <strong>{{ t('目录显示在左侧') }}</strong>
                  <p>{{ t('将文档大纲放到编辑区左侧。') }}</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: outlineOnLeft }"
                  role="switch"
                  :aria-checked="outlineOnLeft ?? false"
                  :aria-label="t('目录显示在左侧')"
                  @click="emit('update:outlineOnLeft', !(outlineOnLeft ?? false))"
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
          <section v-if="page === 'appearance'" class="settings-section" :aria-label="t('使用提示')">
            <h3>{{ t('使用提示') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="appearance-help">
                <div>
                  <strong>{{ t('偶尔显示使用提示') }}</strong>
                  <p>{{ t('在你停下来时，在帮助按钮上方显示简短的用法提示。关闭后仍可手动查看帮助。') }}</p>
                </div>
                <button type="button" class="settings-switch" :class="{ on: helpPreferences.enabled }"
                  role="switch" :aria-checked="helpPreferences.enabled" :aria-label="t('偶尔显示使用提示')"
                  @click="setHelpEnabled(!helpPreferences.enabled)">
                  <span />
                </button>
              </div>
            </div>
          </section>
        </div>

        <AssistantSettings v-else-if="page === 'assistant'" @changed="emit('assistant-changed')" />

        <div v-else-if="page === 'documents'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ t('文档能力') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">{{ t('仅对当前工作区生效，文档能力与 Markdown 输出规则随空间共享。') }}</p>
          <section class="settings-section" :aria-label="t('文档能力')">
            <h3>{{ t('内容扩展') }}<span class="settings-scope">{{ t('工作区共享') }}</span></h3>
            <p class="settings-section-description">{{ t('关闭后显示原始内容，已有文档会保留。') }}</p>
            <p v-if="capabilityError" class="settings-notice" role="alert">{{ capabilityError }}</p>
            <p v-else-if="!workspace || workspace.readOnly || !(workspace.canManageSettings ?? mode !== 'web')" class="settings-notice">
              {{
                !workspace
                  ? t('打开工作区后即可调整文档能力。')
                  : t('只有工作区所有者和管理者可以更改文档能力。')
              }}
            </p>
            <div class="settings-card">
              <div
                v-for="feature in featureDefinitions"
                :key="feature.key"
                class="settings-row settings-row-compact"
                :data-settings-key="`documents-${feature.key}`"
              >
                <strong>{{ t(feature.label) }}</strong>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: rules.features[feature.key] }"
                  role="switch"
                  :disabled="rulesDisabled"
                  :aria-checked="rules.features[feature.key]"
                  :aria-label="t(feature.label)"
                  @click="
                    emit('capability', {
                      feature: feature.key,
                      enabled: !rules.features[feature.key],
                    })
                  "
                >
                  <span />
                </button>
              </div>
            </div>
            <p class="settings-local-note">{{ t('Kanban 与数据库块尚未实现；相关源码会保留。') }}</p>
          </section>
          <section class="settings-section" :aria-label="t('Markdown 输出')">
            <h3>{{ t('Markdown 输出') }}</h3>
            <div class="settings-card">
              <div class="settings-row" data-settings-key="documents-dialect">
                <div>
                  <strong>{{ t('Markdown 方言') }}</strong>
                  <p>
                    {{ t('决定新公式的默认写法：Pandoc 使用 LaTeX 定界符，其余使用美元符号。解析始终兼容两种写法。') }}
                  </p>
                </div>
                <select
                  :value="rules.markdownDialect"
                  :disabled="rulesDisabled"
                  :aria-label="t('Markdown 方言')"
                  @change="
                    emit('capability', {
                      markdownDialect: ($event.target as HTMLSelectElement)
                        .value as WorkspaceCapabilities['markdownDialect'],
                    })
                  "
                >
                  <option value="obsidian">Obsidian</option>
                  <option value="github">GitHub</option>
                  <option value="pandoc">Pandoc</option>
                  <option value="commonmark">{{ t('CommonMark + 扩展') }}</option>
                </select>
              </div>
              <div class="settings-row" data-settings-key="documents-math-syntax">
                <div>
                  <strong>{{ t('公式输出语法') }}</strong>
                  <p>{{ t('默认保留已有公式的原始定界符。选择统一语法后，在下一次编辑保存正文时应用。') }}</p>
                </div>
                <select
                  :value="rules.mathSyntax"
                  :disabled="rulesDisabled"
                  :aria-label="t('公式输出语法')"
                  @change="
                    emit('capability', {
                      mathSyntax: ($event.target as HTMLSelectElement)
                        .value as WorkspaceCapabilities['mathSyntax'],
                    })
                  "
                >
                  <option value="preserve">{{ t('保留原始格式') }}</option>
                  <option value="dollar">Dollar：$ / $$</option>
                  <option value="latex">LaTeX：\( \) / \[ \]</option>
                </select>
              </div>
              <div class="settings-row" data-settings-key="documents-bullet-marker">
                <div>
                  <strong>{{ t('无序列表标记') }}</strong>
                  <p>{{ t('选择无序列表与待办列表的 Markdown 标记，在下一次编辑保存正文时应用。') }}</p>
                </div>
                <select
                  :value="rules.bulletListMarker"
                  :disabled="rulesDisabled"
                  :aria-label="t('无序列表标记')"
                  @change="
                    emit('capability', {
                      bulletListMarker: ($event.target as HTMLSelectElement)
                        .value as WorkspaceCapabilities['bulletListMarker'],
                    })
                  "
                >
                  <option value="-">-</option>
                  <option value="+">+</option>
                  <option value="*">*</option>
                </select>
              </div>
            </div>
          </section>
        </div>

        <div v-else-if="page === 'workspace'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ t('工作区') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">{{ t('管理工作区名称、图标、默认页面、页面标题来源、侧栏与内容导出。') }}</p>
          <WorkspaceGeneralSettings
            :key="workspace?.id"
            :workspace="workspace"
            :settings="workspaceSettings"
            :pages="workspacePages"
            :mode="mode"
            :saving="workspaceSettingsSaving || workspaceDeleting"
            :error="workspaceSettingsError"
            :exporting="workspaceExporting || workspaceDeleting"
            :export-error="workspaceExportError"
            @change="(id, patch) => emit('workspace-setting', id, patch)"
            @reload="emit('workspace-settings-reload')"
            @export="emit('workspace-export', $event)"
          >
            <template #members-export><slot name="workspace-members-export" /></template>
          </WorkspaceGeneralSettings>
          <section class="settings-section" aria-labelledby="settings-current-workspace">
            <h3 id="settings-current-workspace">{{ t('当前空间') }}</h3>
            <div class="settings-card settings-workspace-card">
              <div class="settings-info">
                <strong>{{ workspace?.name ?? t('尚未打开工作区') }}</strong
                ><span>{{
                  mode === 'demo'
                    ? t('浏览器演示 · 保存在当前浏览器')
                    : mode === 'web'
                      ? t('在线工作区 · Markdown 保存在服务器')
                      : t('本地工作区 · Markdown 保存在文件夹')
                }}</span
                ><small v-if="workspace && mode === 'local'">{{ workspace.path }}</small>
              </div>
              <div class="settings-actions">
                <button
                  v-if="mode === 'local' && native && !mobile"
                  @click="emit('action', 'open-folder')"
                >
                  <FolderOpen :size="17" />{{ t('打开工作文件夹') }}
                </button>
                <button
                  v-if="mode === 'local' && native && !mobile && workspace"
                  @click="emit('action', 'reveal')"
                >
                  <ExternalLink :size="17" />{{ t('在资源管理器中显示') }}
                </button>
                <button
                  v-if="mode === 'local' && native && workspace"
                  @click="emit('action', 'agent')"
                >
                  <Bot :size="17" />{{ t('与 Agent 一起工作') }}
                </button>
                <button
                  v-if="mode === 'local' && native && workspace && historyEnabled"
                  @click="emit('action', 'history')"
                >
                  <History :size="17" />{{ t('空间版本历史') }}
                </button>
                <button v-if="mobile && workspace" @click="emit('action', 'recycle')">
                  <Trash2 :size="17" />{{ t('手机回收站') }}
                </button>
              </div>
            </div>
          </section>
          <WorkspaceDeletionSettings
            v-if="mode !== 'demo' && workspaceDeletionSupported"
            :key="workspace?.id"
            :workspace="workspace"
            :mode="mode"
            :busy="workspaceDeleting || workspaceSettingsSaving || workspaceExporting"
            :error="workspaceDeletionError"
            @delete="emit('workspace-delete', $event)"
          />
        </div>

        <div v-else-if="page === 'shortcuts'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ t('快捷键') }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <UserRound :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">{{ t('为常用操作设置顺手的组合键。') }}</p>
          <ShortcutSettings :bindings="shortcuts ?? defaultShortcutBindings" @change="emit('update:shortcuts', $event)" />
        </div>

        <PluginSurface
          v-else-if="pluginPages?.some(item => item.view.key === page) && executePlugin"
          :key="page"
          :view="pluginPages.find(item => item.view.key === page)!.view"
          :workspace-id="pluginPages.find(item => item.view.key === page)!.workspaceId"
          :runtime="pluginPages.find(item => item.view.key === page)!.runtime"
          :execute="executePlugin"
        />
        <component
          v-else-if="extraPages?.some(item => item.id === page)"
          :is="extraPages?.find(item => item.id === page)?.component"
          :mode="mode"
          :workspace="workspace"
          :active-file="activeFile ?? null"
        />
        <div v-else class="settings-content settings-about">
          <h2 id="settings-title">{{ t('关于同页') }}</h2>
          <p class="settings-lead">{{ t('了解同页与版本信息。') }}</p>
          <div class="settings-card settings-brand-card" data-settings-key="about-updates">
            <div class="settings-about-brand">
              <img :src="'/favicon-green.svg?v=3'" alt="" />
              <h3>Tano <span v-if="uiLocale === 'zh-CN'">/ 同页</span></h3>
              <div class="settings-brand-actions">
                <span class="settings-version-pill">{{ version }}</span>
                <slot v-if="native && !mobile" name="update-panel"><UpdatePanel /></slot>
              </div>
            </div>
            <p class="settings-about-slogan">Humans and agents, on the same page.</p>
            <p v-if="uiLocale === 'zh-CN'" class="settings-about-translation">{{ t('人与 Agent，在同一页工作。') }}</p>
          </div>

          <section class="settings-section" aria-labelledby="settings-work-mode">
            <h3 id="settings-work-mode">{{ t('工作方式') }}</h3>
            <div class="settings-about-feature settings-card">
              <Monitor :size="21" />
              <div>
                <strong>{{
                  mode === 'demo'
                    ? t('你正在体验浏览器演示版')
                    : mode === 'web'
                      ? t('这是你的在线 Markdown 工作台')
                      : t('这是你的本地 Markdown 工作台')
                }}</strong>
                <p>
                  {{
                    mode === 'demo'
                      ? t('演示修改保存在当前浏览器，不会写入电脑上的工作文件夹。启动桌面版，即可打开真实文件夹并监听外部修改。')
                      : mode === 'web'
                        ? t('文档由当前存储适配器保存。可用能力由产品入口提供。')
                        : t('文档保存为工作文件夹中的普通 .md 文件。Agent 和其他编辑器的修改会自动载入；冲突时保留双方内容。')
                  }}
                </p>
              </div>
            </div>
          </section>

        </div>
      </main>
    </section>
  </ModalBackdrop>
</template>

<style>
.settings-tab-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.settings-dialog {
  position: relative;
  display: flex;
  width: min(1060px, 100%);
  height: min(760px, calc(100dvh - 56px));
  min-height: 0;
  overflow: hidden;
}
.settings-nav {
  flex: 0 0 224px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 30px 16px 0;
  border-right: 1px solid var(--line);
  background: var(--paper);
}
.settings-search {
  flex-shrink: 0;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--paper);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.settings-search:focus-within {
  border-color: var(--green);
  box-shadow: 0 0 0 3px var(--accent);
}
.settings-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 12px;
}
.settings-search input::placeholder {
  color: var(--muted);
}
.settings-search input:focus {
  outline: none;
}
.settings-nav-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 0 24px;
}
.settings-nav-group {
  display: block;
  margin: 8px 10px 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
}
.settings-nav-section + .settings-nav-section {
  margin-top: 20px;
}
.settings-nav-scroll button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  margin: 0;
  padding: 4px 10px;
  border-radius: 6px;
  color: var(--text);
  text-align: left;
  font-size: 13px;
  line-height: 20px;
}
.settings-nav-scroll button svg {
  color: var(--text-secondary);
}
.settings-nav-scroll button:hover {
  background: var(--surface);
}
.settings-nav-scroll button.selected {
  background: var(--hover);
}
.settings-nav-setting-results {
  margin: 1px 0 6px 24px;
  border-left: 1px solid var(--line);
}
.settings-nav-setting {
  min-height: 25px !important;
  padding: 2px 8px !important;
  color: var(--muted) !important;
  font-size: 12px !important;
}
.settings-nav-setting:hover,
.settings-nav-setting.selected {
  color: var(--text) !important;
  background: var(--surface) !important;
}
.settings-search-target {
  position: relative;
  isolation: isolate;
}
.settings-row.settings-search-target::before,
.shortcut-settings-row.settings-search-target::before {
  position: absolute;
  inset: 0 -20px;
  z-index: -1;
  border-radius: 5px;
  background: color-mix(in srgb, var(--green) 7%, transparent);
  content: '';
  pointer-events: none;
  animation: settings-search-target 0.75s ease-in-out 2;
}
.shortcut-settings-row.settings-search-target::before {
  inset-inline: -18px;
}
@keyframes settings-search-target {
  0%, 100% { background: transparent; }
  25% { background: color-mix(in srgb, var(--green) 6%, transparent); }
  50% { background: color-mix(in srgb, var(--green) 11%, transparent); }
  75% { background: color-mix(in srgb, var(--green) 6%, transparent); }
}
.settings-search-empty {
  margin: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.settings-nav-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 78px;
  border-top: 1px solid var(--line);
  padding: 16px 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.settings-workspace-icon {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
}
.settings-nav-foot > div {
  min-width: 0;
}
.settings-nav-foot > div > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-nav-foot small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}
.settings-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.settings-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--muted);
  background: var(--paper);
  z-index: 1;
}
.settings-close:hover {
  background: var(--hover);
}
.settings-open-tab {
  right: 56px;
}
.settings-open-window {
  right: 56px;
}
.settings-open-window-with-tab {
  right: 96px;
}
.settings-open-tab,
.settings-open-window {
  transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
}
.settings-action-hidden {
  opacity: 0;
  transform: translateY(-4px);
  visibility: hidden;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .settings-open-tab,
  .settings-open-window {
    transition: none;
  }
}
.modal-backdrop.settings-backdrop.settings-tabbed {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  padding: 0;
  z-index: auto;
  background: var(--paper);
  backdrop-filter: none;
}
.settings-tabbed .settings-dialog {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.settings-content {
  max-width: 804px;
  margin: 0 auto;
  padding: 40px 44px 36px;
}
.settings-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.settings-content .settings-title-line h2 {
  flex: none;
  padding-right: 0;
}
.settings-page-scope {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 31px;
  height: 26px;
  max-width: min(50%, 360px);
  overflow: hidden;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.7;
}
.settings-page-scope:hover,
.settings-page-scope:focus-visible {
  justify-content: flex-start;
  gap: 7px;
  width: max-content;
  background: var(--hover);
}
.settings-page-scope:hover span,
.settings-page-scope:focus-visible span {
  display: block;
}
.settings-page-scope:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.settings-page-scope svg {
  flex: none;
  transform: translateY(1px);
}
.settings-page-scope span {
  display: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-content h2 {
  margin: 0;
  padding-right: 20px;
  font-size: 22px;
  line-height: 1.4;
  font-weight: 650;
  letter-spacing: -0.5px;
}
.settings-lead {
  margin: 8px 0 28px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.settings-section + .settings-section {
  margin-top: 28px;
}
.settings-section > h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  padding-left: 2px;
  font-size: 13px;
  font-weight: 600;
}
.settings-card {
  padding: 0 20px;
  border-radius: 12px;
  background: var(--surface);
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  min-height: 86px;
  padding: 20px 0;
}
.settings-row + .settings-row {
  border-top: 1px solid var(--line);
}
.settings-row > div {
  min-width: 0;
}
.settings-row strong,
.settings-info strong {
  font-size: 13px;
  line-height: 1.6;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.settings-row p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}
.settings-row select {
  flex: 0 0 auto;
  width: 164px;
  max-width: 100%;
  min-height: 34px;
  padding: 6px 28px 6px 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background-color: var(--paper);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23676d77' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  box-shadow: 0 1px 2px #18212b08;
  appearance: none;
  font-size: 12px;
  cursor: pointer;
}
:root[data-theme='dark'] .settings-row select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23b8c0c9' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E");
}
.settings-row select:hover:not(:disabled) {
  border-color: var(--control-border);
}
.settings-row select:disabled {
  opacity: 0.5;
  cursor: default;
}
.settings-input,
.settings-custom-font-row input {
  flex: 0 1 220px;
  min-width: 0;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--paper);
  font-size: 12px;
}
.settings-input::placeholder,
.settings-custom-font-row input::placeholder {
  color: var(--muted);
}
.settings-input:disabled {
  opacity: 0.5;
  cursor: default;
}
.settings-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}
.settings-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 34px;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--paper);
  box-shadow: 0 1px 2px #18212b08;
  font-size: 12px;
  white-space: nowrap;
}
.settings-button:hover:not(:disabled) {
  border-color: var(--control-border);
}
.settings-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.settings-font-card {
  padding-bottom: 20px;
}
.settings-font-preview {
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  text-align: center;
}
.settings-font-preview-samples {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
}
.settings-font-preview-sample {
  min-width: 0;
  padding: 6px 12px;
}
.settings-font-preview-sample + .settings-font-preview-sample {
  border-left: 1px solid var(--line);
}
.settings-font-preview p {
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-variant-ligatures: no-contextual;
}
.settings-font-preview .settings-visual-font-sample {
  line-height: 1.6;
}
.settings-font-preview .settings-source-font-sample {
  line-height: 1.928571;
}
.settings-font-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
}
.settings-font-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  line-height: 1;
}
.settings-font-controls button:hover:not(:disabled) {
  border-color: var(--control-border);
}
.settings-font-controls button:disabled {
  opacity: 0.4;
  cursor: default;
}
.settings-font-controls output {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.settings-font-controls .settings-font-reset {
  margin-left: 4px;
  font-size: 12px;
}
.settings-switch {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 22px;
  padding: 3px;
  border-radius: 999px;
  background: var(--switch-off);
  transition: background 0.18s;
}
.settings-switch::before {
  content: '';
  position: absolute;
  inset: -9px -3px;
}
.settings-switch.on {
  background: var(--green);
}
.settings-switch.on:hover:not(:disabled) {
  background: var(--green-hover);
}
.settings-switch span {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px #18212b26;
  transition: transform 0.18s;
}
.settings-switch.on span {
  transform: translateX(16px);
}
.settings-row.is-disabled > div,
.settings-switch:disabled {
  opacity: 0.5;
}
.settings-switch:disabled {
  cursor: not-allowed;
}
.settings-local-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 14px 2px 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.7;
}
.settings-scope {
  color: var(--muted);
  font-size: 10px;
  font-weight: 400;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--surface);
}
.settings-section-description {
  margin: -4px 2px 14px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.settings-inline-copy {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 3px;
}
.settings-inline-example {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  flex-shrink: 0;
}
.settings-inline-example kbd,
.settings-inline-example code {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--paper);
  font: 11px/1.5 var(--font-mono);
  white-space: nowrap;
}
.settings-inline-example kbd {
  min-width: 24px;
  text-align: center;
  color: var(--text-secondary);
  box-shadow: 0 1px 0 var(--line);
}
.settings-inline-example code { color: var(--text-secondary); }
.settings-inline-example code span {
  color: var(--green);
  font-weight: 500;
}
.settings-row-compact {
  min-height: 57px;
  padding: 16px 0;
}
.settings-notice {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.settings-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 0;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.settings-info.settings-card {
  padding: 20px;
}
.settings-info span,
.settings-info small {
  color: var(--muted);
}
.settings-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 0 0 20px;
}
.settings-actions:empty {
  display: none;
}
.settings-actions button {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--paper);
  box-shadow: 0 1px 2px #18212b06;
  text-align: left;
  font-size: 12px;
}
.settings-actions button:hover {
  border-color: var(--control-border);
  color: var(--text);
}
.settings-brand-card {
  padding: 24px;
  margin-bottom: 28px;
}
.settings-about-brand {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.settings-about-brand img {
  width: 40px;
  height: 40px;
}
.settings-about-brand h3 {
  margin: 0;
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.5px;
}
.settings-about-brand h3 span {
  color: var(--text-secondary);
  font-size: 18px;
  font-weight: 400;
}
.settings-brand-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  max-width: 100%;
}
.settings-version-pill {
  flex: none;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  background: var(--paper);
  font-size: 11px;
}
.settings-about-slogan {
  margin: 18px 0 5px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.settings-about-translation {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.settings-about-feature {
  display: flex;
  gap: 14px;
  padding: 20px;
}
.settings-about-feature > svg {
  margin-top: 2px;
  color: var(--muted);
}
.settings-about-feature strong {
  font-size: 13px;
  font-weight: 500;
}
.settings-about-feature p {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
@media (max-width: 900px) {
  .settings-nav {
    flex-basis: 200px;
    padding-right: 12px;
    padding-left: 12px;
  }
  .settings-content {
    padding-right: 28px;
    padding-left: 28px;
  }
  .settings-row {
    gap: 18px;
  }
}
@media (max-width: 700px) {
  .modal-backdrop.settings-backdrop {
    padding: 12px;
  }
  .settings-dialog {
    width: 100%;
    height: calc(100dvh - 24px);
    flex-direction: column;
    border-radius: 12px;
  }
  .settings-nav {
    flex: 0 0 auto;
    padding: 18px 18px 10px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .settings-close {
    top: 10px;
    right: 12px;
  }
  .settings-nav-scroll {
    display: flex;
    flex: 0 0 auto;
    gap: 12px;
    overflow-x: auto;
    padding: 10px 0 0;
    scrollbar-width: none;
  }
  .settings-nav-scroll::-webkit-scrollbar {
    display: none;
  }
  .settings-nav-foot {
    display: none;
  }
  .settings-nav-section {
    flex: 0 0 auto;
  }
  .settings-nav-section + .settings-nav-section {
    margin-top: 0;
    padding-left: 12px;
    border-left: 1px solid var(--line);
  }
  .settings-nav-group {
    margin: 2px 8px 5px;
    font-size: 11px;
  }
  .settings-nav-items {
    display: flex;
    gap: 4px;
  }
  .settings-nav-scroll button {
    width: auto;
    flex: 0 0 auto;
    gap: 7px;
    min-height: 36px;
    padding: 8px;
    white-space: nowrap;
    font-size: 12px;
  }
  .settings-content {
    padding: 24px 22px 32px;
  }
  .settings-content h2 {
    font-size: 20px;
  }
  .settings-lead {
    margin-bottom: 24px;
  }
  .settings-card {
    padding-right: 16px;
    padding-left: 16px;
  }
  .settings-row {
    min-height: 80px;
    padding: 18px 0;
  }
  .settings-row-compact {
    min-height: 56px;
    padding: 15px 0;
  }
  .settings-row:has(select),
  .settings-row-with-controls {
    flex-wrap: wrap;
    gap: 12px;
  }
  .settings-row:has(select) > div,
  .settings-row-with-controls > div:first-child {
    flex: 1 1 190px;
  }
  .settings-font-row {
    flex-wrap: wrap;
    gap: 12px;
  }
  .settings-custom-font-row {
    flex-wrap: wrap;
    gap: 12px;
  }
  .settings-custom-font-row input {
    flex: 1 1 190px;
  }
  .settings-font-preview-samples {
    grid-template-columns: 1fr;
  }
  .settings-font-preview-sample + .settings-font-preview-sample {
    margin-top: 14px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
  .settings-actions {
    grid-template-columns: 1fr;
  }
  .settings-brand-card {
    padding-top: 20px;
    padding-bottom: 20px;
  }
}
@media (max-width: 400px) {
  .modal-backdrop.settings-backdrop {
    padding: 0;
  }
  .settings-dialog {
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .settings-content {
    padding-right: 16px;
    padding-left: 16px;
  }
  .settings-nav {
    padding-right: 16px;
    padding-left: 16px;
  }
  .settings-about-brand {
    flex-wrap: wrap;
    gap: 8px;
  }
  .settings-about-brand h3 {
    font-size: 20px;
  }
  .settings-about-brand h3 span {
    font-size: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-dialog *,
  .settings-dialog *::before {
    transition: none;
  }
}
.modal-backdrop.settings-backdrop.settings-windowed {
  padding: 0;
  background: var(--paper);
  backdrop-filter: none;
}
.settings-windowed .settings-dialog {
  width: 100%;
  height: 100dvh;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.settings-window-drag-region {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  height: 24px;
  cursor: grab;
  user-select: none;
}
.settings-window-drag-region:active {
  cursor: grabbing;
}
.settings-windowed .settings-close {
  z-index: 2;
}

</style>
