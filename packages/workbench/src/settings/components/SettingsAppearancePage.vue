<script setup lang="ts">
import { inject } from 'vue';
import { Monitor } from 'lucide-vue-next';
import { appearanceKinds, builtinDefault, type AppearanceKind } from '../../appearance/appearance';
import { sanitizeCustomFontName } from '../../appearance/editor-font';
import { useHelpPreferences } from '../../help/help-guidance';
import { localeLoadError, setUiLocale, t, uiLocale } from '../../i18n/i18n';
import { uiLocaleOptions } from '../../i18n/locale';
import type { ThemePreference } from '../../appearance/theme';
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

const { preference: interfaceFont, update: updateInterfaceFont } = useInterfaceFont();
function interfaceFontInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = sanitizeCustomFontName(input.value);
  if (input.value !== value) input.value = value;
  updateInterfaceFont({ customName: value });
}

type InterfaceMotionOptionKey = 'reduceInterfaceMotion' | 'entranceMotion';
const interfaceMotionOptions: { key: InterfaceMotionOptionKey; settingsKey: string; readonly label: string; readonly description: string }[] = [
  {
    key: 'reduceInterfaceMotion',
    settingsKey: 'appearance-reduce-motion',
    get label() { return t('减少界面动态效果'); },
    get description() { return t('关闭按钮回弹、面板弹出和页面入场等界面动画，不影响文档编辑动效。系统开启“减少动态效果”时始终生效。'); },
  },
  {
    key: 'entranceMotion',
    settingsKey: 'appearance-entrance-motion',
    get label() { return t('页面入场动画'); },
    get description() { return t('打开欢迎页、插件中心、文件夹，或切换侧栏视图和设置分区时，内容从上到下依次浮现。'); },
  },
];

function motionOptionActive(key: InterfaceMotionOptionKey) {
  return key === 'reduceInterfaceMotion' ? display.value[key] === true : display.value[key] !== false;
}
function toggleMotionOption(key: InterfaceMotionOptionKey) {
  ctx!.emitUpdateEditorPreferences({ ...display.value, [key]: !motionOptionActive(key) });
}

const { preferences: helpPreferences, setEnabled: setHelpEnabled } = useHelpPreferences();
</script>

<template>
  <div class="settings-content">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('界面外观') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
        <Monitor :size="13" /><span>{{ scopeLabel }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('外观默认用于当前用户的所有工作区，也可为此工作区单独设置。') }}</p>

    <section class="settings-section" :aria-label="t('常规')">
      <h3>{{ t('常规') }}</h3>
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

    <section class="settings-section" :aria-label="t('主题与风格')">
      <h3>{{ t('主题与风格') }}</h3>
      <div class="settings-card" data-surface-role="section">
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

    <section class="settings-section" :aria-label="t('界面动效')">
      <h3>{{ t('界面动效') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div v-for="option in interfaceMotionOptions" :key="option.key" class="settings-row" :data-settings-key="option.settingsKey">
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
  </div>
</template>
