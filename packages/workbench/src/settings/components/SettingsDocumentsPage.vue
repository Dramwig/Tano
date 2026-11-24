<script setup lang="ts">
import { computed, inject } from 'vue';
import { BookOpen } from 'lucide-vue-next';
import { featureDefinitions, type WorkspaceCapabilities } from '@tano/editor/runtime';
import { t } from '../../i18n/i18n';
import { settingHint } from '../setting-examples';
import CapabilitySyntax from '../../workspace/components/CapabilitySyntax.vue';
import { settingsPanelContextKey } from './settings-context';

const ctx = inject(settingsPanelContextKey);
if (!ctx) throw new Error('Settings panel context is required');
const { props, scopeLabel, rules, rulesDisabled } = ctx;

const mathSyntaxDescription = computed(
  () =>
    ({
      preserve: '已有公式保持原来的写法，新公式使用上面的默认格式。',
      dollar: '新旧公式统一使用美元符号（$…$ / $$…$$），在下次编辑保存正文时应用。',
      latex: '新旧公式统一使用反斜杠括号（\\(…\\) / \\[…\\]），在下次编辑保存正文时应用。',
    })[rules.value.mathSyntax],
);
</script>

<template>
  <div class="settings-content">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('Markdown 与格式') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
        <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('仅对当前工作区生效，文档能力与 Markdown 语法规则随空间共享。') }}</p>

    <section class="settings-section" :aria-label="t('内容扩展')">
      <h3>{{ t('内容扩展') }}<span class="settings-scope">{{ t('工作区共享') }}</span></h3>
      <p class="settings-section-description">{{ t('关闭后显示原始内容，已有文档会保留。') }}</p>
      <p v-if="props.capabilityError" class="settings-notice" role="alert">{{ props.capabilityError }}</p>
      <p
        v-else-if="!props.workspace || props.workspace.readOnly || !(props.workspace.canManageSettings ?? props.mode !== 'web')"
        class="settings-notice"
      >
        {{
          !props.workspace
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
          :data-tooltip="t(feature.label)"
          :data-tooltip-example="feature.key"
          data-tooltip-placement="left"
        >
          <div class="settings-inline-copy">
            <strong>{{ t(feature.label) }}</strong>
            <CapabilitySyntax
              :feature="feature.key"
              :data-tooltip="t(feature.label)"
              :data-tooltip-example="feature.key"
              tabindex="0"
            />
          </div>
          <button
            type="button"
            class="settings-switch"
            :class="{ on: rules.features[feature.key] }"
            role="switch"
            :disabled="rulesDisabled"
            :aria-checked="rules.features[feature.key]"
            :aria-label="t(feature.label)"
            @click="ctx.emitCapability({ feature: feature.key, enabled: !rules.features[feature.key] })"
          >
            <span />
          </button>
        </div>
      </div>
      <p class="settings-local-note">{{ t('Kanban 与数据库块尚未实现；相关源码会保留。') }}</p>
    </section>

    <section class="settings-section" :aria-label="t('Markdown 语法')">
      <h3>{{ t('Markdown 语法') }}</h3>
      <div class="settings-card">
        <div class="settings-row" data-settings-key="documents-math-recognition" v-bind="settingHint('documents-math-recognition')">
          <div>
            <strong>{{ t('识别的公式语法') }}</strong>
            <p>{{ t('未选中的语法按普通文本显示，不修改 Markdown 原文。') }}</p>
            <p><code>$…$ / $$…$$</code> · <code>\(…\) / \[…\]</code></p>
          </div>
          <select
            :value="rules.mathRecognition ?? 'all'"
            :disabled="rulesDisabled || !rules.features.math"
            :aria-label="t('识别的公式语法')"
            @change="ctx.emitCapability({ mathRecognition: ($event.target as HTMLSelectElement).value as WorkspaceCapabilities['mathRecognition'] })"
          >
            <option value="all">{{ t('全部支持（推荐）') }}</option>
            <option value="dollar">{{ t('仅美元符号') }}</option>
            <option value="latex">{{ t('仅反斜杠括号') }}</option>
          </select>
        </div>
        <div class="settings-row" data-settings-key="documents-dialect" v-bind="settingHint('documents-dialect')">
          <div>
            <strong>{{ t('新公式默认格式') }}</strong>
            <p>{{ t('设置新公式的写法，不确定时保留默认即可。') }}</p>
            <p class="settings-format-example">
              <span>{{ t('行内公式') }} <code>{{ rules.markdownDialect === 'pandoc' ? '\\(x^2\\)' : '$x^2$' }}</code></span>
              <span>{{ t('独立成行的公式') }} <code>{{ rules.markdownDialect === 'pandoc' ? '\\[x^2\\]' : '$$x^2$$' }}</code></span>
            </p>
          </div>
          <select
            :value="rules.markdownDialect === 'pandoc' ? 'pandoc' : 'obsidian'"
            :disabled="rulesDisabled"
            :aria-label="t('新公式默认格式')"
            @change="ctx.emitCapability({ markdownDialect: ($event.target as HTMLSelectElement).value as WorkspaceCapabilities['markdownDialect'] })"
          >
            <option value="obsidian">{{ t('美元符号') }}</option>
            <option value="pandoc">{{ t('反斜杠括号') }}</option>
          </select>
        </div>
        <div class="settings-row" data-settings-key="documents-math-syntax" v-bind="settingHint('documents-math-syntax')">
          <div>
            <strong>{{ t('已有公式保存格式') }}</strong>
            <p>{{ t(mathSyntaxDescription) }}</p>
          </div>
          <select
            :value="rules.mathSyntax"
            :disabled="rulesDisabled"
            :aria-label="t('已有公式保存格式')"
            @change="ctx.emitCapability({ mathSyntax: ($event.target as HTMLSelectElement).value as WorkspaceCapabilities['mathSyntax'] })"
          >
            <option value="preserve">{{ t('保留原样（推荐）') }}</option>
            <option value="dollar">{{ t('统一为美元符号') }}</option>
            <option value="latex">{{ t('统一为反斜杠括号') }}</option>
          </select>
        </div>
        <div class="settings-row" data-settings-key="documents-bullet-marker" v-bind="settingHint('documents-bullet-marker')">
          <div>
            <strong>{{ t('无序列表标记') }}</strong>
            <p>{{ t('选择无序列表与待办列表的 Markdown 标记，在下一次编辑保存正文时应用。') }}</p>
          </div>
          <select
            :value="rules.bulletListMarker"
            :disabled="rulesDisabled"
            :aria-label="t('无序列表标记')"
            @change="ctx.emitCapability({ bulletListMarker: ($event.target as HTMLSelectElement).value as WorkspaceCapabilities['bulletListMarker'] })"
          >
            <option value="-">{{ t('短横线：- 列表项') }}</option>
            <option value="+">{{ t('加号：+ 列表项') }}</option>
            <option value="*">{{ t('星号：* 列表项') }}</option>
          </select>
        </div>
      </div>
    </section>
  </div>
</template>
