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
}>();
const emit = defineEmits<{ command: [name: string, value?: string] }>();
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
watch(() => [props.context.level, props.context.block, props.disabled, props.source], close);
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
  close();
  trigger.value?.focus();
}
</script>

<template>
  <div
    ref="root"
    class="editor-toolbar contextual-toolbar"
    :data-selection-level="source ? 'source' : context.level"
    role="toolbar"
    :aria-label="
      source ? 'Markdown 源码' : context.level === 'block' ? '块级编辑工具' : '行内文字工具'
    "
    @keydown.esc.stop.prevent="escape"
  >
    <template v-if="source"><span class="document-type">Markdown 源码</span></template>
    <template v-else>
      <span class="selection-level"
        >{{ context.level === 'block' ? '块级' : '文字'
        }}<small>{{ context.level === 'block' ? 'Block' : 'Text' }}</small></span
      >
      <span class="toolbar-divider" />
      <div v-if="context.level === 'block'" class="format-actions">
        <div class="menu-wrap">
          <button
            ref="trigger"
            type="button"
            class="block-type-trigger"
            aria-label="块级类型"
            :aria-expanded="open"
            :disabled="disabled"
            @mousedown.prevent
            @click="
              open = !open;
              form = null;
            "
          >
            {{ blockLabel }}<small>Level {{ featureLevel(context.block) }}</small
            ><ChevronDown :size="13" />
          </button>
          <div
            v-if="open && !disabled"
            class="dropdown block-type-menu"
            aria-label="Block Level 选项"
          >
            <div class="toolbar-menu-label">块类型 · ＋ 插入新块</div>
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
                >{{ item.label }}<small>{{ item.type }} · Level {{ item.level }}</small></span
              ><Plus v-if="insertionCommands.has(item.command)" :size="13" />
            </button>
          </div>
        </div>
        <div v-if="context.block === 'Heading'" class="heading-levels" aria-label="标题级别">
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
        <template v-else>
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
      <div v-else class="format-actions inline-actions">
        <button
          v-for="item in availableInline"
          :key="item.type"
          type="button"
          class="icon-button"
          :class="{ active: context.activeInline.includes(item.type) }"
          :aria-label="item.label"
          :title="`${item.label} · ${item.type} · Level ${item.level}`"
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
        <TextStyleMenu
          :disabled="disabled || !context.canStyleText || context.inlineSource"
          @format="(name, color) => emit('command', name, color)"
        />
      </div>
      <button v-if="context.level === 'block' && commandEnabled('reference', enabledLevels, features)" type="button" class="icon-button" aria-label="引用对象或文档" title="@ 引用对象或文档 · Level 2" :disabled="disabled" @mousedown.prevent @click="run('reference')"><AtSign :size="17" /></button>
      <button
        v-if="context.level === 'block' && commandEnabled('mention', enabledLevels, features)"
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
        v-if="context.block === 'Callout'"
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
  </div>
</template>

<style scoped>
.contextual-toolbar {
  justify-content: flex-start;
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
