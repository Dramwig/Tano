<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Bold,
  Italic,
  Code,
  Link,
  Sigma,
  AtSign,
  Superscript,
  ChevronDown,
  Heading2,
  List,
  Quote,
  ListTodo,
  Plus,
  Type,
  Bot,
  X,
} from 'lucide-vue-next';
import {
  blockTypes,
  inlineTypes,
  insertionCommands,
  commandEnabled,
  featureLevel,
} from '@tano/editor/document-model';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import type { DocumentFeatures } from '@tano/editor/runtime';
import TextStyleMenu from './TextStyleMenu.vue';

const props = defineProps<{
  context: EditorSelectionContext;
  disabled?: boolean;
  source?: boolean;
  enabledLevels?: readonly number[];
  features?: DocumentFeatures;
  compact?: boolean;
  vertical?: boolean;
  dragging?: boolean;
  assistant?: boolean;
}>();
const emit = defineEmits<{ command: [name: string, value?: string]; dismiss: []; assistant: [] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const input = ref<HTMLInputElement>();
const open = ref(false);
const form = ref<'link' | 'mention' | 'image' | 'footnote' | 'file' | 'embed' | null>(null);
const value = ref('');
const error = ref('');
const icons = {
  Reference: Link,
  Bold,
  Italic,
  CodeSpan: Code,
  Link,
  InlineMath: Sigma,
  FootnoteReference: Superscript,
  Mention: AtSign,
};
const availableBlocks = computed(() =>
  blockTypes.filter((item) => commandEnabled(item.command, props.enabledLevels, props.features)),
);
const availableInline = computed(() =>
  inlineTypes.filter((item) => commandEnabled(item.command, props.enabledLevels, props.features)),
);
const primaryInline = computed(() =>
  props.compact
    ? availableInline.value.filter((item) =>
        ['bold', 'italic', 'code', 'link'].includes(item.command),
      )
    : availableInline.value,
);
const extraInline = computed(() =>
  availableInline.value.filter(
    (item) => props.context.level === 'inline'
      ? !['bold', 'italic', 'code', 'link'].includes(item.command)
      : ['reference', 'mention'].includes(item.command),
  ),
);
const blockLabel = computed(() =>
  props.context.multiple
    ? '多个块'
    : (blockTypes.find((item) => item.type === props.context.block)?.label ??
      (props.context.block === 'FootnoteDefinition'
        ? '脚注定义'
        : props.context.block === 'LocalSource'
          ? '局部源码'
          : '当前块')),
);
const formLabel = computed(
  () =>
    ({
      link: '链接地址',
      mention: '文档名称或路径',
      image: '图片地址',
      footnote: '脚注内容',
      file: '附件地址',
      embed: '嵌入地址',
    })[form.value ?? 'link'],
);
const formHint = computed(
  () =>
    ({
      link: '填写网址或工作空间内的相对路径；留空可移除链接。',
      mention: '提及工作空间内的文档，例如：项目/计划。',
      image: '填写 HTTPS 地址或相对路径，例如：assets/图片.png。',
      footnote: '在所选文字后添加引用，脚注内容放在文档末尾。',
      file: '填写工作空间内的相对路径或 HTTPS 地址；也可拖入文件导入附件。',
      embed: '填写图片、音视频或文件地址。无法内嵌的资源显示可打开的链接卡片。',
    })[form.value ?? 'link'],
);
function close() {
  open.value = false;
  form.value = null;
  error.value = '';
}
watch(() => [props.context.level, props.context.block, props.disabled, props.source, props.dragging], close);
function outside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}
onMounted(() => window.addEventListener('click', outside));
onBeforeUnmount(() => window.removeEventListener('click', outside));
async function run(name: string, argument?: string) {
  if (props.disabled || props.source || !commandEnabled(name, props.enabledLevels, props.features))
    return;
  open.value = false;
  if (['link', 'mention', 'image', 'footnote', 'file', 'embed'].includes(name)) {
    form.value = name as typeof form.value;
    value.value = '';
    error.value = '';
    await nextTick();
    input.value?.focus();
  } else emit('command', name, argument);
}
function submit() {
  if (!form.value || props.disabled || props.source) return;
  const command = form.value;
  const trimmed = value.value.trim();
  if (command !== 'link' && !trimmed) {
    error.value = `请填写${formLabel.value}`;
    return;
  }
  if (
    (command === 'image' || command === 'link' || command === 'file' || command === 'embed') &&
    /^(?!https?:|mailto:|tel:)[a-z][\w+.-]*:/i.test(trimmed)
  ) {
    error.value = '请使用网页地址或工作空间内的相对路径';
    return;
  }
  if (command === 'mention' && /[\[\]\r\n|]/.test(trimmed)) {
    error.value = '文档名称不能包含方括号、竖线或换行';
    return;
  }
  close();
  emit('command', command, trimmed);
}
function escape() {
  if (props.compact && !open.value && !form.value) {
    emit('dismiss');
    return;
  }
  close();
  trigger.value?.focus();
}
function disableLeavingActions(element: Element) {
  // Outgoing buttons remain visible briefly, but no longer apply to the selection.
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
}
function enableEnteringActions(element: Element) {
  element.removeAttribute('inert');
  element.removeAttribute('aria-hidden');
}
</script>

<template>
  <div
    ref="root"
    class="contextual-toolbar"
    :class="compact ? 'selection-format-toolbar' : 'editor-toolbar'"
    :data-selection-level="source ? 'source' : context.level"
    role="toolbar"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    :aria-label="
      source ? 'Markdown 源码' : context.level === 'block' ? '块级编辑工具' : '行内文字工具'
    "
    @keydown.esc.stop.prevent="escape"
  >
    <slot name="leading" />
    <template v-if="source"><span class="document-type">Markdown 源码</span></template>
    <template v-else>
      <span v-if="!compact" class="selection-level"
        >{{ context.level === 'block' ? '块级' : '文字'
        }}<small>{{ context.level === 'block' ? 'Block' : 'Text' }}</small></span
      >
      <span v-if="!compact" class="toolbar-divider" />
      <div v-if="context.level === 'block' || compact" class="format-actions">
        <div class="menu-wrap">
          <button
            ref="trigger"
            type="button"
            class="block-type-trigger"
            aria-label="块级类型"
            :title="vertical ? blockLabel : undefined"
            :aria-expanded="open"
            :disabled="disabled"
            @mousedown.prevent
            @click="
              open = !open;
              form = null;
            "
          >
            <component v-if="vertical" :is="context.block === 'Heading' ? Heading2 : Type" :size="17" />
            <span v-else>{{ blockLabel }}</span><small v-if="!compact">Level {{ featureLevel(context.block) }}</small
            ><ChevronDown :size="13" />
          </button>
          <div
            v-if="open && !disabled"
            class="dropdown block-type-menu"
            aria-label="Block Level 选项"
          >
            <div class="toolbar-menu-label">块类型 · ＋ 插入新块</div>
            <div v-if="compact" class="heading-levels" aria-label="标题级别">
              <button
                v-for="level in 4"
                :key="level"
                type="button"
                :aria-label="`${level} 级标题`"
                :aria-pressed="context.block === 'Heading' && context.headingLevel === level"
                :disabled="disabled || !context.canTransform"
                @mousedown.prevent
                @click="run('heading', String(level))"
              >
                H{{ level }}
              </button>
            </div>
            <button
              v-for="item in availableBlocks"
              :key="item.type"
              :data-feature-level="item.level"
              type="button"
              :disabled="!context.canTransform && !insertionCommands.has(item.command)"
              :class="{ 'is-current': context.block === item.type }"
              :aria-pressed="context.block === item.type"
              :title="
                insertionCommands.has(item.command)
                  ? '在当前块后插入，空段落会替换'
                  : item.command === 'mermaid'
                    ? '转换为 Mermaid 代码块'
                    : '转换当前块'
              "
              @mousedown.prevent
              @click="run(item.command)"
            >
              <span
                >{{ item.label
                }}<small v-if="!compact">{{ item.type }} · Level {{ item.level }}</small></span
              ><Plus v-if="insertionCommands.has(item.command)" :size="13" />
            </button>
            <select v-if="compact && context.block === 'Callout'" aria-label="提示块类型"
              :disabled="disabled || !commandEnabled('callout', enabledLevels, features)"
              @change="run('callout', ($event.target as HTMLSelectElement).value)">
              <option disabled selected value="">提示类型</option>
              <option value="NOTE">备注</option><option value="TIP">提示</option>
              <option value="IMPORTANT">重要</option><option value="WARNING">警告</option>
              <option value="CAUTION">注意</option>
            </select>
          </div>
        </div>
        <div
          v-if="context.block === 'Heading' && !compact"
          class="heading-levels"
          aria-label="标题级别"
        >
          <button
            v-for="level in 4"
            :key="level"
            type="button"
            :aria-label="`${level} 级标题`"
            :aria-pressed="context.headingLevel === level"
            :disabled="disabled"
            @mousedown.prevent
            @click="run('heading', String(level))"
          >
            H{{ level }}
          </button>
        </div>
        <template v-else-if="!compact">
          <button
            v-for="item in [
              { name: 'heading', label: '标题', icon: Heading2 },
              { name: 'list', label: '无序列表', icon: List },
              { name: 'todo-list', label: '待办列表', icon: ListTodo },
              { name: 'quote', label: '引用', icon: Quote },
            ]"
            :key="item.name"
            type="button"
            class="icon-button block-shortcut"
            :aria-label="item.label"
            :title="item.label"
            :disabled="disabled || !context.canTransform"
            @mousedown.prevent
            @click="run(item.name)"
          >
            <component :is="item.icon" :size="17" />
          </button>
        </template>
      </div>
      <!-- Keep side buttons mounted so an interrupted transition can reverse in place. -->
      <Transition
        name="inline-tools"
        :css="compact && vertical"
        @before-enter="enableEnteringActions"
        @before-leave="disableLeavingActions"
        @leave-cancelled="enableEnteringActions"
      >
        <div
          v-if="context.level === 'inline' || (compact && vertical)"
          v-show="context.level === 'inline'"
          class="inline-tools"
        >
          <div class="format-actions inline-actions">
            <button
              v-for="item in primaryInline"
              :key="item.type"
              type="button"
              class="icon-button"
              :class="{ active: context.activeInline.includes(item.type) }"
              :aria-label="item.label"
              :title="compact ? item.label : `${item.label} · ${item.type} · Level ${item.level}`"
              :data-feature-level="item.level"
              :aria-pressed="context.activeInline.includes(item.type)"
              :disabled="
                disabled ||
                (context.inlineSource && !['bold', 'italic', 'code'].includes(item.command)) ||
                (!context.canStyleText && ['bold', 'italic', 'code', 'link'].includes(item.command))
              "
              @mousedown.prevent
              @click="run(item.command)"
            >
              <component :is="icons[item.type]" :size="17" />
            </button>
          </div>
        </div>
      </Transition>
      <TextStyleMenu
        v-if="context.level === 'inline' || compact"
        :more="compact"
        :dragging="dragging"
        :hide-formats="context.level !== 'inline'"
        :disabled="disabled || !context.canStyleText || context.inlineSource"
        @format="(name, color) => emit('command', name, color)"
      >
        <template v-if="compact && $slots.preferences" #preferences>
          <slot name="preferences" />
        </template>
        <template v-if="compact && extraInline.length" #extra>
          <button
            v-for="item in extraInline"
            :key="item.type"
            type="button"
            :aria-label="item.label"
            :disabled="disabled || context.inlineSource"
            @mousedown.prevent
            @click="run(item.command)"
          >
            <component :is="icons[item.type]" :size="16" />{{ item.label }}
          </button>
        </template>
      </TextStyleMenu>
      <button
        v-if="!compact && context.level === 'block' && commandEnabled('reference', enabledLevels, features)"
        type="button"
        class="icon-button"
        aria-label="引用对象或文档"
        title="@ 引用对象或文档 · Level 2"
        :disabled="disabled"
        @mousedown.prevent
        @click="run('reference')"
      >
        <AtSign :size="17" />
      </button>
      <button
        v-if="!compact && context.level === 'block' && commandEnabled('mention', enabledLevels, features)"
        type="button"
        class="icon-button"
        aria-label="提及文档"
        title="提及文档或附件 · Level 1"
        :disabled="disabled"
        @mousedown.prevent
        @click="run('mention')"
      >
        <AtSign :size="17" />
      </button>
      <select
        v-if="!compact && context.block === 'Callout'"
        aria-label="提示块类型"
        :disabled="disabled || !commandEnabled('callout', enabledLevels, features)"
        @change="run('callout', ($event.target as HTMLSelectElement).value)"
      >
        <option disabled selected value="">提示类型</option>
        <option value="NOTE">备注</option>
        <option value="TIP">提示</option>
        <option value="IMPORTANT">重要</option>
        <option value="WARNING">警告</option>
        <option value="CAUTION">注意</option>
      </select>
      <form
        v-if="form && !disabled"
        class="toolbar-input-panel"
        :aria-label="formLabel"
        @submit.prevent="submit"
      >
        <label
          >{{ formLabel
          }}<input ref="input" v-model="value" :aria-label="formLabel" autocomplete="off"
        /></label>
        <p>{{ formHint }}</p>
        <p v-if="error" class="danger-text" role="alert">{{ error }}</p>
        <div>
          <button type="submit" class="primary-button">
            {{ form === 'link' && !value.trim() ? '移除链接' : '应用' }}</button
          ><button type="button" class="icon-button" aria-label="取消" @click="escape">
            <X :size="16" />
          </button>
        </div>
      </form>
    </template>
    <slot name="trailing" />
    <button v-if="assistant" type="button" class="icon-button" aria-label="请助手讨论选区" title="与助手讨论选区" @mousedown.prevent @click="emit('assistant')"><Bot :size="16" /></button>
  </div>
</template>

<style scoped>
.contextual-toolbar {
  justify-content: flex-start;
}
.selection-format-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 24px;
  color: var(--text);
  background: var(--paper);
  box-shadow:
    0 5px 24px #1f23281a,
    0 1px 4px #1f23280d;
}
.selection-format-toolbar .block-type-trigger {
  min-width: 0;
}
.selection-format-toolbar .format-actions {
  gap: 2px;
}
.selection-format-toolbar .icon-button:not(.toolbar-drag-handle) {
  width: 30px;
  height: 30px;
  border-radius: 50%;
}
.selection-format-toolbar :deep(.menu-wrap) {
  position: static;
}
.selection-format-toolbar :deep(.dropdown),
.selection-format-toolbar .toolbar-input-panel {
  left: 0;
  top: calc(100% + 6px);
  width: min(300px, var(--selection-toolbar-width, 300px));
  max-height: var(--selection-menu-height, 60vh);
  overflow-y: auto;
  transform: none;
}
.selection-format-toolbar :deep(.text-style-dropdown) {
  width: min(260px, var(--selection-toolbar-width, 300px));
}
.selection-format-toolbar[aria-orientation='vertical'] {
  flex-direction: column;
  flex-wrap: nowrap;
  width: 46px;
  padding: 7px;
  gap: 4px;
}
.selection-format-toolbar[aria-orientation='vertical'] .format-actions {
  flex-direction: column;
}
.inline-tools {
  display: contents;
}
.selection-format-toolbar[aria-orientation='vertical'] .inline-tools {
  display: grid;
  grid-template-rows: 1fr;
  margin-block: 0;
}
.selection-format-toolbar[aria-orientation='vertical'] .inline-actions {
  min-height: 0;
}
.selection-format-toolbar[aria-orientation='vertical'] .inline-actions > button {
  flex-shrink: 0;
}
.selection-format-toolbar[aria-orientation='vertical'] .inline-tools-enter-active,
.selection-format-toolbar[aria-orientation='vertical'] .inline-tools-leave-active {
  transition:
    grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1),
    margin-block 240ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.inline-tools-enter-active .inline-actions,
.inline-tools-leave-active .inline-actions {
  overflow: hidden;
}
.selection-format-toolbar[aria-orientation='vertical'] .inline-tools-enter-from,
.selection-format-toolbar[aria-orientation='vertical'] .inline-tools-leave-to {
  grid-template-rows: 0fr;
  /* Cancel the extra flex gap while the button group has no height. */
  margin-block: -2px;
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .inline-tools-enter-active,
  .inline-tools-leave-active {
    transition: none !important;
  }
}
.selection-format-toolbar[aria-orientation='vertical'] .block-type-trigger {
  width: 30px;
  height: 30px;
  padding: 0;
  justify-content: center;
  gap: 0;
}
.selection-format-toolbar[aria-orientation='vertical'] .block-type-trigger > svg:last-child {
  width: 10px;
}
.selection-level {
  display: flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}
.selection-level small {
  font-size: 10px;
  color: var(--muted);
}
.block-type-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 95px;
  justify-content: space-between;
  padding: 5px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.block-type-trigger:hover {
  background: var(--accent);
}
.block-type-menu {
  top: calc(100% + 7px);
  left: 0;
  width: 248px;
  max-height: min(620px, 70vh);
  overflow-y: auto;
}
.block-type-menu button {
  justify-content: space-between;
}
.block-type-menu small {
  margin-left: 8px;
  color: var(--muted);
  font-size: 10px;
}
.toolbar-menu-label {
  color: var(--muted);
  font-size: 11px;
  padding: 6px 10px;
}
.is-current,
button[aria-pressed='true'] {
  color: var(--green);
  background: var(--accent);
}
.heading-levels {
  display: flex;
  gap: 2px;
}
.heading-levels button {
  border: 0;
  border-radius: 4px;
  padding: 5px;
  background-color: transparent;
  color: var(--text-secondary);
  font-size: 11px;
}
.heading-levels button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--green);
}
.toolbar-input-panel {
  position: absolute;
  left: 24px;
  top: 100%;
  z-index: 30;
  width: min(360px, calc(100% - 32px));
  padding: 14px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 10px 35px #1f232818;
}
.toolbar-input-panel label {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
.toolbar-input-panel input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--paper);
  color: var(--text);
}
.toolbar-input-panel p {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
  margin: 8px 0;
}
.toolbar-input-panel > div {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
@media (max-width: 700px) {
  .selection-level small,
  .block-shortcut {
    display: none;
  }
  .contextual-toolbar {
    gap: 3px;
  }
  .inline-actions {
    gap: 1px;
  }
  .inline-actions .icon-button {
    width: 27px;
  }
  .toolbar-input-panel {
    left: 12px;
  }
}
</style>
