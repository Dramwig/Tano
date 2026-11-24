<script setup lang="ts">
import { computed, inject } from 'vue';
import { ArrowRight, Monitor } from 'lucide-vue-next';
import {
  chineseInputOptions,
  chineseSyntaxOptions,
  markdownAutocompleteOptions,
  normalizeChineseInput,
  normalizeCopyFormat,
  normalizeMarkdownAutocomplete,
  normalizeSelectionWrapping,
  selectionWrappingOptions,
  type EditorPreferences,
} from '@tano/editor/runtime';
import { isFeatureEnabled } from '../../features';
import { t } from '../../i18n';
import { settingHint } from '../../setting-examples';
import type { ToolbarMode } from '../../toolbar-preference';
import { settingsPanelContextKey } from './settings-context';

const ctx = inject(settingsPanelContextKey);
if (!ctx) throw new Error('Settings panel context is required');
const { props, scopeLabel, display } = ctx;

const wrapping = computed(() => normalizeSelectionWrapping(display.value.selectionWrapping));
const wrappingOptions = computed(() =>
  selectionWrappingOptions.map((option) => {
    const [input, output] = option.example.split('；')[0]!.split(' → ');
    const [opening, closing] = output!.split('文字');
    return {
      ...option,
      example: t(option.example),
      input: input?.replaceAll('文字', t('文字')),
      opening,
      closing,
    };
  }),
);
function setWrapping(key: keyof typeof wrapping.value, enabled: boolean) {
  ctx!.emitUpdateEditorPreferences({
    ...display.value,
    selectionWrapping: { ...wrapping.value, [key]: enabled },
  });
}

const autocomplete = computed(() =>
  normalizeMarkdownAutocomplete(display.value.markdownAutocomplete),
);
const spacingAutocompleteAvailable = isFeatureEnabled('markdownSpacingAutocomplete');
function setMarkdownAutocomplete(key: keyof typeof autocomplete.value, enabled: boolean) {
  ctx!.emitUpdateEditorPreferences({
    ...display.value,
    markdownAutocomplete: { ...autocomplete.value, [key]: enabled },
  });
}

const chineseInput = computed(() =>
  normalizeChineseInput(display.value.chineseInput, display.value.selectionWrapping),
);
function setChineseInput(key: keyof typeof chineseInput.value, enabled: boolean) {
  ctx!.emitUpdateEditorPreferences({
    ...display.value,
    chineseInput: { ...chineseInput.value, [key]: enabled },
  });
}

function displayOptionActive(key: keyof EditorPreferences) {
  const value =
    key === 'previewMermaidWhileEditing' ? display.value[key] !== false : display.value[key];
  return (
    value &&
    ((key !== 'previewMathWhileEditing' && key !== 'previewMermaidWhileEditing') ||
      props.revealMarkdown)
  );
}

const displayOptions = [
  {
    key: 'previewMathWhileEditing',
    settingsKey: 'preview-math',
    get label() { return t('编辑时预览公式'); },
    get description() { return t('展开 Markdown 源码编辑公式时同步显示排版效果。'); },
  },
  {
    key: 'previewMermaidWhileEditing',
    settingsKey: 'preview-mermaid',
    get label() { return t('编辑时预览 Mermaid'); },
    get description() { return t('展开 Markdown 源码编辑 Mermaid 时同步显示图表。'); },
  },
  {
    key: 'folding',
    settingsKey: 'folding',
    get label() { return t('标题与列表折叠'); },
    get description() { return t('显示折叠按钮，临时收起标题下的内容或列表项。'); },
  },
] as const;
</script>

<template>
  <div class="settings-content">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('编辑器') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
        <Monitor :size="13" /><span>{{ scopeLabel }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('适用于这台设备上的所有工作区，仅影响你的编辑体验。') }}</p>

    <section class="settings-section" aria-labelledby="settings-editor">
      <h3 id="settings-editor">{{ t('编辑器') }}</h3>
      <div class="settings-card">
        <div class="settings-row" data-settings-key="editing-default-mode" v-bind="settingHint('editing-default-mode')">
          <div>
            <strong>{{ t('默认编辑模式') }}</strong>
            <p>{{ t('选择打开文档时使用的视图。') }}</p>
          </div>
          <select
            :value="props.defaultSource ? 'source' : 'visual'"
            :aria-label="t('默认编辑模式')"
            @change="ctx.emitUpdateDefaultSource(($event.target as HTMLSelectElement).value === 'source')"
          >
            <option value="visual">{{ t('可视化编辑') }}</option>
            <option value="source">{{ t('Markdown 源码') }}</option>
          </select>
        </div>
        <div class="settings-row" data-settings-key="editing-reveal-markdown" v-bind="settingHint('editing-reveal-markdown')">
          <div>
            <strong>{{ t('光标进入时展开 Markdown 源码') }}</strong>
            <p>{{ t('类似 Typora、Obsidian 的实时预览：光标进入时显示 Markdown 语法，离开后恢复排版。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: props.revealMarkdown }"
            role="switch"
            :aria-checked="props.revealMarkdown"
            :aria-label="t('光标进入时展开 Markdown 源码')"
            @click="ctx.emitUpdateRevealMarkdown(!props.revealMarkdown)"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('编辑行为')">
      <h3>{{ t('编辑行为') }}</h3>
      <div class="settings-card">
        <div class="settings-row" data-settings-key="editing-copy-format" v-bind="settingHint('editing-copy-format')">
          <div>
            <strong>{{ t('默认复制格式') }}</strong>
            <p>{{ t('设置可视化编辑区的默认复制与剪切格式，右键菜单仍可单次选择其他格式。仅保存在当前设备。') }}</p>
            <p v-if="normalizeCopyFormat(display.copyFormat) === 'rich'">{{ t('在 Word 中粘贴后选择“保留源格式”，以保留颜色、底色和字体。') }}</p>
            <p v-if="normalizeCopyFormat(display.copyFormat) === 'wechat'">{{ t('公众号复制会将外链转为可见地址，公式在本地渲染为 SVG。') }}</p>
            <p v-if="normalizeCopyFormat(display.copyFormat) === 'zhihu'">{{ t('知乎复制会携带公式识别标记，由知乎编辑器解析公式。') }}</p>
          </div>
          <select
            :aria-label="t('默认复制格式')"
            :value="normalizeCopyFormat(display.copyFormat)"
            @change="ctx.emitUpdateEditorPreferences({ ...display, copyFormat: normalizeCopyFormat(($event.target as HTMLSelectElement).value) })"
          >
            <option value="markdown">{{ t('Markdown 源码（默认）') }}</option>
            <option value="rich">{{ t('富文本（Word / WPS）') }}</option>
            <option value="wechat">{{ t('微信公众号') }}</option>
            <option value="zhihu">{{ t('知乎') }}</option>
            <option value="html">{{ t('HTML 源码') }}</option>
            <option value="text">{{ t('纯文本') }}</option>
          </select>
        </div>
        <div class="settings-row" data-settings-key="editing-toolbar" v-bind="settingHint('editing-toolbar')">
          <div>
            <strong>{{ t('编辑工具栏') }}</strong>
            <p>{{ t('随选区显示，或停靠在顶部、底部、左侧、右侧；也可拖动工具栏手柄调整。仅影响当前设备。') }}</p>
          </div>
          <select
            :aria-label="t('编辑工具栏')"
            :value="props.toolbarMode ?? 'selection'"
            @change="ctx.emitUpdateToolbarMode(($event.target as HTMLSelectElement).value as ToolbarMode)"
          >
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
          :data-settings-key="`editing-${option.settingsKey}`"
          v-bind="settingHint(`editing-${option.settingsKey}`)"
          :class="{ 'is-disabled': option.key !== 'folding' && !props.revealMarkdown }"
        >
          <div>
            <strong>{{ t(option.label) }}</strong>
            <p>{{
              option.key !== 'folding' && !props.revealMarkdown
                ? option.key === 'previewMathWhileEditing'
                  ? t('仅控制 Markdown 源码展开时的预览；公式面板仍会实时渲染。')
                  : t('仅控制 Markdown 源码展开时的预览；Mermaid 面板仍会实时渲染。')
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
            :disabled="option.key !== 'folding' && !props.revealMarkdown"
            @click="ctx.emitUpdateEditorPreferences({ ...display, [option.key]: !displayOptionActive(option.key) })"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('AI 功能')">
      <h3>{{ t('AI 功能') }}</h3>
      <div class="settings-card">
        <div class="settings-row" data-settings-key="editing-ai-shortcut" v-bind="settingHint('editing-ai-shortcut')">
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
            @click="ctx.emitUpdateEditorPreferences({ ...display, blankBlockAiShortcut: !display.blankBlockAiShortcut })"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('选区符号包裹')">
      <h3>{{ t('选区符号包裹') }}</h3>
      <div class="settings-card">
        <div class="settings-row" data-settings-key="editing-wrapping" v-bind="settingHint('editing-wrapping')">
          <div>
            <strong>{{ t('输入符号包裹选区') }}</strong>
            <p>{{ t('选中文字后输入符号，自动补齐两端。可视化与源码模式通用。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t('输入符号包裹选区')"
            :class="{ on: wrapping.enabled }"
            :aria-checked="wrapping.enabled"
            @click="setWrapping('enabled', !wrapping.enabled)"
          >
            <span />
          </button>
        </div>
        <div
          v-for="option in wrappingOptions"
          :key="option.key"
          class="settings-row settings-row-compact"
          :data-settings-key="`editing-wrapping-${option.key}`"
          :class="{ 'is-disabled': !wrapping.enabled }"
        >
          <div class="settings-inline-copy">
            <strong>{{ t(option.label) }}</strong>
            <span class="settings-inline-example" :title="option.example" :aria-label="option.example">
              <kbd aria-hidden="true">{{ option.input }}</kbd>
              <ArrowRight :size="12" aria-hidden="true" />
              <code aria-hidden="true"><span>{{ option.opening }}</span>{{ t('文字') }}<span>{{ option.closing }}</span></code>
            </span>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t(option.label)"
            :class="{ on: wrapping[option.key] }"
            :aria-checked="wrapping[option.key]"
            :disabled="!wrapping.enabled"
            @click="setWrapping(option.key, !wrapping[option.key])"
          >
            <span />
          </button>
        </div>
      </div>
      <p class="settings-local-note">{{ t('选区包裹仅影响当前设备，扩展语法的包裹默认关闭。正文显示由工作区「Markdown 与格式」控制，其他 Markdown 应用可能不支持。') }}</p>
    </section>

    <section class="settings-section" :aria-label="t('自动补全')">
      <h3>{{ t('自动补全') }}</h3>
      <p class="settings-local-note">{{ t('可视化编辑内置列表续行与语法识别。设置仅保存在当前设备。') }}</p>
      <div class="settings-card">
        <div v-for="option in markdownAutocompleteOptions" :key="option.key" class="settings-row settings-row-compact" :data-settings-key="`editing-autocomplete-${option.key}`">
          <div class="settings-inline-copy">
            <strong>{{ t(option.label) }}</strong>
            <span class="settings-inline-example" :aria-label="`${option.input} → ${option.output}`">
              <kbd aria-hidden="true">{{ option.input }}</kbd>
              <ArrowRight :size="12" aria-hidden="true" />
              <code aria-hidden="true"><span>{{ option.output }}</span></code>
            </span>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t(option.label)"
            :class="{ on: autocomplete[option.key] }"
            :aria-checked="autocomplete[option.key]"
            @click="setMarkdownAutocomplete(option.key, !autocomplete[option.key])"
          >
            <span />
          </button>
        </div>
        <div v-if="spacingAutocompleteAvailable" class="settings-row" data-settings-key="editing-autocomplete-spacing" v-bind="settingHint('editing-autocomplete-spacing')">
          <div>
            <strong>{{ t('输入时自动补空格') }}</strong>
            <p>{{ t('输入时在中文与英文、数字、行内公式及引用之间补空格，写入 Markdown 原文。可视化与源码模式通用。') }}</p>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t('输入时自动补空格')"
            :class="{ on: display.completeTextSpacing }"
            :aria-checked="display.completeTextSpacing ?? false"
            @click="ctx.emitUpdateEditorPreferences({ ...display, completeTextSpacing: !display.completeTextSpacing })"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section" :aria-label="t('中文输入优化')">
      <h3>{{ t('中文输入优化') }}</h3>
      <p class="settings-local-note">{{ t('在 Markdown 语法位置把中文符号识别为语法，默认开启；全局映射会转换所有位置的符号，默认关闭。可视化与源码模式通用。') }}</p>
      <p class="settings-local-note">{{ t('语法位置识别') }}</p>
      <div class="settings-card">
        <div v-for="option in chineseSyntaxOptions" :key="option.key" class="settings-row settings-row-compact" :data-settings-key="`editing-chinese-input-${option.key}`">
          <div class="settings-inline-copy">
            <strong>{{ t(option.label) }}</strong>
            <span class="settings-inline-examples">
              <span
                v-for="(example, index) in ('examples' in option ? option.examples : [{ before: '', input: option.input, output: option.output }])"
                :key="index"
                class="settings-inline-example"
                :aria-label="`${example.before}${example.input} → ${example.output}`"
              >
                <kbd aria-hidden="true">{{ example.before }}{{ example.input }}</kbd>
                <ArrowRight :size="12" aria-hidden="true" />
                <code aria-hidden="true"><span>{{ example.output }}</span></code>
              </span>
            </span>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t(option.label)"
            :class="{ on: chineseInput[option.key] }"
            :aria-checked="chineseInput[option.key]"
            @click="setChineseInput(option.key, !chineseInput[option.key])"
          >
            <span />
          </button>
        </div>
      </div>
      <p class="settings-local-note">{{ t('全局映射') }}</p>
      <div class="settings-card">
        <div v-for="option in chineseInputOptions" :key="option.key" class="settings-row settings-row-compact" :data-settings-key="`editing-chinese-input-${option.key}`">
          <div class="settings-inline-copy">
            <strong>{{ t(option.label) }}</strong>
            <span class="settings-inline-example" :aria-label="`${option.input} → ${option.output}`">
              <kbd aria-hidden="true">{{ option.input }}</kbd>
              <ArrowRight :size="12" aria-hidden="true" />
              <code aria-hidden="true"><span>{{ option.output }}</span></code>
            </span>
          </div>
          <button
            type="button"
            class="settings-switch"
            role="switch"
            :aria-label="t(option.label)"
            :class="{ on: chineseInput[option.key] }"
            :aria-checked="chineseInput[option.key]"
            @click="setChineseInput(option.key, !chineseInput[option.key])"
          >
            <span />
          </button>
        </div>
      </div>
      <p class="settings-local-note">{{ t('仅影响当前设备的新输入，不转换粘贴或已有正文。转换后的符号可配合上方的选区包裹设置使用。') }}</p>
    </section>
  </div>
</template>
