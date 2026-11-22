<script setup lang="ts">
import ShortcutHint from '@tano/editor/shortcut-hint';
import { ChevronRight } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n';
import { shortcutLabel } from '../shortcuts';
import type { WorkbenchCommand } from '../command-palette';
import { useWindowContext } from '../windows/context';
import { useWorkspaceStore } from '../stores/workspace';
const { window, document } = useWindowContext();
const store = useWorkspaceStore();

/**
 * Self-drawn application menu opened from the sidebar brand icon. It owns no
 * behavior: every entry resolves to a workbench command, so the menu, command
 * palette and keyboard shortcuts stay a single code path.
 */
const props = defineProps<{
  commands: WorkbenchCommand[];
  anchor: HTMLElement | null;
  /** Native window only: adds "close window" to the file menu. */
  closeWindow?: () => unknown;
  openPalette: () => unknown;
  /** Already-formatted shortcut label for the command palette entry. */
  paletteHint?: string;
}>();
const emit = defineEmits<{ close: [] }>();

interface Entry {
  key: string;
  label: string;
  hint?: string;
  disabled: boolean;
  /** Non-interactive section title. */
  heading?: boolean;
  run: () => unknown;
}
type Row = Entry | 'divider';
interface Group { id: string; label: string; rows: Row[] }

const byId = computed(() => new Map(props.commands.map(command => [command.id, command])));

function entry(id: string): Entry | null {
  const command = byId.value.get(id);
  if (!command) return null; // Not offered in this context (e.g. plugin disabled).
  return { key: id, label: command.label, hint: command.shortcut ? shortcutLabel(command.shortcut) : '', disabled: command.available === false, run: command.run };
}
/** `null` and missing commands vanish; consecutive/edge dividers are collapsed. */
function rows(items: (string | null | Entry)[]): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    const row = item === null ? 'divider' : typeof item === 'string' ? entry(item) : item;
    if (!row) continue;
    if (row === 'divider' && (!out.length || out[out.length - 1] === 'divider')) continue;
    out.push(row);
  }
  while (out[out.length - 1] === 'divider') out.pop();
  return out;
}

const recentRows = computed<Entry[]>(() => {
  const items = store.recent.filter(item => item.id !== store.workspace?.id).slice(0, 5);
  if (!items.length) return [];
  return [
    { key: 'recent-heading', label: t('最近工作空间'), heading: true, disabled: true, run: () => {} },
    ...items.map(item => ({ key: `recent:${item.id}`, label: item.name, disabled: false, run: () => store.openWorkspace(item.path) })),
  ];
});

const groups = computed<Group[]>(() => [
  {
    id: 'file', label: t('文件'),
    rows: rows([
      'workbench.new', 'workbench.folder', 'workbench.new-window', null,
      'workbench.open', 'workbench.open-folder', null,
      ...recentRows.value, null,
      'workbench.save', 'workbench.saveAs', null,
      ...['markdown', 'docx', 'pdf', 'html', 'png'].map(format => `workbench.export.${format}`), 'workbench.print',
      ...(props.closeWindow
        ? [null, { key: 'window.close', label: t('关闭窗口'), disabled: false, run: props.closeWindow } as Entry]
        : []),
    ]),
  },
  // Mirrors a conventional Edit menu: history and search only. Formatting, insertion and other
  // body-editing commands stay in the editor, palette and shortcuts.
  {
    id: 'edit', label: t('编辑'),
    rows: rows(['workbench.undo', 'workbench.redo', null, 'workbench.find', 'workbench.replace']),
  },
  // Like VS Code's View menu: palette and search, which panels are shown, then how the page is displayed.
  {
    id: 'view', label: t('视图'),
    rows: rows([
      { key: 'palette', label: t('命令中心'), hint: props.paletteHint, disabled: false, run: props.openPalette },
      'workbench.search', null,
      'workbench.sidebar', 'workbench.assistant', null,
      'workbench.repository', 'workbench.plan', 'workbench.calendar', 'workbench.graph', 'workbench.plugins', null,
      'workbench.outline', 'workbench.properties', 'workbench.width', 'workbench.reading',
    ]),
  },
  {
    id: 'workspace', label: t('工作区'),
    // Workspace-wide actions only; plugin-provided commands deliberately stay in the command palette.
    rows: rows([
      'workbench.home', 'workbench.switch-workspace', null,
      'workbench.import', 'workbench.templates', null,
      'workbench.reveal', 'workbench.settings.workspace',
    ]),
  },
  {
    id: 'help', label: t('帮助'),
    rows: rows([
      'workbench.settings', 'workbench.settings.editing', 'workbench.settings.shortcuts', null,
      'workbench.settings.about', 'workbench.check-updates',
    ]),
  },
].filter(group => group.rows.length));

const root = ref<HTMLElement>();
// Nothing is expanded on open; a group opens on hover, click or keyboard focus.
const openGroup = ref<string | null>(null);
const position = ref({ top: 0, left: 0 });
const current = computed(() => groups.value.find(group => group.id === openGroup.value));

function place() {
  const rect = props.anchor?.getBoundingClientRect();
  if (rect) position.value = { top: rect.bottom + 6, left: Math.max(8, rect.left - 2) };
}
function activate(row: Entry) {
  if (row.disabled) return;
  emit('close');
  void Promise.resolve().then(row.run).catch(store.report);
}
function outside(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target || root.value?.contains(target) || props.anchor?.contains(target)) return;
  emit('close');
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); props.anchor?.focus(); return; }
  const buttons = [...(root.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const group = groups.value.findIndex(item => item.id === openGroup.value);
  const inSub = !!(document.activeElement as HTMLElement | null)?.closest('.app-menu-sub');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const scope = buttons.filter(button => !!button.closest('.app-menu-sub') === inSub);
    const at = scope.indexOf(document.activeElement as HTMLButtonElement);
    scope[(at + scope.length + (event.key === 'ArrowDown' ? 1 : -1)) % scope.length]?.focus();
  } else if (event.key === 'ArrowRight' && !inSub) {
    event.preventDefault();
    void nextTick(() => root.value?.querySelector<HTMLButtonElement>('.app-menu-sub button:not(:disabled)')?.focus());
  } else if (event.key === 'ArrowLeft' && inSub) {
    event.preventDefault();
    root.value?.querySelector<HTMLButtonElement>(`.app-menu-root button[data-group="${groups.value[group]?.id}"]`)?.focus();
  } else if (index < 0 && event.key === 'ArrowDown') buttons[0]?.focus();
}

onMounted(() => {
  place();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', place);
  // Focus the container, not an item, so keyboard users can start with ArrowDown without opening a group.
  void nextTick(() => root.value?.focus());
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <div ref="root" class="app-menu" role="menu" tabindex="-1":aria-label="t('同页')" :style="{ top: `${position.top}px`, left: `${position.left}px` }" @keydown="keydown">
    <div class="app-menu-root">
      <button
        v-for="group in groups" :key="group.id" type="button" role="menuitem" aria-haspopup="menu"
        :data-group="group.id" :aria-expanded="openGroup === group.id" :class="{ active: openGroup === group.id }"
        @pointerenter="openGroup = group.id" @focus="openGroup = group.id" @click="openGroup = group.id"
      >
        <span>{{ group.label }}</span><ChevronRight :size="13" aria-hidden="true" />
      </button>
    </div>
    <div v-if="current" :key="current.id" class="app-menu-sub" role="menu" :aria-label="current.label">
      <template v-for="(row, index) in current.rows" :key="typeof row === 'string' ? `d${index}` : row.key">
        <div v-if="row === 'divider'" class="app-menu-divider" role="separator" />
        <div v-else-if="row.heading" class="app-menu-heading" role="presentation">{{ row.label }}</div>
        <button v-else type="button" role="menuitem" :disabled="row.disabled" @click="activate(row)">
          <span class="app-menu-label">{{ row.label }}</span>
          <kbd v-if="row.hint" class="app-menu-shortcut"><ShortcutHint :label="row.hint" /></kbd>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.app-menu:focus { outline: none; }
.app-menu {
  position: fixed;
  z-index: 130; /* Above the sidebar and other floating menus (100–120). */
  display: flex;
  align-items: flex-start;
  gap: 4px;
  color: var(--text);
  font-size: 12px;
}
.app-menu-root,
.app-menu-sub {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px #1b23311f, 0 18px 40px #1b233114;
}
.app-menu-root { width: 112px; }
.app-menu-sub { min-width: 220px; max-height: calc(100dvh - 72px); overflow-y: auto; }
.app-menu button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
  line-height: 16px;
}
.app-menu-root button { justify-content: space-between; color: var(--text-secondary); }
.app-menu button:hover:not(:disabled),
.app-menu button:focus-visible,
.app-menu-root button.active { background: var(--hover); outline: none; }
.app-menu-root button.active { color: var(--text); }
.app-menu button:disabled { color: var(--muted); opacity: .55; cursor: default; }
.app-menu-label { flex: 1; min-width: 0; }
.app-menu-shortcut { flex: none; margin-left: auto; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 11px; }
.app-menu-heading { padding: 4px 8px 2px; color: var(--muted); font-size: 11px; line-height: 16px; }
.app-menu-divider { height: 0; margin: 3px -6px; border-top: 1px solid var(--line); }
@media (max-width: 480px) {
  .app-menu { flex-direction: column; }
  .app-menu-root { width: auto; flex-direction: row; }
  .app-menu-sub { min-width: 0; width: calc(100vw - 24px); }
}
</style>
