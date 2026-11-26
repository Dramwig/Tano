<script setup lang="ts">
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  ChevronRight,
  ClipboardCopy,
  Columns2,
  CopyPlus,
  Group,
  Heading,
  IndentDecrease,
  IndentIncrease,
  Info,
  List,
  ListCollapse,
  PanelsTopLeft,
  Pilcrow,
  Quote,
  Replace,
  RotateCcw,
  Sigma,
  SquareCode,
  Table2,
  Trash2,
  Ungroup,
} from 'lucide-vue-next';
import type { Node } from '@milkdown/kit/prose/model';
import { useEditorWindow } from '../primitives/dom-context';
import { vSurfaceMotion } from '../primitives/surface-motion';
import ShortcutHint from '../primitives/ShortcutHint.vue';
import WechatLogo from '../clipboard-icons/wechat.vue';
import ZhihuLogo from '../clipboard-icons/zhihu.vue';
import { blockContainerOptions } from '../plugins/block-menu-structure';
import type { SlashTranslate } from '../plugins/slash-commands';
import type { BlockMenuState, BlockSubmenuKind } from '../plugins/block-menu-controller';

const props = defineProps<{
  menu: BlockMenuState | null;
  submenu: { x: number; y: number } | null;
  submenuKind: BlockSubmenuKind;
  selectionCount: number;
  menuTable: Node | null;
  defaultCopyAction: string;
  copyShortcutLabel: string;
  specialCopyFormats: { mathml: boolean; tsv: boolean };
  shortcutHints?: Record<string, string>;
  translate?: SlashTranslate;
  commandAvailable: (name: string) => boolean;
  moveAvailable: (action: string) => boolean;
  setMenuElement: (el: HTMLElement | undefined) => void;
  setConvertElement: (el: HTMLElement | undefined) => void;
  setCopyTrigger: (el: HTMLButtonElement | undefined) => void;
  setConvertTrigger: (el: HTMLButtonElement | undefined) => void;
  setWrapTrigger: (el: HTMLButtonElement | undefined) => void;
}>();

const emit = defineEmits<{
  action: [action: string];
  keydown: [event: KeyboardEvent];
  'open-submenu': [focusMenu: boolean, kind: BlockSubmenuKind];
  'schedule-close-submenu': [];
}>();

const document = useEditorWindow().document;
const blockContainerIcons = {
  quote: Quote,
  callout: Info,
  toggle: ListCollapse,
  tabs: PanelsTopLeft,
  columns: Columns2,
};

const t: SlashTranslate = (message, values = []) =>
  props.translate?.(message, values) ??
  message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token,
  );
</script>

<template>
  <Teleport :to="document.body">
    <div
      v-if="menu"
      v-surface-motion="'MarkdownEditor:2'"
      :ref="(el) => setMenuElement((el as HTMLElement | null) ?? undefined)"
      class="dropdown compact-action-menu block-context-menu"
      data-surface-role="popover"
      role="menu"
      tabindex="-1"
      :aria-label="menu.selectionMenu ? t('选区操作') : selectionCount > 1 ? t('{0} 个块的操作', [selectionCount]) : t('第 {0} 个块的操作', [menu.index + 1])"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @keydown="emit('keydown', $event)"
    >
      <div
        class="block-convert-menu"
        role="presentation"
        @pointerenter="emit('open-submenu', false, 'copy')"
        @pointerleave="emit('schedule-close-submenu')"
      >
        <button
          :ref="(el) => setCopyTrigger((el as HTMLButtonElement | null) ?? undefined)"
          role="menuitem"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="!!submenu && submenuKind === 'copy'"
          @click="emit('open-submenu', true, 'copy')"
        >
          <ClipboardCopy :size="15" aria-hidden="true" />{{ t('复制为') }}<ChevronRight class="block-convert-chevron" :size="15" aria-hidden="true" />
        </button>
        <div
          v-if="submenu && submenuKind === 'copy'"
          v-surface-motion="'MarkdownEditor:3'"
          :ref="(el) => setConvertElement((el as HTMLElement | null) ?? undefined)"
          class="dropdown compact-action-menu block-convert-submenu"
          data-surface-role="popover"
          role="menu"
          tabindex="-1"
          :aria-label="t('复制为')"
          :style="{ left: `${submenu.x}px`, top: `${submenu.y}px` }"
        >
          <button role="menuitem" type="button" @click="emit('action', 'copy')">
            <ClipboardCopy :size="15" aria-hidden="true" />{{ t('复制 Markdown') }}<kbd v-if="defaultCopyAction === 'copy'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
          <button role="menuitem" type="button" :title="t('在 Word / WPS 中粘贴后选择“保留源格式”，以保留颜色、底色和字体')" @click="emit('action', 'copy-rich')">
            <Pilcrow :size="15" aria-hidden="true" />{{ t('复制富文本（Word / WPS）') }}<kbd v-if="defaultCopyAction === 'copy-rich'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
          <button role="menuitem" type="button" :title="t('复制 HTML 源码')" @click="emit('action', 'copy-html')">
            <Braces :size="15" aria-hidden="true" />{{ t('复制 HTML') }}<kbd v-if="defaultCopyAction === 'copy-html'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
          <button role="menuitem" type="button" @click="emit('action', 'copy-text')">
            <AlignLeft :size="15" aria-hidden="true" />{{ t('复制纯文本') }}<kbd v-if="defaultCopyAction === 'copy-text'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
          <div v-if="specialCopyFormats.mathml || specialCopyFormats.tsv" class="menu-divider" role="separator" />
          <button v-if="specialCopyFormats.mathml" role="menuitem" type="button" @click="emit('action', 'copy-mathml')">
            <Sigma :size="15" aria-hidden="true" />{{ t('复制公式 MathML') }}
          </button>
          <button v-if="specialCopyFormats.tsv" role="menuitem" type="button" @click="emit('action', 'copy-tsv')">
            <Table2 :size="15" aria-hidden="true" />{{ t('复制表格 TSV') }}
          </button>
          <div class="menu-divider" role="separator" />
          <button role="menuitem" type="button" :title="t('内联排版样式，外链转为可见地址；公式本地渲染为 SVG')" @click="emit('action', 'copy-wechat')">
            <WechatLogo />{{ t('复制到微信公众号') }}<kbd v-if="defaultCopyAction === 'copy-wechat'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
          <button role="menuitem" type="button" :title="t('保留链接，公式使用知乎编辑器的识别标记')" @click="emit('action', 'copy-zhihu')">
            <ZhihuLogo />{{ t('复制到知乎') }}<kbd v-if="defaultCopyAction === 'copy-zhihu'" class="menu-shortcut" aria-hidden="true">{{ copyShortcutLabel }}</kbd>
          </button>
        </div>
      </div>
      <template v-if="!menu.selectionMenu">
        <button role="menuitem" type="button" :title="t('编辑所选块的 Markdown 源码')" @click="emit('action', 'source')">
          <SquareCode :size="15" aria-hidden="true" />{{ t('编辑源码') }}
        </button>
        <button role="menuitem" type="button" @click="emit('action', 'duplicate')">
          <CopyPlus :size="15" aria-hidden="true" />{{ t('创建副本') }}
        </button>
        <button
          v-if="menuTable"
          role="menuitem"
          type="button"
          :disabled="!!menuTable.attrs.autoWidth"
          :title="menuTable.attrs.autoWidth ? t('整张表已使用自动宽度') : t('恢复整张表的自动宽度')"
          @click="emit('action', 'restoreAutoWidth')"
        >
          <RotateCcw :size="15" aria-hidden="true" />{{ t('恢复自动宽度') }}<Check v-if="menuTable.attrs.autoWidth" class="block-convert-chevron" :size="15" aria-hidden="true" />
        </button>
        <div class="menu-divider" role="separator" />
        <div
          class="block-convert-menu"
          role="presentation"
          @pointerenter="emit('open-submenu', false, 'convert')"
          @pointerleave="emit('schedule-close-submenu')"
        >
          <button
            :ref="(el) => setConvertTrigger((el as HTMLButtonElement | null) ?? undefined)"
            role="menuitem"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="!!submenu && submenuKind === 'convert'"
            @click="emit('open-submenu', true, 'convert')"
          >
            <Replace :size="15" aria-hidden="true" />{{ t('转换为') }}<ChevronRight class="block-convert-chevron" :size="15" aria-hidden="true" />
          </button>
          <div
            v-if="submenu && submenuKind === 'convert'"
            v-surface-motion="'MarkdownEditor:4'"
            :ref="(el) => setConvertElement((el as HTMLElement | null) ?? undefined)"
            class="dropdown compact-action-menu block-convert-submenu"
            data-surface-role="popover"
            role="menu"
            tabindex="-1"
            :aria-label="t('转换为')"
            :style="{ left: `${submenu.x}px`, top: `${submenu.y}px` }"
          >
            <button role="menuitem" type="button" :disabled="!commandAvailable('paragraph')" @click="emit('action', 'paragraph')">
              <Pilcrow :size="15" aria-hidden="true" />{{ t('转为正文') }}
            </button>
            <button role="menuitem" type="button" :disabled="!commandAvailable('heading')" @click="emit('action', 'heading')">
              <Heading :size="15" aria-hidden="true" />{{ t('转为标题') }}
            </button>
            <button role="menuitem" type="button" :disabled="!commandAvailable('list')" @click="emit('action', 'list')">
              <List :size="15" aria-hidden="true" />{{ t('转为列表') }}
            </button>
            <button role="menuitem" type="button" :disabled="!commandAvailable('quote')" @click="emit('action', 'quote')">
              <Quote :size="15" aria-hidden="true" />{{ t('转为引用') }}
            </button>
          </div>
        </div>
        <div
          class="block-convert-menu"
          role="presentation"
          @pointerenter="emit('open-submenu', false, 'wrap')"
          @pointerleave="emit('schedule-close-submenu')"
        >
          <button
            :ref="(el) => setWrapTrigger((el as HTMLButtonElement | null) ?? undefined)"
            role="menuitem"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="!!submenu && submenuKind === 'wrap'"
            @click="emit('open-submenu', true, 'wrap')"
          >
            <Group :size="15" aria-hidden="true" />{{ t('合并放入新块') }}<ChevronRight class="block-convert-chevron" :size="15" aria-hidden="true" />
          </button>
          <div
            v-if="submenu && submenuKind === 'wrap'"
            v-surface-motion="'MarkdownEditor:5'"
            :ref="(el) => setConvertElement((el as HTMLElement | null) ?? undefined)"
            class="dropdown compact-action-menu block-convert-submenu"
            data-surface-role="popover"
            role="menu"
            tabindex="-1"
            :aria-label="t('合并放入新块')"
            :style="{ left: `${submenu.x}px`, top: `${submenu.y}px` }"
          >
            <button
              v-for="option in blockContainerOptions"
              :key="option.type"
              role="menuitem"
              type="button"
              :disabled="!commandAvailable('wrap-' + option.type)"
              @click="emit('action', 'wrap-' + option.type)"
            >
              <component :is="blockContainerIcons[option.type]" :size="16" aria-hidden="true" />{{ t(option.label) }}
            </button>
          </div>
        </div>
        <button role="menuitem" type="button" :disabled="!commandAvailable('unwrap')" :title="t('移除外层块，将内部子块提升一级')" @click="emit('action', 'unwrap')">
          <Ungroup :size="15" aria-hidden="true" />{{ t('展开') }}
        </button>
        <div class="menu-divider" role="separator" />
        <button role="menuitem" type="button" :disabled="!moveAvailable('move-up')" @click="emit('action', 'move-up')">
          <ArrowUp :size="15" aria-hidden="true" />{{ t('上移块') }}<kbd class="menu-shortcut" aria-hidden="true">{{ shortcutHints?.['move-up'] ?? 'Alt + ↑' }}</kbd>
        </button>
        <button role="menuitem" type="button" :disabled="!moveAvailable('move-down')" @click="emit('action', 'move-down')">
          <ArrowDown :size="15" aria-hidden="true" />{{ t('下移块') }}<kbd class="menu-shortcut" aria-hidden="true">{{ shortcutHints?.['move-down'] ?? 'Alt + ↓' }}</kbd>
        </button>
        <button role="menuitem" type="button" :disabled="!moveAvailable('indent')" @click="emit('action', 'indent')">
          <IndentIncrease :size="15" aria-hidden="true" />{{ t('移入前容器') }}<kbd class="menu-shortcut" aria-hidden="true">{{ shortcutHints?.['indent'] ?? 'Alt + →' }}</kbd>
        </button>
        <button role="menuitem" type="button" :disabled="!moveAvailable('outdent')" @click="emit('action', 'outdent')">
          <IndentDecrease :size="15" aria-hidden="true" />{{ t('移出当前容器') }}<kbd class="menu-shortcut" aria-hidden="true">{{ shortcutHints?.['outdent'] ?? 'Alt + ←' }}</kbd>
        </button>
        <div class="menu-divider" role="separator" />
        <button role="menuitem" type="button" class="danger-text" @click="emit('action', 'delete')">
          <Trash2 :size="15" aria-hidden="true" />{{ t('删除块') }}<kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHints?.['delete'] ?? 'Backspace'" /></kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>
