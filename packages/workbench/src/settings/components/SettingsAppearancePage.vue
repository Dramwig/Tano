<script setup lang="ts">
import { computed, inject } from 'vue';
import { Minus, Monitor, Plus, RotateCcw } from 'lucide-vue-next';
import { appearanceKinds, builtinDefault, type AppearanceKind } from '../../appearance/appearance';
import { sanitizeCustomFontName, type VisualFontChoice } from '../../appearance/editor-font';
import { useHelpPreferences } from '../../help/help-guidance';
import { localeLoadError, setUiLocale, t, uiLocale } from '../../i18n/i18n';
import { uiLocaleOptions } from '../../i18n/locale';
import { settingHint } from '../setting-examples';
import type { ThemePreference } from '../../appearance/theme';
import { useEditorFontFamily } from '../../appearance/use-editor-font';
import { type InterfaceFontChoice } from '../../appearance/interface-font';
import { useInterfaceFont } from '../../appearance/use-interface-font';
import GlassWallpaperSetting from '../../appearance/components/GlassWallpaperSetting.vue';
import ThemePresetPicker from '../../appearance/components/ThemePresetPicker.vue';
import { settingsPanelContextKey } from './settings-context';

const ctx = inject(settingsPanelContextKey);
if (!ctx) throw new Error('Settings panel context is required');
const {
  props,
  scopeLabel,
  display,
  fixedDisplayMode,
  frostActive,
  displayMode,
  displayModeDescription,
  splitFonts,
} = ctx;

const appearanceRows: Record<AppearanceKind, { label: string; description: string; defaultLabel: string }> = {
  color: { label: '配色主题', description: '从内置项和当前工作区已启用的插件中选择，保存在当前设备。', defaultLabel: '中性灰' },
  icons: { label: '文件与目录图标', description: '从内置项和当前工作区已启用的插件中选择，保存在当前设备。', defaultLabel: '同页线框' },
  layout: { label: '布局风格', description: '选择页面结构，可与任意配色、图标混搭。留边布局的内容区四周留空，侧栏融入背景。', defaultLabel: '贴边布局' },
  material: { label: '材质', description: '选择侧栏和页面的质感与阴影，可与任意布局、配色混搭。', defaultLabel: '平面' },
  shape: { label: '形态与密度', description: '选择组件圆角与控件间距；字体在下方单独设置。', defaultLabel: '标准圆角' },
};

function appearanceChoices(kind: AppearanceKind) {
  const appearance = props.appearance!;
  return kind === 'color'
    ? appearance.colors
    : kind === 'layout'
      ? appearance.layouts
      : kind === 'shape'
        ? appearance.shapes
        : kind === 'material'
          ? appearance.materials
          : appearance.icons;
}

const previewFontFamily = useEditorFontFamily(
  () => props.visualFontChoice,
  () => props.customFontName,
  () => splitFonts.value,
);

type FontTarget = 'unified' | 'chinese' | 'english';
const fontRows = computed(() =>
  splitFonts.value.enabled
    ? [
        { target: 'chinese' as const, label: '中文字体', customLabel: '中文字体名称', customAriaLabel: '自定义中文字体名称', ...splitFonts.value.chinese },
        { target: 'english' as const, label: '英文字体', customLabel: '英文字体名称', customAriaLabel: '自定义英文字体名称', ...splitFonts.value.english },
      ]
    : [
        {
          target: 'unified' as const,
          label: '可视化编辑字体',
          customLabel: '字体名称',
          customAriaLabel: '自定义字体名称',
          choice: props.visualFontChoice,
          customName: props.customFontName,
        },
      ],
);

function updateFontChoice(target: FontTarget, choice: VisualFontChoice) {
  if (target === 'unified') ctx!.emitUpdateVisualFontChoice(choice);
  else
    ctx!.emitUpdateSplitFontSettings({
      ...splitFonts.value,
      [target]: { ...splitFonts.value[target], choice },
    });
}

function customFontInput(event: Event, target: FontTarget = 'unified') {
  const input = event.target as HTMLInputElement;
  const value = sanitizeCustomFontName(input.value);
  if (input.value !== value) input.value = value;
  if (target === 'unified') ctx!.emitUpdateCustomFontName(value);
  else
    ctx!.emitUpdateSplitFontSettings({
      ...splitFonts.value,
      [target]: { ...splitFonts.value[target], customName: value },
    });
}

const { preference: interfaceFont, update: updateInterfaceFont } = useInterfaceFont();
function interfaceFontInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = sanitizeCustomFontName(input.value);
  if (input.value !== value) input.value = value;
  updateInterfaceFont({ customName: value });
}

type MotionOptionKey =
  | 'smoothCaret'
  | 'typingMotion'
  | 'blockMotion'
  | 'blockResizeMotion'
  | 'sourceRevealMotion'
  | 'reduceInterfaceMotion';
const motionOptions: { key: MotionOptionKey; settingsKey: string; readonly label: string; readonly description: string }[] = [
  {
    key: 'reduceInterfaceMotion',
    settingsKey: 'appearance-reduce-motion',
    get label() { return t('减少动态效果'); },
    get description() { return t('关闭按钮回弹、面板弹出和编辑区动画。系统开启“减少动态效果”时始终生效。'); },
  },
  {
    key: 'smoothCaret',
    settingsKey: 'appearance-smooth-caret',
    get label() { return t('光标平滑移动'); },
    get description() { return t('输入、移动光标和换行时，光标平滑滑到新位置。'); },
  },
  {
    key: 'typingMotion',
    settingsKey: 'appearance-typing-motion',
    get label() { return t('文字输入与删除动画'); },
    get description() { return t('新输入的文字淡入，删除的文字在原位置淡出。'); },
  },
  {
    key: 'blockMotion',
    settingsKey: 'appearance-block-motion',
    get label() { return t('段落增删动画'); },
    get description() { return t('新段落浮现，删除的段落淡出，其余段落平滑让位。'); },
  },
  {
    key: 'blockResizeMotion',
    settingsKey: 'appearance-block-resize-motion',
    get label() { return t('段落变高时下方内容平滑移动'); },
    get description() { return t('段落内换行或删减使高度变化时，下方内容平滑跟随。'); },
  },
  {
    key: 'sourceRevealMotion',
    settingsKey: 'appearance-source-reveal-motion',
    get label() { return t('Markdown 源码展开收起动画'); },
    get description() { return t('光标进入或离开链接、行内代码、公式和引用时，源码平滑展开，离开后平滑收起。'); },
  },
];

function motionOptionActive(key: MotionOptionKey) {
  return key === 'reduceInterfaceMotion' ? display.value[key] === true : display.value[key] !== false;
}
function toggleMotionOption(key: MotionOptionKey) {
  ctx!.emitUpdateEditorPreferences({ ...display.value, [key]: !motionOptionActive(key) });
}

const { preferences: helpPreferences, setEnabled: setHelpEnabled } = useHelpPreferences();
</script>

<template>
  <div class="settings-content">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('外观') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
        <Monitor :size="13" /><span>{{ scopeLabel }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('外观默认用于当前用户的所有工作区，也可为此工作区单独设置。') }}</p>
    <section class="settings-section" :aria-label="t('外观')">
      <h3>{{ t('外观') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div class="settings-row" data-settings-key="appearance-language">
          <div>
            <strong>{{ t('界面语言') }}</strong>
            <p>{{ t('立即切换界面语言，仅保存在当前设备。') }}</p>
          </div>
          <select :value="uiLocale" :aria-label="t('界面语言')" @change="setUiLocale(($event.target as HTMLSelectElement).value)">
            <option v-for="option in uiLocaleOptions" :key="option.value" :value="option.value" :lang="option.value">{{ option.label }}</option>
          </select>
        </div>
        <p v-if="localeLoadError" role="alert">{{ t('无法加载界面语言，请重试。') }}</p>
        <div v-if="props.appearance" class="settings-row" data-settings-key="appearance-scope">
          <div>
            <strong>{{ t('为此工作区单独设置') }}</strong>
            <p>{{ t(props.appearance.scope === 'workspace' ? '仅覆盖配色、图标、布局、材质和形态；关闭后恢复用户默认。' : '外观各项使用用户默认；其他工作区会沿用这些选择。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: props.appearance.scope === 'workspace' }"
            role="switch"
            :aria-label="t('为此工作区单独设置')"
            :aria-checked="props.appearance.scope === 'workspace'"
            :disabled="!props.appearance.workspaceId"
            @click="ctx.emitAppearance({ workspaceId: props.appearance.workspaceId, kind: 'scope', id: props.appearance.scope === 'workspace' ? 'user' : 'workspace' })"
          >
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-theme">
          <div>
            <strong>{{ t('显示模式') }}</strong>
            <p>{{ t(displayModeDescription) }}</p>
          </div>
          <select
            :value="displayMode"
            :disabled="!!fixedDisplayMode"
            :aria-label="t('显示模式')"
            @change="ctx.emitUpdateTheme(($event.target as HTMLSelectElement).value as ThemePreference)"
          >
            <option v-if="!fixedDisplayMode || fixedDisplayMode === 'light'" value="light">{{ t('浅色') }}</option>
            <option v-if="!fixedDisplayMode || fixedDisplayMode === 'dark'" value="dark">{{ t('深色') }}</option>
            <option v-if="!fixedDisplayMode" value="system">{{ t('跟随系统') }}</option>
          </select>
        </div>
        <template v-if="props.appearance">
          <section class="theme-presets" data-settings-key="appearance-presets" :aria-label="t('主题预设')">
            <h3>{{ t('主题预设') }}</h3>
            <p>{{ t('只应用预设声明的配色、图标、布局、材质和形态，未指定的项保持当前。') }}</p>
            <ThemePresetPicker :appearance="props.appearance" @select="ctx.emitAppearance($event)" />
          </section>
          <template v-for="kind in appearanceKinds" :key="kind">
            <div class="settings-row" :data-settings-key="`appearance-${kind}`">
              <div>
                <strong>{{ t(appearanceRows[kind].label) }}</strong>
                <p>{{ t(appearanceRows[kind].description) }}</p>
                <p v-if="props.appearance.selected[kind] !== props.appearance.active[kind]" role="status">
                  {{ t('原主题当前不可用，已使用「{0}」。原主题恢复可用后会自动切回。', [t(appearanceRows[kind].defaultLabel)]) }}
                </p>
              </div>
              <select
                :aria-label="t(appearanceRows[kind].label)"
                :value="props.appearance.selected[kind]"
                @change="ctx.emitAppearance({ workspaceId: props.appearance.workspaceId, kind, id: ($event.target as HTMLSelectElement).value })"
              >
                <option :value="builtinDefault">{{ t(appearanceRows[kind].defaultLabel) }}</option>
                <option v-if="props.appearance.selected[kind] !== props.appearance.active[kind]" :value="props.appearance.selected[kind]" disabled>{{ t('原主题暂不可用（使用默认）') }}</option>
                <option v-for="choice in appearanceChoices(kind)" :key="choice.id" :value="choice.id">{{ t(choice.label) }}</option>
              </select>
            </div>
            <GlassWallpaperSetting v-if="kind === 'material' && frostActive" />
          </template>
          <p v-for="message in props.appearance.errors" :key="message" role="alert">{{ message }}</p>
        </template>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('界面字体')">
      <h3>{{ t('界面字体') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div class="settings-row" data-settings-key="appearance-interface-font">
          <div>
            <strong>{{ t('界面字体') }}</strong>
            <p>{{ t('用于侧栏、标签、菜单和对话框，不影响文档正文。仅保存在当前设备。') }}</p>
          </div>
          <select
            :value="interfaceFont.choice"
            :aria-label="t('界面字体')"
            @change="updateInterfaceFont({ choice: ($event.target as HTMLSelectElement).value as InterfaceFontChoice })"
          >
            <option value="builtin">{{ t('内置（Inter + 思源黑体）') }}</option>
            <option value="system">{{ t('系统字体') }}</option>
            <option value="custom">{{ t('自定义字体') }}</option>
          </select>
        </div>
        <div v-if="interfaceFont.choice === 'custom'" class="settings-row settings-custom-font-row" data-settings-key="appearance-interface-custom-font">
          <div>
            <strong>{{ t('界面字体名称') }}</strong>
            <p>{{ t('输入本机字体名称；未安装时会回退到系统字体。') }}</p>
          </div>
          <input
            :value="interfaceFont.customName"
            type="text"
            maxlength="80"
            autocomplete="off"
            :aria-label="t('自定义界面字体名称')"
            :placeholder="t('例如：HarmonyOS Sans SC')"
            @input="interfaceFontInput"
          />
        </div>
      </div>
    </section>

    <section class="settings-section" data-settings-key="appearance-custom-font" :aria-label="t('编辑字体与字号')">
      <h3>{{ t('编辑字体与字号') }}</h3>
      <div class="settings-card settings-font-card" data-surface-role="section">
        <div class="settings-row" data-settings-key="appearance-split-fonts">
          <div>
            <strong>{{ t('分别设置中英文字体') }}</strong>
            <p>{{ t('开启后分别选择中文和英文字体；关闭后恢复统一字体设置。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: splitFonts.enabled }"
            role="switch"
            :aria-checked="splitFonts.enabled"
            :aria-label="t('分别设置中英文字体')"
            @click="ctx.emitUpdateSplitFontSettings({ ...splitFonts, enabled: !splitFonts.enabled })"
          >
            <span />
          </button>
        </div>
        <template v-for="font in fontRows" :key="font.target">
          <div class="settings-row" :data-settings-key="font.target === 'unified' ? 'appearance-visual-font' : `appearance-${font.target}-font`">
            <div>
              <strong>{{ t(font.label) }}</strong>
              <p>{{ t('选择内置字体，或使用本机已安装的字体。') }}</p>
            </div>
            <select
              :value="font.choice"
              :aria-label="t(font.label)"
              @change="updateFontChoice(font.target, ($event.target as HTMLSelectElement).value as VisualFontChoice)"
            >
              <option value="system">{{ t('系统字体') }}</option>
              <option value="serif">{{ t('衬线字体') }}</option>
              <option value="handwritten">{{ t('手写字体') }}</option>
              <option value="mono">{{ t('等宽字体') }}</option>
              <option value="custom">{{ t('自定义字体') }}</option>
            </select>
          </div>
          <div v-if="font.choice === 'custom'" class="settings-row settings-custom-font-row" :data-settings-key="font.target === 'unified' ? 'appearance-custom-font' : `appearance-${font.target}-custom-font`">
            <div>
              <strong>{{ t(font.customLabel) }}</strong>
              <p>{{ t('输入本机字体名称；未安装时会回退到系统字体。') }}</p>
            </div>
            <input
              :value="font.customName"
              type="text"
              maxlength="80"
              autocomplete="off"
              :aria-label="t(font.customAriaLabel)"
              :placeholder="t('例如：霞鹜文楷')"
              @input="customFontInput($event, font.target)"
            />
          </div>
        </template>
        <div class="settings-row settings-font-row" data-settings-key="appearance-visual-size">
          <div>
            <strong>{{ t('可视化编辑字号') }}</strong>
            <p>{{ t('调整正文、标题和编辑中的内容大小。') }}</p>
          </div>
          <div class="settings-font-controls">
            <button type="button" :aria-label="t('减小可视化编辑字号')" :disabled="props.visualFontSize <= 12" @click="ctx.emitUpdateVisualFontSize(props.visualFontSize - 1)">
              <Minus :size="15" :stroke-width="1.75" />
            </button>
            <output :aria-label="t('可视化编辑字号')">{{ props.visualFontSize }} px</output>
            <button type="button" :aria-label="t('增大可视化编辑字号')" :disabled="props.visualFontSize >= 24" @click="ctx.emitUpdateVisualFontSize(props.visualFontSize + 1)">
              <Plus :size="15" :stroke-width="1.75" />
            </button>
            <button type="button" class="settings-font-reset" :aria-label="t('重置可视化编辑字号')" :data-tooltip="t('重置可视化编辑字号')" :disabled="props.visualFontSize === 16" @click="ctx.emitUpdateVisualFontSize(16)">
              <RotateCcw :size="15" :stroke-width="1.75" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="settings-row settings-font-row" data-settings-key="appearance-source-size">
          <div>
            <strong>{{ t('Markdown 源码字号') }}</strong>
            <p>{{ t('调整源码视图中的文字大小。') }}</p>
          </div>
          <div class="settings-font-controls">
            <button type="button" :aria-label="t('减小 Markdown 源码字号')" :disabled="props.sourceFontSize <= 12" @click="ctx.emitUpdateSourceFontSize(props.sourceFontSize - 1)">
              <Minus :size="15" :stroke-width="1.75" />
            </button>
            <output :aria-label="t('Markdown 源码字号')">{{ props.sourceFontSize }} px</output>
            <button type="button" :aria-label="t('增大 Markdown 源码字号')" :disabled="props.sourceFontSize >= 24" @click="ctx.emitUpdateSourceFontSize(props.sourceFontSize + 1)">
              <Plus :size="15" :stroke-width="1.75" />
            </button>
            <button type="button" class="settings-font-reset" :aria-label="t('重置 Markdown 源码字号')" :data-tooltip="t('重置 Markdown 源码字号')" :disabled="props.sourceFontSize === 14" @click="ctx.emitUpdateSourceFontSize(14)">
              <RotateCcw :size="15" :stroke-width="1.75" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="settings-font-preview" :aria-label="t('字体与字号预览')">
          <div class="settings-font-preview-samples">
            <div class="settings-font-preview-sample" role="group" :aria-label="t('可视化编辑预览')">
              <p class="settings-visual-font-sample" :style="{ fontFamily: previewFontFamily, fontSize: `${props.visualFontSize}px` }">
                {{ t('在同一页写下新的想法。') }}<br />Tano 123
              </p>
            </div>
            <div class="settings-font-preview-sample" role="group" :aria-label="t('Markdown 源码预览')">
              <p class="settings-source-font-sample" :style="{ fontFamily: previewFontFamily, fontSize: `${props.sourceFontSize}px` }">
                {{ t('# 在同一页写下新的想法') }}<br />Tano 123
              </p>
            </div>
          </div>
        </div>
      </div>
      <p class="settings-local-note">{{ t('所选字体应用于可视化编辑、Markdown 源码和页面内标题；两种编辑模式的字号可分别调整。') }}</p>
    </section>

    <section class="settings-section" :aria-label="t('内容显示')">
      <h3>{{ t('内容显示') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div class="settings-row" data-settings-key="appearance-auto-spacing" v-bind="settingHint('appearance-auto-spacing')">
          <div>
            <strong>{{ t('正文自动间距') }}</strong>
            <p>{{ t('在中文与英文、数字、行内公式及引用之间自动留白，仅影响显示，不修改原文。') }}</p>
          </div>
          <button type="button" class="settings-switch" :class="{ on: display.autoSpacing }" role="switch" :aria-checked="display.autoSpacing ?? false" :aria-label="t('正文自动间距')" @click="ctx.emitUpdateEditorPreferences({ ...display, autoSpacing: !display.autoSpacing })">
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-page-title" v-bind="settingHint('appearance-page-title')">
          <div>
            <strong>{{ t('页面内标题') }}</strong>
            <p>{{ t('在编辑区顶部显示当前文档标题。') }}</p>
          </div>
          <button type="button" class="settings-switch" :class="{ on: props.showPageTitle }" role="switch" :aria-checked="props.showPageTitle" :aria-label="t('页面内标题')" @click="ctx.emitUpdateShowPageTitle(!props.showPageTitle)">
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-properties" v-bind="settingHint('appearance-properties')">
          <div>
            <strong>{{ t('文档属性') }}</strong>
            <p>{{ t('在可视化编辑区显示文档属性。') }}</p>
          </div>
          <button type="button" class="settings-switch" :class="{ on: props.showDocumentProperties }" role="switch" :aria-checked="props.showDocumentProperties" :aria-label="t('文档属性')" @click="ctx.emitUpdateShowDocumentProperties(!props.showDocumentProperties)">
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-discussion" v-bind="settingHint('appearance-discussion')">
          <div>
            <strong>{{ t('文档讨论') }}</strong>
            <p>{{ t('有讨论时在文档底部显示，没有讨论时自动隐藏。') }}</p>
          </div>
          <button type="button" class="settings-switch" :class="{ on: props.showDocumentDiscussion }" role="switch" :aria-checked="props.showDocumentDiscussion" :aria-label="t('文档讨论')" @click="ctx.emitUpdateShowDocumentDiscussion(!props.showDocumentDiscussion)">
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-outline" v-bind="settingHint('appearance-outline')">
          <div>
            <strong>{{ t('显示目录') }}</strong>
          </div>
          <button type="button" class="settings-switch" :class="{ on: props.showOutline }" role="switch" :aria-checked="props.showOutline" :aria-label="t('显示目录')" @click="ctx.emitUpdateShowOutline(!props.showOutline)">
            <span />
          </button>
        </div>
        <div class="settings-row" data-settings-key="appearance-outline-position" v-bind="settingHint('appearance-outline-position')">
          <div>
            <strong>{{ t('目录显示在左侧') }}</strong>
            <p>{{ t('将文档大纲放到编辑区左侧。') }}</p>
          </div>
          <button type="button" class="settings-switch" :class="{ on: props.outlineOnLeft }" role="switch" :aria-checked="props.outlineOnLeft ?? false" :aria-label="t('目录显示在左侧')" @click="ctx.emitUpdateOutlineOnLeft(!(props.outlineOnLeft ?? false))">
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('动效')">
      <h3>{{ t('动效') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div v-for="option in motionOptions" :key="option.key" class="settings-row" :data-settings-key="option.settingsKey">
          <div>
            <strong>{{ option.label }}</strong>
            <p>{{ option.description }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: motionOptionActive(option.key) }"
            role="switch"
            :aria-checked="motionOptionActive(option.key)"
            :aria-label="option.label"
            :disabled="option.key !== 'reduceInterfaceMotion' && display.reduceInterfaceMotion === true"
            @click="toggleMotionOption(option.key)"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('使用提示')">
      <h3>{{ t('使用提示') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div class="settings-row" data-settings-key="appearance-help">
          <div>
            <strong>{{ t('偶尔显示使用提示') }}</strong>
            <p>{{ t('在你停下来时，在帮助按钮上方显示简短的用法提示。关闭后仍可手动查看帮助。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: helpPreferences.enabled }"
            role="switch"
            :aria-checked="helpPreferences.enabled"
            :aria-label="t('偶尔显示使用提示')"
            @click="setHelpEnabled(!helpPreferences.enabled)"
          >
            <span />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
