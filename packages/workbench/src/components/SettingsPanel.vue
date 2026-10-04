<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  BookOpen,
  Bot,
  CircleHelp,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  LogOut,
  Minus,
  Monitor,
  Palette,
  PencilLine,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next';
import type { Workspace } from '@tano/protocol';
import type { SettingsPage } from '../runtime';
import UpdatePanel from './UpdatePanel.vue';
import {
  featureDefinitions,
  defaultCapabilities,
  defaultEditorPreferences,
} from '@tano/editor/runtime';
import type { WorkspaceCapabilities, EditorPreferences } from '@tano/editor/runtime';
import type { CapabilityPatch } from '../workspace-capabilities';
import type { ThemePreference } from '../theme';
import { sanitizeCustomFontName, visualFontFamily } from '../editor-font';
import type { VisualFontChoice } from '../editor-font';
import type { ToolbarMode } from '../toolbar-preference';
import type { PageTitleSource } from '../page-title-source';

type Page = string;
type Action =
  'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out';

const props = defineProps<{
  workspace: Pick<Workspace, 'name' | 'path' | 'readOnly'> | null;
  windowed?: boolean;
  extraPages?: SettingsPage[];
  mode: 'demo' | 'web' | 'local';
  native: boolean;
  mobile: boolean;
  defaultSource: boolean;
  theme: ThemePreference;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  revealMarkdown: boolean;
  toolbarMode?: ToolbarMode;
  showPageTitle: boolean;
  pageTitleSource: PageTitleSource;
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
  'drag-window': [event: MouseEvent];
  'update:defaultSource': [value: boolean];
  'update:theme': [value: ThemePreference];
  'update:visualFontChoice': [value: VisualFontChoice];
  'update:customFontName': [value: string];
  'update:revealMarkdown': [value: boolean];
  'update:toolbarMode': [value: ToolbarMode];
  'update:showPageTitle': [value: boolean];
  'update:pageTitleSource': [value: PageTitleSource];
  'update:visualFontSize': [value: number];
  'update:sourceFontSize': [value: number];
  action: [value: Action];
  capability: [value: CapabilityPatch];
  'update:editorPreferences': [value: EditorPreferences];
}>();
const rules = computed(() => props.capabilities ?? defaultCapabilities);
const display = computed(() => props.editorPreferences ?? defaultEditorPreferences);
function displayOptionActive(key: keyof EditorPreferences) {
  return display.value[key] && (key !== 'previewMathWhileEditing' || props.revealMarkdown);
}
const rulesDisabled = computed(
  () =>
    !props.workspace ||
    props.workspace.readOnly ||
    props.capabilitySaving ||
    !!props.capabilityError,
);
const displayOptions = [
  {
    key: 'previewMathWhileEditing',
    label: '编辑时预览公式',
    description: '展开 Markdown 源码编辑公式时同步显示排版效果。',
  },
  {
    key: 'folding',
    label: '标题与列表折叠',
    description: '显示折叠按钮，临时收起标题下的内容或列表项。',
  },
] as const;

const search = ref('');
const searchInput = ref<HTMLInputElement>();
const mainContent = ref<HTMLElement>();
const page = ref<Page>(props.initialPage === 'preferences' ? 'appearance' : props.initialPage ?? 'appearance');
const originalFocus = document.activeElement as HTMLElement | null;
const pages = [
  {
    id: 'appearance',
    label: '外观设置',
    group: '个人偏好',
    icon: Palette,
    terms: '外观 主题 白天 黑夜 深色 浅色 跟随系统 字体 系统字体 衬线字体 等宽字体 Mono Maple 自定义字体 字号 字体大小 页面内标题 标题来源 文件名 YAML title 属性',
  },
  {
    id: 'editing',
    label: '编辑设置',
    group: '个人偏好',
    icon: PencilLine,
    terms: '编辑器 Markdown 源码 默认编辑模式 光标 语法 展开 编辑 Reveal 数学 公式 KaTeX 标题 列表 折叠 工具栏 选区 顶部 固定 胶囊',
  },
  {
    id: 'workspace',
    label: '工作区',
    group: '工作区设置',
    icon: BookOpen,
    terms: '文件夹 历史 回收站 Agent 存储 当前空间',
  },
  {
    id: 'documents',
    label: '文档能力',
    group: '工作区设置',
    icon: FileText,
    terms:
      'Markdown 数学 公式 Math Mermaid Wiki Links 提示块 脚注 HTML 嵌入 对象 引用 折叠 标签页 分栏 附件 输出 语法 方言 Obsidian GitHub Pandoc CommonMark',
  },
  {
    id: 'about',
    label: '关于同页',
    group: '帮助',
    icon: CircleHelp,
    terms: '版本 更新 检查更新 Tano 快捷键 存储 Markdown Agent',
  },
] as const;
const visiblePages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return [...pages, ...(props.extraPages ?? []).map(item => ({ ...item, icon: UserRound }))].filter(
    (item) =>
      `${item.group} ${item.label} ${item.terms}`.toLocaleLowerCase().includes(query),
  );
});
const navigationGroups = computed(() =>
  ['个人偏好', '工作区设置', '帮助']
    .map((label) => ({ label, pages: visiblePages.value.filter((item) => item.group === label) }))
    .filter((group) => group.pages.length),
);
const workspacePage = computed(() => page.value === 'workspace' || page.value === 'documents');
const scopeLabel = computed(() =>
  workspacePage.value
    ? `工作区设置 · ${props.workspace?.name ?? '尚未打开工作区'}`
    : '个人偏好 · 当前设备',
);
watch(visiblePages, (items) => {
  if (items.length && !items.some((item) => item.id === page.value)) page.value = items[0].id;
});
watch(page, () => {
  if (mainContent.value) mainContent.value.scrollTop = 0;
});
onMounted(() => void nextTick(() => searchInput.value?.focus()));
onBeforeUnmount(() => {
  if (originalFocus?.isConnected) originalFocus.focus();
});

function keydown(event: KeyboardEvent) {
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
  <div class="modal-backdrop settings-backdrop" :class="{ 'settings-windowed': windowed }" @mousedown.self="!windowed && emit('close')">
    <section
      class="settings-dialog"
      role="dialog"
      :aria-modal="!windowed"
      aria-labelledby="settings-title"
      @keydown="keydown"
    >
      <div
        v-if="windowed"
        class="settings-window-drag-region"
        aria-hidden="true"
        @mousedown="emit('drag-window', $event)"
      />
      <aside class="settings-nav" aria-label="设置分类">
        <label class="settings-search">
          <Search :size="16" />
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            placeholder="搜索设置…"
            aria-label="搜索设置"
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
          </div>
          <p v-if="!visiblePages.length" class="settings-search-empty">没有找到相关设置</p>
        </div>
        <div class="settings-nav-foot">
          <span class="settings-workspace-icon"><BookOpen :size="17" /></span>
          <div>
            <span>{{ workspace?.name ?? '尚未打开工作区' }}</span>
            <small>{{
              mode === 'demo' ? '浏览器演示' : mode === 'web' ? '在线工作区' : '本地工作区'
            }}</small>
          </div>
        </div>
      </aside>

      <button
        class="settings-close"
        type="button"
        aria-label="关闭设置"
        title="关闭设置"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
      <main ref="mainContent" class="settings-main panel-scrollbar">
        <div v-if="!visiblePages.length" class="settings-content">
          <h2 id="settings-title">搜索设置</h2>
          <p class="settings-lead">没有找到相关设置，请尝试其他关键词。</p>
        </div>
        <div v-else-if="page === 'appearance' || page === 'editing'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">{{ page === 'appearance' ? '外观设置' : '编辑设置' }}</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <Monitor :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">适用于这台设备上的所有工作区，仅影响你的{{ page === 'appearance' ? '显示效果' : '编辑体验' }}。</p>
          <section v-if="page === 'appearance'" class="settings-section" aria-label="外观">
            <h3>外观</h3>
            <div class="settings-card">
              <div class="settings-row">
                <div>
                  <strong>主题</strong>
                  <p>选择应用外观，或随系统外观自动切换。</p>
                </div>
                <select
                  :value="theme"
                  aria-label="主题"
                  @change="emit('update:theme', ($event.target as HTMLSelectElement).value as ThemePreference)"
                >
                  <option value="light">白天</option>
                  <option value="dark">黑夜</option>
                  <option value="system">跟随系统</option>
                </select>
              </div>
            </div>
          </section>
          <section v-if="page === 'editing'" class="settings-section" aria-labelledby="settings-editor">
            <h3 id="settings-editor">编辑器</h3>
            <div class="settings-card">
              <div class="settings-row">
                <div>
                  <strong>默认编辑模式</strong>
                  <p>选择打开文档时使用的视图。</p>
                </div>
                <select
                  :value="defaultSource ? 'source' : 'visual'"
                  aria-label="默认编辑模式"
                  @change="
                    emit(
                      'update:defaultSource',
                      ($event.target as HTMLSelectElement).value === 'source',
                    )
                  "
                >
                  <option value="visual">可视化编辑</option>
                  <option value="source">Markdown 源码</option>
                </select>
              </div>
              <div class="settings-row">
                <div>
                  <strong>光标进入时展开 Markdown 源码</strong>
                  <p>类似 Typora、Obsidian 的实时预览：光标进入时显示 Markdown 语法，离开后恢复排版。</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: revealMarkdown }"
                  role="switch"
                  :aria-checked="revealMarkdown"
                  aria-label="光标进入时展开 Markdown 源码"
                  @click="emit('update:revealMarkdown', !revealMarkdown)"
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
          <section v-if="page === 'appearance'" class="settings-section" aria-label="编辑字体与字号">
            <h3>编辑字体与字号</h3>
            <div class="settings-card settings-font-card">
              <div class="settings-row">
                <div>
                  <strong>可视化编辑字体</strong>
                  <p>选择内置字体，或使用本机已安装的字体。</p>
                </div>
                <select
                  :value="visualFontChoice"
                  aria-label="可视化编辑字体"
                  @change="emit('update:visualFontChoice', ($event.target as HTMLSelectElement).value as VisualFontChoice)"
                >
                  <option value="system">系统字体</option>
                  <option value="serif">衬线字体</option>
                  <option value="mono">等宽字体</option>
                  <option value="custom">自定义字体</option>
                </select>
              </div>
              <div v-if="visualFontChoice === 'custom'" class="settings-row settings-custom-font-row">
                <div>
                  <strong>字体名称</strong>
                  <p>输入本机字体名称；未安装时会回退到系统字体。</p>
                </div>
                <input
                  :value="customFontName"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  aria-label="自定义字体名称"
                  placeholder="例如：霞鹜文楷"
                  @input="customFontInput"
                />
              </div>
              <div class="settings-row settings-font-row">
                <div>
                  <strong>可视化编辑字号</strong>
                  <p>调整正文、标题和编辑中的内容大小。</p>
                </div>
                <div class="settings-font-controls">
                  <button
                    type="button"
                    aria-label="减小可视化编辑字号"
                    :disabled="visualFontSize <= 12"
                    @click="emit('update:visualFontSize', visualFontSize - 1)"
                  ><Minus :size="15" :stroke-width="1.75" /></button>
                  <output aria-label="可视化编辑字号">{{ visualFontSize }} px</output>
                  <button
                    type="button"
                    aria-label="增大可视化编辑字号"
                    :disabled="visualFontSize >= 24"
                    @click="emit('update:visualFontSize', visualFontSize + 1)"
                  ><Plus :size="15" :stroke-width="1.75" /></button>
                  <button
                    type="button"
                    class="settings-font-reset"
                    aria-label="重置可视化编辑字号"
                    :disabled="visualFontSize === 16"
                    @click="emit('update:visualFontSize', 16)"
                  >重置</button>
                </div>
              </div>
              <div class="settings-row settings-font-row">
                <div>
                  <strong>Markdown 源码字号</strong>
                  <p>调整源码视图中的文字大小。</p>
                </div>
                <div class="settings-font-controls">
                  <button
                    type="button"
                    aria-label="减小 Markdown 源码字号"
                    :disabled="sourceFontSize <= 12"
                    @click="emit('update:sourceFontSize', sourceFontSize - 1)"
                  ><Minus :size="15" :stroke-width="1.75" /></button>
                  <output aria-label="Markdown 源码字号">{{ sourceFontSize }} px</output>
                  <button
                    type="button"
                    aria-label="增大 Markdown 源码字号"
                    :disabled="sourceFontSize >= 24"
                    @click="emit('update:sourceFontSize', sourceFontSize + 1)"
                  ><Plus :size="15" :stroke-width="1.75" /></button>
                  <button
                    type="button"
                    class="settings-font-reset"
                    aria-label="重置 Markdown 源码字号"
                    :disabled="sourceFontSize === 14"
                    @click="emit('update:sourceFontSize', 14)"
                  >重置</button>
                </div>
              </div>
              <div class="settings-font-preview" aria-label="字体与字号预览">
                <div class="settings-font-preview-samples">
                  <div class="settings-font-preview-sample" role="group" aria-label="可视化编辑预览">
                    <p
                      class="settings-visual-font-sample"
                      :style="{
                        fontFamily: visualFontFamily(visualFontChoice, customFontName),
                        fontSize: `${visualFontSize}px`,
                      }"
                    >在同一页写下新的想法。<br />Tano 123</p>
                  </div>
                  <div class="settings-font-preview-sample" role="group" aria-label="Markdown 源码预览">
                    <p class="settings-source-font-sample" :style="{ fontSize: `${sourceFontSize}px` }">
                      # 在同一页写下新的想法<br />Tano 123
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p class="settings-local-note">可视化字体仅影响可视化编辑和页面内标题；Markdown 源码保持等宽字体。</p>
          </section>
          <section v-if="page === 'editing'" class="settings-section" aria-label="编辑行为">
            <h3>编辑行为</h3>
            <div class="settings-card">
              <div class="settings-row">
                <div>
                  <strong>编辑工具栏</strong>
                  <p>随选区显示，或停靠在顶部、左侧、右侧；也可拖动工具栏手柄调整。仅影响当前设备。</p>
                </div>
                <select aria-label="编辑工具栏" :value="toolbarMode ?? 'selection'"
                  @change="emit('update:toolbarMode', ($event.target as HTMLSelectElement).value as ToolbarMode)">
                  <option value="selection">随选区显示（默认）</option>
                  <option value="fixed">固定在顶部</option>
                  <option value="left">靠左停靠</option>
                  <option value="right">靠右停靠</option>
                </select>
              </div>
              <div
                v-for="option in displayOptions"
                :key="option.key"
                class="settings-row"
                :class="{ 'is-disabled': option.key === 'previewMathWhileEditing' && !revealMarkdown }"
              >
                <div>
                  <strong>{{ option.label }}</strong>
                  <p>{{
                    option.key === 'previewMathWhileEditing' && !revealMarkdown
                      ? '仅控制 Markdown 源码展开时的预览；公式面板仍会实时渲染。'
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
          <section v-if="page === 'appearance'" class="settings-section" aria-label="内容显示">
            <h3>内容显示</h3>
            <div class="settings-card">
              <div class="settings-row">
                <div>
                  <strong>页面内标题</strong>
                  <p>在编辑区顶部显示当前文档标题。</p>
                </div>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: showPageTitle }"
                  role="switch"
                  :aria-checked="showPageTitle"
                  aria-label="页面内标题"
                  @click="emit('update:showPageTitle', !showPageTitle)"
                >
                  <span />
                </button>
              </div>
              <div class="settings-row">
                <div>
                  <strong>页面标题来源</strong>
                  <p>仅“YAML title 优先”在字段为空或无效时使用文件名。</p>
                </div>
                <select
                  :value="pageTitleSource"
                  aria-label="页面标题来源"
                  @change="emit('update:pageTitleSource', ($event.target as HTMLSelectElement).value as PageTitleSource)"
                >
                  <option value="filename">文件名</option>
                  <option value="frontmatter">YAML title</option>
                  <option value="frontmatter-first">YAML title 优先</option>
                </select>
              </div>
            </div>
          </section>
          <p class="settings-local-note">
            <Monitor :size="14" />仅保存在当前设备，不随工作区共享。
          </p>
        </div>

        <div v-else-if="page === 'documents'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">文档能力</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">仅对当前工作区生效，文档能力与 Markdown 输出规则随空间共享。</p>
          <section class="settings-section" aria-label="文档能力">
            <h3>内容扩展<span class="settings-scope">工作区共享</span></h3>
            <p class="settings-section-description">关闭后显示原始内容，已有文档会保留。</p>
            <p v-if="capabilityError" class="settings-notice" role="alert">{{ capabilityError }}</p>
            <p v-else-if="!workspace || workspace.readOnly" class="settings-notice">
              {{
                !workspace
                  ? '打开工作区后即可调整文档能力。'
                  : '当前工作区为只读，无法更改文档能力。'
              }}
            </p>
            <div class="settings-card">
              <div
                v-for="feature in featureDefinitions"
                :key="feature.key"
                class="settings-row settings-row-compact"
              >
                <strong>{{ feature.label }}</strong>
                <button
                  type="button"
                  class="settings-switch"
                  :class="{ on: rules.features[feature.key] }"
                  role="switch"
                  :disabled="rulesDisabled"
                  :aria-checked="rules.features[feature.key]"
                  :aria-label="feature.label"
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
            <p class="settings-local-note">Kanban 与数据库块尚未实现；相关源码会保留。</p>
          </section>
          <section class="settings-section" aria-label="Markdown 输出">
            <h3>Markdown 输出</h3>
            <div class="settings-card">
              <div class="settings-row">
                <div>
                  <strong>Markdown 方言</strong>
                  <p>
                    决定新公式的默认写法：Pandoc 使用 LaTeX
                    定界符，其余使用美元符号。解析始终兼容两种写法。
                  </p>
                </div>
                <select
                  :value="rules.markdownDialect"
                  :disabled="rulesDisabled"
                  aria-label="Markdown 方言"
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
                  <option value="commonmark">CommonMark + 扩展</option>
                </select>
              </div>
              <div class="settings-row">
                <div>
                  <strong>公式输出语法</strong>
                  <p>默认保留已有公式的原始定界符。选择统一语法后，在下一次编辑保存正文时应用。</p>
                </div>
                <select
                  :value="rules.mathSyntax"
                  :disabled="rulesDisabled"
                  aria-label="公式输出语法"
                  @change="
                    emit('capability', {
                      mathSyntax: ($event.target as HTMLSelectElement)
                        .value as WorkspaceCapabilities['mathSyntax'],
                    })
                  "
                >
                  <option value="preserve">保留原始格式</option>
                  <option value="dollar">Dollar：$ / $$</option>
                  <option value="latex">LaTeX：\( \) / \[ \]</option>
                </select>
              </div>
            </div>
            <p class="settings-local-note">文档能力随工作区共享，只读成员无法更改。</p>
          </section>
        </div>

        <div v-else-if="page === 'workspace'" class="settings-content">
          <div class="settings-title-line">
            <h2 id="settings-title">工作区</h2>
            <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
              <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
            </div>
          </div>
          <p class="settings-lead">查看当前工作区的存储位置，管理文件、历史与 Agent 连接。</p>
          <section class="settings-section" aria-labelledby="settings-current-workspace">
            <h3 id="settings-current-workspace">当前空间</h3>
            <div class="settings-card settings-workspace-card">
              <div class="settings-info">
                <strong>{{ workspace?.name ?? '尚未打开工作区' }}</strong
                ><span>{{
                  mode === 'demo'
                    ? '浏览器演示 · 保存在当前浏览器'
                    : mode === 'web'
                      ? '在线工作区 · Markdown 保存在服务器'
                      : '本地工作区 · Markdown 保存在文件夹'
                }}</span
                ><small v-if="workspace && mode === 'local'">{{ workspace.path }}</small>
              </div>
              <div class="settings-actions">
                <button
                  v-if="mode === 'local' && native && !mobile"
                  @click="emit('action', 'open-folder')"
                >
                  <FolderOpen :size="17" />打开工作文件夹
                </button>
                <button
                  v-if="mode === 'local' && native && !mobile && workspace"
                  @click="emit('action', 'reveal')"
                >
                  <ExternalLink :size="17" />在资源管理器中显示
                </button>
                <button
                  v-if="mode === 'local' && native && workspace"
                  @click="emit('action', 'agent')"
                >
                  <Bot :size="17" />与 Agent 一起工作
                </button>
                <button
                  v-if="mode === 'local' && native && workspace && historyEnabled"
                  @click="emit('action', 'history')"
                >
                  <History :size="17" />空间版本历史
                </button>
                <button v-if="mobile && workspace" @click="emit('action', 'recycle')">
                  <Trash2 :size="17" />手机回收站
                </button>
              </div>
            </div>
          </section>
        </div>

        <component v-else-if="extraPages?.some(item => item.id === page)" :is="extraPages?.find(item => item.id === page)?.component" />
        <div v-else class="settings-content settings-about">
          <h2 id="settings-title">关于同页</h2>
          <p class="settings-lead">了解同页、常用快捷键与版本信息。</p>
          <div class="settings-card settings-brand-card">
            <div class="settings-about-brand">
              <img :src="'/favicon-green.svg?v=3'" alt="" />
              <h3>Tano <span>/ 同页</span></h3>
              <div class="settings-brand-actions">
                <span class="settings-version-pill">{{ version }}</span>
                <slot v-if="native && !mobile" name="update-panel"><UpdatePanel /></slot>
              </div>
            </div>
            <p class="settings-about-slogan">Humans and agents, on the same page.</p>
            <p class="settings-about-translation">人与 Agent，在同一页工作。</p>
          </div>

          <section class="settings-section" aria-labelledby="settings-work-mode">
            <h3 id="settings-work-mode">工作方式</h3>
            <div class="settings-about-feature settings-card">
              <Monitor :size="21" />
              <div>
                <strong>{{
                  mode === 'demo'
                    ? '你正在体验浏览器演示版'
                    : mode === 'web'
                      ? '这是你的在线 Markdown 工作台'
                      : '这是你的本地 Markdown 工作台'
                }}</strong>
                <p>
                  {{
                    mode === 'demo'
                      ? '演示修改保存在当前浏览器，不会写入电脑上的工作文件夹。启动桌面版，即可打开真实文件夹并监听外部修改。'
                      : mode === 'web'
                        ? '文档由当前存储适配器保存。可用能力由产品入口提供。'
                        : '文档保存为工作文件夹中的普通 .md 文件。Agent 和其他编辑器的修改会自动载入；冲突时保留双方内容。'
                  }}
                </p>
              </div>
            </div>
          </section>

          <section class="settings-section" aria-labelledby="settings-shortcuts">
            <h3 id="settings-shortcuts">键盘快捷键</h3>
            <div class="settings-shortcut-list settings-card">
              <span>收起或展开侧栏（编辑区外） <kbd>Ctrl B</kbd></span>
              <span>查找文档 <kbd>Ctrl K</kbd></span>
              <span>页内搜索 <kbd>Ctrl F</kbd></span>
              <span>查找与替换 <kbd>Ctrl H</kbd></span>
              <span>下一个 / 上一个匹配（搜索时） <kbd>Enter / Shift Enter</kbd></span>
              <span>关闭页内搜索 <kbd>Esc</kbd></span>
              <span>新建文档 <kbd>Ctrl N</kbd></span>
              <span>立即保存 <kbd>Ctrl S</kbd></span>
              <span>聚焦选区工具栏（显示时） <kbd>Alt F10</kbd></span>
            </div>
          </section>
        </div>
      </main>
    </section>
  </div>
</template>

<style>
.modal-backdrop.settings-backdrop {
  align-items: center;
  padding: 28px;
  z-index: 80;
  background: #20252b40;
  backdrop-filter: blur(4px);
}
.settings-dialog {
  position: relative;
  display: flex;
  width: min(1060px, 100%);
  height: min(760px, calc(100dvh - 56px));
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow:
    0 24px 80px #18212b29,
    0 4px 16px #18212b0d;
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
.settings-custom-font-row input::placeholder {
  color: var(--muted);
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
  line-height: 1.7;
}
.settings-source-font-sample {
  font-family: 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace;
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
.settings-local-note > svg {
  margin-top: 2px;
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
.settings-shortcut-list {
  color: var(--text-secondary);
  font-size: 12px;
}
.settings-shortcut-list > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
}
.settings-shortcut-list > span + span {
  border-top: 1px solid var(--line);
}
.settings-shortcut-list kbd {
  min-width: 52px;
  padding: 3px 7px;
  text-align: center;
  background: var(--paper);
  font-size: 11px;
  box-shadow: 0 1px 2px #18212b08;
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
  .settings-row:has(select) {
    flex-wrap: wrap;
    gap: 12px;
  }
  .settings-row:has(select) > div {
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
