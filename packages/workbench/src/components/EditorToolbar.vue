<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import {
  Bold,
  Italic,
  Code,
  Link,
  Sigma,
  AtSign,
  Superscript,
  ChevronDown,
  ChevronRight,
  Check,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading,
  List,
  ListOrdered,
  Quote,
  ListTodo,
  FileSymlink,
  Image,
  Table,
  Workflow,
  Info,
  ListCollapse,
  Paperclip,
  PanelsTopLeft,
  PanelTop,
  Columns2,
  Minus,
  SquareSigma,
  Plus,
  Type,
  Bot,
  MessageSquare,
  X,
} from 'lucide-vue-next';
import {
  blockTypes,
  inlineTypes,
  insertionCommands,
  wrappingCommands,
  commandEnabled,
  featureLevel,
} from '@tano/editor/selection-context';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
import type { DocumentFeatures } from '@tano/editor/runtime';
import TextStyleMenu from './TextStyleMenu.vue';
import { formattingShortcuts } from '../shortcuts';
import { announceToolbarMenuOpen, isAnotherToolbarMenu, toolbarMenuOpenEvent } from '../toolbar-menu';

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
  assistantDisabled?: boolean;
  annotation?: boolean;
  todo?: boolean;
}>();
const emit = defineEmits<{ command: [name: string, value?: string]; dismiss: []; assistant: []; annotation: []; todo: [] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const input = ref<HTMLInputElement>();
const open = ref(false);
const headingsOpen = ref(false);
const headingPanel = ref<HTMLElement>();
const headingGroupId = useId();
const headingIcons = [Heading1, Heading2, Heading3, Heading4];
watch(open, () => { headingsOpen.value = false; });
function headingTrigger() {
  return root.value?.querySelector<HTMLButtonElement>('[data-heading-trigger]');
}
async function openHeadings(focus = false) {
  const button = headingTrigger();
  if (!button || button.disabled) return;
  headingsOpen.value = true;
  await nextTick();
  const panel = headingPanel.value;
  const menu = button.closest('.block-type-menu');
  if (!panel || !menu) return;
  const anchor = button.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const parentElement = panel.offsetParent as HTMLElement;
  const parent = parentElement.getBoundingClientRect();
  const width = panel.offsetWidth;
  const right = bounds.right + 4;
  const left = bounds.left - width - 4;
  const x = right + width <= window.innerWidth - 8 ? right
    : left >= 8 ? left : Math.max(8, window.innerWidth - width - 8);
  const y = Math.max(8, Math.min(anchor.top, window.innerHeight - panel.offsetHeight - 8));
  panel.style.left = `${x - parent.left - parentElement.clientLeft}px`;
  panel.style.top = `${y - parent.top - parentElement.clientTop}px`;
  if (focus) (panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    ?? panel.querySelector<HTMLButtonElement>('button'))?.focus();
}
function closeHeadings(focus = false) {
  headingsOpen.value = false;
  if (focus) headingTrigger()?.focus();
}
function headingPanelKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    closeHeadings(true);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [...headingPanel.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
}
function closeHeadingOnViewportChange() { closeHeadings(); }
function closeOtherMenu(event: Event) {
  if (!isAnotherToolbarMenu(event, root.value)) return;
  close();
  headingsOpen.value = false;
}
onMounted(() => {
  window.addEventListener('resize', closeHeadingOnViewportChange);
  window.addEventListener('scroll', closeHeadingOnViewportChange, true);
  window.addEventListener(toolbarMenuOpenEvent, closeOtherMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', closeHeadingOnViewportChange);
  window.removeEventListener('scroll', closeHeadingOnViewportChange, true);
  window.removeEventListener(toolbarMenuOpenEvent, closeOtherMenu);
});
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
const blockIcons = {
  ObjectReference: FileSymlink,
  Heading,
  Paragraph: Type,
  Quote,
  BulletList: List,
  OrderedList: ListOrdered,
  TodoList: ListTodo,
  CodeBlock: Code,
  ImageBlock: Image,
  Table,
  MermaidBlock: Workflow,
  Callout: Info,
  Toggle: ListCollapse,
  FileBlock: Paperclip,
  Embed: PanelTop,
  Tabs: PanelsTopLeft,
  Columns: Columns2,
  HorizontalRule: Minus,
  MathBlock: SquareSigma,
};
const blockMenuGroups = [
  ['Paragraph', 'Heading'],
  ['BulletList', 'OrderedList', 'TodoList', 'Quote', 'Callout'],
  ['ImageBlock', 'FileBlock', 'Embed', 'ObjectReference'],
  ['Table', 'CodeBlock', 'MermaidBlock', 'MathBlock'],
  ['Toggle', 'Tabs', 'Columns', 'HorizontalRule'],
] satisfies (typeof blockTypes)[number]['type'][][];
const availableBlocks = computed(() => blockMenuGroups
  .map(types => types
    .map(type => blockTypes.find(item => item.type === type)!)
    .filter(item => commandEnabled(item.command, props.enabledLevels, props.features)))
  .filter(items => items.length > 0)
  .flatMap((items, groupIndex) => items.map((item, index) => ({
    ...item,
    label: t(item.label),
    separatorBefore: groupIndex > 0 && index === 0,
  }))),
);
const availableInline = computed(() =>
  inlineTypes.map(item => ({ ...item, label: t(item.label) })).filter((item) => commandEnabled(item.command, props.enabledLevels, props.features)),
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
      ? !['bold', 'italic', 'code', 'link', 'math'].includes(item.command)
      : ['reference', 'mention'].includes(item.command),
  ),
);
const blockLabel = computed(() => {
  if (props.context.multiple) return t('多个块');
  const block = blockTypes.find(item => item.type === props.context.block);
  if (block) return t(block.label);
  return props.context.block === 'FootnoteDefinition' ? t('脚注定义')
    : props.context.block === 'LocalSource' ? t('局部源码') : t('当前块');
});
const formLabel = computed(
  () =>
    ({
      link: t('链接地址'),
      mention: t('文档名称或路径'),
      image: t('图片地址'),
      footnote: t('脚注内容'),
      file: t('附件地址'),
      embed: t('嵌入地址'),
    })[form.value ?? 'link'],
);
const formHint = computed(
  () =>
    ({
      link: t('填写网址或工作空间内的相对路径；留空可移除链接。'),
      mention: t('提及工作空间内的文档，例如：项目/计划。'),
      image: t('填写 HTTPS 地址或相对路径，例如：assets/图片.png。'),
      footnote: t('在所选文字后添加引用，脚注内容放在文档末尾。'),
      file: t('填写工作空间内的相对路径或 HTTPS 地址；也可拖入文件导入附件。'),
      embed: t('填写图片、音视频或文件地址。无法内嵌的资源显示可打开的链接卡片。'),
    })[form.value ?? 'link'],
);
function close() {
  open.value = false;
  form.value = null;
  error.value = '';
}
watch(() => [props.context.level, props.context.block, props.disabled, props.source, props.dragging], close);
function outside(event: MouseEvent) {
  // A menu action can unmount its button before the click reaches window.
  // The original event path still identifies it as a toolbar click.
  if (!root.value || !event.composedPath().includes(root.value)) close();
}
function toggleBlockMenu() {
  if (open.value) {
    open.value = false;
    form.value = null;
    return;
  }
  announceToolbarMenuOpen(root.value);
  open.value = true;
  form.value = null;
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
    error.value = t('请填写{0}', [formLabel.value]);
    return;
  }
  if (
    (command === 'image' || command === 'link' || command === 'file' || command === 'embed') &&
    /^(?!https?:|mailto:|tel:)[a-z][\w+.-]*:/i.test(trimmed)
  ) {
    error.value = t('请使用网页地址或工作空间内的相对路径');
    return;
  }
  if (command === 'mention' && /[\[\]\r\n|]/.test(trimmed)) {
    error.value = t('文档名称不能包含方括号、竖线或换行');
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
      source ? t('Markdown 源码') : context.level === 'block' ? t('块级编辑工具') : t('行内文字工具')
    "
    @keydown.esc.stop.prevent="escape"
  >
    <slot name="leading" />
    <template v-if="source"><span class="document-type">{{ t('Markdown 源码') }}</span></template>
    <template v-else>
      <span v-if="!compact" class="selection-level"
        >{{ context.level === 'block' ? t('块级') : t('文字')
        }}<small>{{ context.level === 'block' ? 'Block' : 'Text' }}</small></span
      >
      <span v-if="!compact" class="toolbar-divider" />
      <div v-if="context.level === 'block' || compact" class="format-actions">
        <div class="menu-wrap">
          <button
            ref="trigger"
            type="button"
            class="block-type-trigger"
            :aria-label="t('块级类型')"
            :data-tooltip="vertical ? blockLabel : undefined"
            :aria-expanded="open"
            :disabled="disabled"
            @mousedown.prevent
            @click="toggleBlockMenu"
          >
            <component v-if="vertical" :is="context.block === 'Heading' ? Heading2 : Type" :size="17" />
            <span v-else>{{ blockLabel }}</span><small v-if="!compact">Level {{ featureLevel(context.block) }}</small
            ><ChevronDown :size="13" />
          </button>
          <div
            v-if="open && !disabled"
            class="dropdown compact-action-menu block-type-menu panel-scrollbar"
            :aria-label="t('Block Level 选项')"
          >
            <template v-for="item in availableBlocks" :key="item.type">
              <div v-if="item.separatorBefore" class="menu-divider" role="separator" />
              <button
                :data-feature-level="item.level"
                :data-heading-trigger="item.type === 'Heading' ? '' : undefined"
                type="button"
                :disabled="!context.canTransform && !insertionCommands.has(item.command) && !wrappingCommands.has(item.command)"
                :class="{ 'is-current': context.block === item.type }"
                :aria-pressed="item.type === 'Heading' ? undefined : context.block === item.type"
                :aria-expanded="item.type === 'Heading' ? headingsOpen : undefined"
                :aria-controls="item.type === 'Heading' ? headingGroupId : undefined"
                :data-tooltip="
                  item.type === 'Heading' ? t('标题级别') : insertionCommands.has(item.command)
                    ? t('在当前块后插入，空段落会替换')
                    : item.command === 'mermaid'
                      ? t('转换为 Mermaid 代码块')
                      : t('转换当前块')
                "
                @mousedown.prevent
                @pointerenter="item.type === 'Heading' ? ($event.pointerType === 'mouse' && openHeadings()) : closeHeadings()"
                @keydown.right="item.type === 'Heading' && ($event.preventDefault(), openHeadings(true))"
                @click="item.type === 'Heading' ? openHeadings($event.detail === 0) : run(item.command)"
              >
                <component :is="blockIcons[item.type]" class="block-type-icon" :size="16" aria-hidden="true" />
                <span class="block-type-label"
                  >{{ item.label
                  }}<small v-if="!compact">{{ item.type }} · Level {{ item.level }}</small></span
                ><ChevronRight v-if="item.type === 'Heading'" :size="14" aria-hidden="true" />
                <Plus v-else-if="insertionCommands.has(item.command)" :size="13" aria-hidden="true" />
              </button>
              <button v-if="item.type === 'Callout'" type="button" data-feature-level="1"
                @mousedown.prevent @click="run('callout', 'CUSTOM')">
                <span class="block-type-icon" aria-hidden="true">💡</span>
                <span class="block-type-label">{{ t('自定义块') }}</span>
              </button>
            </template>
            <select v-if="compact && context.block === 'Callout'" :aria-label="t('提示块类型')"
              :disabled="disabled || !commandEnabled('callout', enabledLevels, features)"
              @change="run('callout', ($event.target as HTMLSelectElement).value)">
              <option disabled selected value="">{{ t('提示类型') }}</option>
              <option value="NOTE">{{ t('备注') }}</option><option value="TIP">{{ t('提示') }}</option>
              <option value="IMPORTANT">{{ t('重要') }}</option><option value="WARNING">{{ t('警告') }}</option>
              <option value="CAUTION">{{ t('注意') }}</option>
              <option value="CUSTOM">{{ t('自定义块') }}</option>
            </select>
          </div>
          <div v-if="open && headingsOpen && !disabled" :id="headingGroupId" ref="headingPanel"
            class="heading-submenu compact-action-menu panel-scrollbar" role="group" :aria-label="t('标题级别')"
            @keydown="headingPanelKey">
            <button v-for="(icon, index) in headingIcons" :key="index" type="button"
              :aria-pressed="context.block === 'Heading' && context.headingLevel === index + 1"
              :disabled="disabled || !context.canTransform"
              @mousedown.prevent
              @click="run('heading', String(index + 1))">
              <component :is="icon" class="block-type-icon" :size="16" aria-hidden="true" />
              <span class="block-type-label">{{ t('{0} 级标题', [index + 1]) }}</span>
              <Check v-if="context.block === 'Heading' && context.headingLevel === index + 1" :size="14" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          v-if="context.block === 'Heading' && !compact"
          class="heading-levels"
          :aria-label="t('标题级别')"
        >
          <button
            v-for="level in 4"
            :key="level"
            type="button"
            :aria-label="t('{0} 级标题', [level])"
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
              { name: 'heading', label: t('标题'), icon: Heading2 },
              { name: 'list', label: t('无序列表'), icon: List },
              { name: 'todo-list', label: t('待办列表'), icon: ListTodo },
              { name: 'quote', label: t('引用'), icon: Quote },
            ]"
            :key="item.name"
            type="button"
            class="icon-button block-shortcut"
            :aria-label="item.label"
            :data-tooltip="item.label"
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
            <span v-if="compact && primaryInline.length" class="toolbar-divider toolbar-group-divider" aria-hidden="true" />
            <button
              v-for="item in primaryInline"
              :key="item.type"
              type="button"
              class="icon-button"
              :class="{ active: context.activeInline.includes(item.type) }"
              :aria-label="item.label"
              :data-tooltip="item.label"
              :data-tooltip-shortcut="formattingShortcuts[item.command]"
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
        :inline-math="compact && commandEnabled('math', enabledLevels, features)"
        :text-color="context.textColor"
        :background-color="context.backgroundColor"
        :dragging="dragging"
        :hide-formats="context.level !== 'inline'"
        :disabled="disabled || (context.level === 'inline' && (!context.canStyleText || context.inlineSource))"
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
        :aria-label="t('引用对象或文档')"
        :data-tooltip="t('@ 引用对象或文档 · Level 2')"
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
        :aria-label="t('提及文档')"
        :data-tooltip="t('提及文档或附件 · Level 1')"
        :disabled="disabled"
        @mousedown.prevent
        @click="run('mention')"
      >
        <AtSign :size="17" />
      </button>
      <select
        v-if="!compact && context.block === 'Callout'"
        :aria-label="t('提示块类型')"
        :disabled="disabled || !commandEnabled('callout', enabledLevels, features)"
        @change="run('callout', ($event.target as HTMLSelectElement).value)"
      >
        <option disabled selected value="">{{ t('提示类型') }}</option>
        <option value="NOTE">{{ t('备注') }}</option>
        <option value="TIP">{{ t('提示') }}</option>
        <option value="IMPORTANT">{{ t('重要') }}</option>
        <option value="WARNING">{{ t('警告') }}</option>
        <option value="CAUTION">{{ t('注意') }}</option>
        <option value="CUSTOM">{{ t('自定义块') }}</option>
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
            {{ form === 'link' && !value.trim() ? t('移除链接') : t('应用') }}</button
          ><button type="button" class="icon-button" :aria-label="t('取消')" @click="escape">
            <X :size="16" />
          </button>
        </div>
      </form>
    </template>
    <slot name="trailing" />
    <span v-if="(annotation && !source) || assistant || todo" class="toolbar-divider toolbar-group-divider" aria-hidden="true" />
    <button v-if="todo && !source" type="button" class="icon-button" :aria-label="t('从选区创建 Todo')" :data-tooltip="t('从选区创建 Todo')" :disabled="disabled || !context.textSelected" @mousedown.prevent @click="emit('todo')"><ListTodo :size="17" /></button>
    <button
      v-if="annotation && !source"
      type="button"
      class="icon-button annotation-create-button"
      :aria-label="t('添加局部批注')"
      :data-tooltip="t('批注所选文字或当前块')"
      :disabled="disabled"
      @mousedown.prevent
      @click="emit('annotation')"
    ><MessageSquare :size="17" /></button>
    <button
      v-if="assistant"
      type="button"
      class="icon-button"
      :aria-label="t('打开 Tano 助手')"
      :data-tooltip="assistantDisabled ? t('助手正在处理中') : t('与助手讨论')"
      :disabled="disabled || assistantDisabled"
      @mousedown.prevent
      @click="emit('assistant')"
    ><Bot :size="16" /></button>
  </div>
</template>

<style scoped>
.contextual-toolbar {
  --editor-tool-radius: 5px;
  position: relative;
  justify-content: flex-start;
}
.contextual-toolbar.editor-toolbar {
  /* The generic contextual toolbar rule must not cancel the fixed toolbar's
     sticky positioning when the docking mode switches to the top edge. */
  position: sticky;
  top: 0;
  z-index: 3;
}
.contextual-toolbar :deep(.icon-button:not(.toolbar-drag-handle)) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  padding: 0;
  border-radius: var(--editor-tool-radius);
  color: var(--text-secondary);
  background: transparent;
}
.contextual-toolbar :deep(.icon-button:not(.toolbar-drag-handle) > svg) {
  width: 17px;
  height: 17px;
}
.contextual-toolbar :deep(.icon-button:not(.toolbar-drag-handle):is(:hover, :focus-visible):not(:disabled)) {
  background: var(--hover);
  color: var(--text);
}
.contextual-toolbar :deep(.icon-button:not(.toolbar-drag-handle):focus-visible) {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.contextual-toolbar :deep(.icon-button:not(.toolbar-drag-handle)[aria-pressed='true']) {
  color: var(--green);
  background: var(--accent);
}
.contextual-toolbar .toolbar-group-divider {
  display: block;
  flex-shrink: 0;
  align-self: center;
  width: 1px;
  height: 20px;
  margin: 0 3px;
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-group-divider {
  width: 22px;
  height: 1px;
  margin: 3px 0;
}
.selection-format-toolbar {
  --editor-tool-radius: 50%;
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
.selection-format-toolbar :deep(.block-type-menu) {
  width: min(248px, var(--selection-toolbar-width, 300px));
}
.selection-format-toolbar :deep(.text-style-dropdown) {
  width: min(var(--text-style-menu-width), var(--selection-toolbar-width, 300px));
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
.block-type-menu > button,
.heading-submenu > button {
  justify-content: flex-start;
  min-height: 30px;
  padding: 6px 9px;
  gap: 10px;
}
.block-type-menu .block-type-icon,
.heading-submenu .block-type-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.block-type-label {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.block-type-menu > button > svg:last-child:not(.block-type-icon),
.heading-submenu > button > svg:last-child:not(.block-type-icon) {
  flex-shrink: 0;
  margin-left: auto;
}
.heading-submenu {
  position: absolute;
  z-index: 31;
  width: 168px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: var(--paper);
}
.heading-submenu > button {
  display: flex;
  align-items: center;
  width: 100%;
}
.heading-submenu > button:hover {
  background: var(--hover);
}
.block-type-menu small {
  margin-left: 8px;
  color: var(--muted);
  font-size: 10px;
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
  .toolbar-input-panel {
    left: 12px;
  }
}
</style>
