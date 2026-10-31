<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Copy, Eraser, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import DocumentReader from './DocumentReader.vue';
import DocumentStatus from './DocumentStatus.vue';
import type { AttachmentStatusUpdate } from '../attachment-status';
import { t } from '../i18n';
import { officeDefaultColumnWidth, officeLimits, type OfficeSheet } from '../office-preview/model';
import type { SheetEdit } from '../office-preview/edit';
import { draft, serializeWorkbook } from '../office-preview/draft';
import { readOffice } from '../office-preview/client';

const props = defineProps<{ bytes: Uint8Array; path: string; sheets: OfficeSheet[]; controlsTarget?: string; draftKey?: string; statusManaged?: boolean;
  save?: (bytes: Uint8Array, expected: string) => Promise<string>; readLatest?: () => Promise<Uint8Array> }>();
const emit = defineEmits<{ status: [update: AttachmentStatusUpdate] }>();
const statusSource = useId();
const sheets = ref<OfficeSheet[]>(structuredClone(props.sheets)), selected = ref(0), busy = ref(false), saving = ref(false), failure = ref('');
const edits = ref<SheetEdit[]>([]), base = ref(props.bytes), ready = ref(!props.save), editing = ref<{ row: number; column: number; value: string }>();
const fileStatus = computed<NonNullable<AttachmentStatusUpdate['state']>>(() => ({
  items: [failure.value ? { kind: 'error', label: t('操作失败'), detail: failure.value }
    : saving.value ? { kind: 'saving', label: t('保存中'), detail: t('正在保存当前修改。') }
    : edits.value.length ? { kind: 'updated', label: t('待保存'), detail: t('修改已保留在本地，稍后自动保存。') }
    : props.save ? { kind: 'saved', label: t('已保存'), detail: t('更改已保存到原文件。') }
    : { kind: 'preview', label: t('只读预览'), detail: t('附件以只读方式打开，不会修改原文件。') }],
  retry: failure.value ? saveFile : undefined,
  retryDisabled: busy.value || saving.value,
}));
watch(fileStatus, state => emit('status', { source: statusSource, documentKey: props.draftKey ?? props.path, state }), { immediate: true });
const table = ref<HTMLTableElement>(), tabs = ref<HTMLElement>();
const selection = ref<{ axis: 'row' | 'column'; index: number }>();
const menu = ref<{ x: number; y: number; sheet?: string; positioned: boolean }>(), menuElement = ref<HTMLElement>();
const rename = ref<{ sheet: string; name: string }>(), renameInput = ref<HTMLInputElement>();
const canCopySheet = computed(() => {
  const target = sheets.value.find(item => item.name === menu.value?.sheet);
  return !!target && sheets.value.length < officeLimits.sheets && totalCells.value + Math.max(1, target.rows.length) * target.columns <= officeLimits.cells;
});
let menuTrigger: HTMLElement | undefined;
function closeMenu(restore = false) { menu.value = undefined; if (restore) menuTrigger?.focus(); }
function outsideMenu(event: PointerEvent) { if (!menuElement.value?.contains(event.target as Node)) closeMenu(); }
async function selectAxis(axis: 'row' | 'column', index: number) {
  if (busy.value || (editing.value && !await finishCell())) return false;
  selection.value = { axis, index }; closeMenu(); return true;
}
async function openMenu(event: MouseEvent | KeyboardEvent, axis: 'row' | 'column', index: number) {
  const trigger = event.currentTarget as HTMLElement;
  if (!await selectAxis(axis, index)) return;
  await showMenu(event, trigger);
}
async function openSheetMenu(event: MouseEvent | KeyboardEvent, name: string) {
  const trigger = event.currentTarget as HTMLElement;
  if (busy.value || (editing.value && !await finishCell())) return;
  selection.value = undefined;
  await showMenu(event, trigger, name);
}
async function showMenu(event: MouseEvent | KeyboardEvent, trigger: HTMLElement, name?: string) {
  menuTrigger = trigger.matches('button, td') ? trigger : trigger.querySelector<HTMLElement>('.axis-selector') ?? trigger;
  const rect = trigger.getBoundingClientRect();
  const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
  const x = name || !pointer ? rect.left : event.clientX;
  const y = pointer ? event.clientY : rect.bottom;
  menu.value = { x: 0, y: 0, sheet: name, positioned: false };
  const opened = menu.value;
  await nextTick();
  if (menu.value !== opened || !menuElement.value) return;
  const size = menuElement.value.getBoundingClientRect();
  // Bottom tabs anchor above the tab, while cell menus follow the pointer.
  const top = name
    ? (rect.top - size.height - 4 >= 8 ? rect.top - size.height - 4 : rect.bottom + 4)
    : (y + size.height <= window.innerHeight - 8 ? y : y - size.height);
  opened.x = Math.max(8, Math.min(x, window.innerWidth - size.width - 8));
  opened.y = Math.max(8, Math.min(top, window.innerHeight - size.height - 8));
  opened.positioned = true;
  await nextTick();
  if (menu.value === opened) (menuElement.value?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menuElement.value)?.focus({ preventScroll: true });
}
async function beginRename() {
  const name = menu.value?.sheet; if (!name || !writable.value || busy.value) return;
  rename.value = { sheet: name, name }; closeMenu();
  await nextTick(); renameInput.value?.focus(); renameInput.value?.select();
}
function cancelRename() { rename.value = undefined; menuTrigger?.focus(); }
async function sheetAction(kind: 'rename-sheet' | 'copy-sheet' | 'delete-sheet') {
  const name = kind === 'rename-sheet' ? rename.value?.sheet : menu.value?.sheet;
  if (!name || !writable.value || busy.value) return;
  let edit: SheetEdit;
  if (kind === 'rename-sheet') {
    const next = rename.value!.name.trim();
    if (next === name) { cancelRename(); return; }
    edit = { kind, sheet: name, name: next };
  } else if (kind === 'copy-sheet') {
    if (!canCopySheet.value) return;
    let number = 1, next: string;
    do { const suffix = ` (${number++})`; next = name.slice(0, 31 - suffix.length) + suffix; }
    while (sheets.value.some(item => item.name.toLowerCase() === next.toLowerCase()));
    edit = { kind, sheet: name, name: next };
  } else { if (sheets.value.length <= 1) return; edit = { kind, sheet: name }; }
  busy.value = true;
  try { await serializeWorkbook(Uint8Array.from(base.value), filePath, [...JSON.parse(JSON.stringify(edits.value)), edit]); }
  catch (error) { failure.value = String(error); closeMenu(true); return; }
  finally { busy.value = false; }
  if (await commit(edit)) {
    rename.value = undefined; selection.value = undefined; closeMenu();
    if (edit.kind === 'copy-sheet') selected.value = sheets.value.findIndex(item => item.name === edit.name);
    await nextTick(); tabs.value?.querySelectorAll<HTMLButtonElement>('[role=tab]')[selected.value]?.focus();
  }
}
async function copySelection() {
  const target = selection.value; if (!target) return;
  const values = target.axis === 'row' ? [rows.value[target.index]] : rows.value.map(row => [row[target.index] ?? '']);
  const escape = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  try { await navigator.clipboard.writeText(values.map(row => row.map(escape).join('\t')).join('\r\n')); closeMenu(true); }
  catch { failure.value = t('无法复制到剪贴板，请检查剪贴板权限'); }
}
async function changeSelection(kind: 'clear' | 'delete') {
  if (!selection.value || !writable.value || busy.value) return;
  const edit: SheetEdit = { kind, sheet: sheet.value.name, ...selection.value };
  {
    busy.value = true;
    try { await serializeWorkbook(Uint8Array.from(base.value), filePath, [...JSON.parse(JSON.stringify(edits.value)), edit]); }
    catch (error) { failure.value = String(error); closeMenu(true); return; }
    finally { busy.value = false; }
  }
  if (await commit(edit)) { closeMenu(true); if (kind === 'delete') selection.value = undefined; }
}
function selectionKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('input, [role=menu]') || !selection.value) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelection(); }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void changeSelection('clear'); }
  if (event.key === 'Escape') { closeMenu(true); selection.value = undefined; }
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
}
const sheet = computed(() => sheets.value[selected.value]);
const writable = computed(() => !!props.save && !!props.draftKey && ready.value && !sheets.value.some(s => s.truncated));
const widths = computed(() => Array.from({ length: sheet.value.columns }, (_, i) => sheet.value.columnWidths?.[i] ?? officeDefaultColumnWidth));
const totalCells = computed(() => sheets.value.reduce((total, item) => total + Math.max(1, item.rows.length) * item.columns, 0));
const canAdd = computed(() => writable.value && sheet.value.columns < officeLimits.columns && totalCells.value + Math.max(1, sheet.value.rows.length) <= officeLimits.cells);
const addColumnWidth = 104;
const width = computed(() => 44 + widths.value.reduce((a, b) => a + b, 0) + (canAdd.value ? addColumnWidth : 0));
const rows = computed(() => sheet.value.rows.length ? sheet.value.rows : [Array(sheet.value.columns).fill('')]);
const label = (index: number) => { let value = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value; return value; };
const limitWidth = (value: number) => Math.min(2048, Math.max(24, Math.round(value)));
let alive = true;
// Capture this file's host callbacks: queued writes must not follow a later tab's props.
const saveTarget = props.save, readTarget = props.readLatest, draftKey = props.draftKey, filePath = props.path;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let mutations: Promise<unknown> = Promise.resolve();
function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutations.then(work);
  mutations = result.catch(() => {});
  return result;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveFile(); }, 400);
}
function unfinishedCell() {
  const cell = editing.value;
  return cell && cell.value !== (rows.value[cell.row]?.[cell.column] ?? '') ? cell : undefined;
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (unfinishedCell() || busy.value || saving.value) { event.preventDefault(); event.returnValue = ''; }
}
onBeforeUnmount(() => {
  emit('status', { source: statusSource, documentKey: props.draftKey ?? props.path, state: null });
  document.removeEventListener('pointerdown', outsideMenu); window.removeEventListener('resize', dismissMenu); window.removeEventListener('scroll', dismissMenu, true);
  alive = false; window.removeEventListener('beforeunload', beforeUnload);
  clearTimeout(saveTimer);
  const cell = unfinishedCell();
  if (cell && writable.value && !busy.value) {
    void commit({ kind: 'cell', sheet: sheet.value.name, ...cell }).then(() => saveFile());
  } else void mutations.then(() => { if (!failure.value) return saveFile(); });
});
function apply(edit: SheetEdit) {
  if (edit.kind === 'sheet') { sheets.value.push({ name: edit.sheet, rows: [['']], columns: 1, truncated: false }); return; }
  const target = sheets.value.find(item => item.name === edit.sheet)!;
  if (edit.kind === 'rename-sheet') { target.name = edit.name; return; }
  if (edit.kind === 'copy-sheet') {
    const index = sheets.value.indexOf(target);
    sheets.value.splice(index + 1, 0, { ...JSON.parse(JSON.stringify(target)), name: edit.name });
    if (selected.value > index) selected.value++; return;
  }
  if (edit.kind === 'delete-sheet') {
    const index = sheets.value.indexOf(target); sheets.value.splice(index, 1);
    if (selected.value > index) selected.value--;
    selected.value = Math.min(selected.value, sheets.value.length - 1); return;
  }
  if (edit.kind === 'clear' || edit.kind === 'delete') {
    if (edit.kind === 'clear') {
      if (edit.axis === 'row') target.rows[edit.index]?.fill(''); else target.rows.forEach(row => { row[edit.index] = ''; });
    } else if (edit.axis === 'row') { target.rows.splice(edit.index, 1); if (!target.rows.length) target.rows.push(Array(target.columns).fill('')); }
    else { target.rows.forEach(row => { row.splice(edit.index, 1); if (!row.length) row.push(''); }); target.columnWidths?.splice(edit.index, 1); target.columns = Math.max(1, target.columns - 1); }
    return;
  }
  if (edit.kind === 'width') (target.columnWidths ??= [])[edit.column] = edit.width;
  else if (edit.kind === 'column') { target.columns = edit.column + 1; target.rows.forEach(row => { while (row.length < target.columns) row.push(''); }); }
  else { while (target.rows.length <= edit.row) target.rows.push(Array(target.columns).fill('')); target.rows[edit.row][edit.column] = edit.value; }
}
function dismissMenu() { closeMenu(); }
onMounted(async () => {
  document.addEventListener('pointerdown', outsideMenu); window.addEventListener('resize', dismissMenu); window.addEventListener('scroll', dismissMenu, true);
  window.addEventListener('beforeunload', beforeUnload);
  if (!props.save || !props.draftKey) return;
  busy.value = true;
  try {
    const saved = await draft(props.draftKey);
    if (saved) {
      const parsed = await readOffice(saved.base, props.path, new AbortController().signal);
      if (!alive) return;
      if (parsed.kind !== 'spreadsheet') throw new Error('无法恢复工作簿草稿');
      base.value = saved.base; sheets.value = parsed.sheets; edits.value = saved.edits;
      saved.edits.forEach(apply);
    }
    ready.value = true;
  } catch (error) { failure.value = String(error); }
  finally { busy.value = false; if (ready.value && edits.value.length) scheduleSave(); }
});
async function commit(edit: SheetEdit) {
  if (busy.value || !writable.value) return false;
  busy.value = true; failure.value = '';
  return serializeMutation(async () => { try {
    const next = [...edits.value, edit];
    await draft(draftKey!, { base: Uint8Array.from(base.value), edits: JSON.parse(JSON.stringify(next)) });
    edits.value = next; apply(edit); scheduleSave(); return true;
  } catch (error) { failure.value = String(error); return false; }
  finally { busy.value = false; }
  });
}
async function setWidth(column: number, value: number) {
  const edit: SheetEdit = { kind: 'width', sheet: sheet.value.name, column, width: limitWidth(value) };
  if (writable.value) await commit(edit); else if (!busy.value) apply(edit);
}
let drag: { pointer: number; x: number; width: number; column: number; scale: number; preview: number } | undefined;
function start(event: PointerEvent, column: number, scale: number) {
  if (busy.value || event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  drag = { pointer: event.pointerId, x: event.clientX, width: widths.value[column], column, scale, preview: widths.value[column] };
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  drag.preview = limitWidth(drag.width + (event.clientX - drag.x) / drag.scale);
  const col = table.value?.querySelectorAll('col')[drag.column + 1] as HTMLElement | undefined;
  if (col && table.value) { col.style.width = `${drag.preview}px`; table.value.style.width = `${width.value + drag.preview - drag.width}px`; }
}
async function end(event: PointerEvent, cancel = false) {
  if (!drag || event.pointerId !== drag.pointer) return;
  const current = drag; drag = undefined;
  if (!cancel && current.preview !== current.width) await setWidth(current.column, current.preview);
  const col = table.value?.querySelectorAll('col')[current.column + 1] as HTMLElement | undefined;
  if (col && table.value) { col.style.width = `${widths.value[current.column]}px`; table.value.style.width = `${width.value}px`; }
}
function fit(column: number) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context || !table.value) return;
  context.font = getComputedStyle(table.value).font;
  const size = Math.max(context.measureText(label(column)).width, ...sheet.value.rows.map(row => context.measureText((row[column] ?? '').replace(/\s/g, ' ')).width));
  void setWidth(column, size + 12);
}
async function switchSheet(index: number) {
  if (busy.value) return;
  if (editing.value && !await finishCell()) return;
  selection.value = undefined; closeMenu();
  selected.value = index; await nextTick(); tabs.value?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
}
async function addColumn() { if (canAdd.value) await commit({ kind: 'column', sheet: sheet.value.name, column: sheet.value.columns }); }
async function addSheet() {
  if (!writable.value || sheets.value.length >= officeLimits.sheets || totalCells.value >= officeLimits.cells) return;
  let index = 1; while (sheets.value.some(s => s.name === `${t('工作表')}${index}`)) index++;
  if (await commit({ kind: 'sheet', sheet: `${t('工作表')}${index}` })) await switchSheet(sheets.value.length - 1);
}
async function beginCell(row: number, column: number) {
  selection.value = undefined; closeMenu();
  if (!writable.value || busy.value) return;
  editing.value = { row, column, value: rows.value[row][column] ?? '' };
  await nextTick(); table.value?.querySelector<HTMLInputElement>('input')?.focus();
}
async function finishCell() {
  const cell = editing.value; if (!cell) return true;
  if (cell.value === (rows.value[cell.row][cell.column] ?? '')) { editing.value = undefined; return true; }
  const ok = await commit({ kind: 'cell', sheet: sheet.value.name, ...cell });
  if (ok) editing.value = undefined;
  return ok;
}
async function saveFile() {
  clearTimeout(saveTimer);
  if (!saveTarget || !draftKey || saving.value || !ready.value) return;
  saving.value = true;
  try {
    const snapshot = await serializeMutation(async () => ({ base: Uint8Array.from(base.value), edits: JSON.parse(JSON.stringify(edits.value)) as SheetEdit[] }));
    if (!snapshot.edits.length) return;
    const latest = readTarget ? await readTarget() : snapshot.base;
    const bytes = await serializeWorkbook(snapshot.base, filePath, snapshot.edits, latest);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(latest)))).map(b => b.toString(16).padStart(2, '0')).join('');
    await saveTarget(bytes, expected);
    const parsed = await readOffice(bytes, filePath, new AbortController().signal);
    await serializeMutation(async () => {
      // A background save acknowledges only its own snapshot. Newer edits remain durable.
      const pending = JSON.parse(JSON.stringify(edits.value)) as SheetEdit[];
      const remaining = pending.slice(snapshot.edits.length);
      await draft(draftKey, remaining.length ? { base: bytes, edits: remaining } : null, pending);
      base.value = bytes; edits.value = remaining;
      if (parsed.kind === 'spreadsheet') {
        const activeName = sheets.value[selected.value]?.name;
        sheets.value = parsed.sheets; remaining.forEach(apply);
        const activeIndex = sheets.value.findIndex(item => item.name === activeName);
        selected.value = activeIndex >= 0 ? activeIndex : Math.min(selected.value, sheets.value.length - 1);
      }
      failure.value = '';
    });
  } catch (error) { failure.value = String(error); }
  finally { saving.value = false; if (edits.value.length && !failure.value) scheduleSave(); }
}
</script>

<template>
  <section class="spreadsheet-editor" :aria-label="t('Excel 工作簿')" :aria-busy="busy" @keydown="selectionKey">
    <Teleport v-if="!statusManaged" :to="controlsTarget ?? 'body'" :disabled="!controlsTarget" defer>
      <DocumentStatus :document-key="draftKey ?? path" :items="fileStatus.items">
        <button v-if="fileStatus.retry" :disabled="fileStatus.retryDisabled" @click="fileStatus.retry()">{{ t('重试') }}</button>
      </DocumentStatus>
    </Teleport>
    <form v-if="rename" class="sheet-rename" @submit.prevent="sheetAction('rename-sheet')" @keydown.esc.stop.prevent="cancelRename">
      <label>{{ t('工作表名称') }} <input ref="renameInput" v-model="rename.name" :disabled="busy" maxlength="31" :aria-label="t('工作表名称')"></label>
      <button type="submit" :disabled="busy || !rename.name.trim()">{{ t('确定') }}</button><button type="button" :disabled="busy" @click="cancelRename">{{ t('取消') }}</button>
    </form>
    <DocumentReader :page="1" :count="1" grid :controls-target="controlsTarget" :reset-key="selected" :format="path.split('.').at(-1)?.toUpperCase()" :status="t('共 {0} 行', [sheet.rows.length])" :note="t('显示单元格内容与已保存的公式结果，不执行公式、宏或外部链接。')">
      <template #default="{ scale }">
        <p v-if="sheet.truncated" role="status">{{ t('预览仅显示前 {0} 行、{1} 列，请导出后查看完整工作表。', [officeLimits.rows, officeLimits.columns]) }}</p>
        <table ref="table" class="office-grid" :data-selection-axis="selection?.axis" :aria-label="sheet.name" :style="{ width: `${width}px`, zoom: scale }">
          <colgroup><col style="width:44px"><col v-for="(w, i) in widths" :key="i" :style="{ width: `${w}px` }"><col v-if="canAdd" :style="{ width: `${addColumnWidth}px` }"></colgroup>
          <thead><tr><th class="office-corner"></th><th v-for="(_, column) in widths" :key="column" scope="col" :class="{ 'axis-selected': selection?.axis === 'column' && selection.index === column }" @contextmenu.prevent.stop="openMenu($event, 'column', column)"><button class="axis-selector" :aria-label="t('选择 {0} 列', [label(column)])" :aria-pressed="selection?.axis === 'column' && selection.index === column" @click="selectAxis('column', column)" @keydown.shift.f10.prevent="openMenu($event, 'column', column)">{{ label(column) }}</button>
            <span class="column-resizer" role="separator" aria-orientation="vertical" :aria-label="t('调整 {0} 列宽', [label(column)])" :aria-valuenow="widths[column]" :aria-valuemin="24" :aria-valuemax="2048" tabindex="0"
              @pointerdown.stop.prevent="start($event, column, scale)" @click.stop @pointermove="move" @pointerup="end($event)" @pointercancel="end($event, true)" @lostpointercapture="end($event, true)" @dblclick.prevent="fit(column)" @keydown.enter.prevent="fit(column)" @keydown.left.prevent="setWidth(column, widths[column] - 8)" @keydown.right.prevent="setWidth(column, widths[column] + 8)" />
          </th><th v-if="canAdd" class="add-column"><button :disabled="busy" :aria-label="t('添加新列')" :title="t('添加新列')" @click="addColumn"><Plus :size="12" aria-hidden="true" /><span>{{ t('添加列') }}</span></button></th></tr></thead>
          <tbody><tr v-for="(row, r) in rows" :key="r"><th scope="row" :class="{ 'axis-selected': selection?.axis === 'row' && selection.index === r }" @contextmenu.prevent.stop="openMenu($event, 'row', r)"><button class="axis-selector" :aria-label="t('选择第 {0} 行', [r + 1])" :aria-pressed="selection?.axis === 'row' && selection.index === r" @click="selectAxis('row', r)" @keydown.shift.f10.prevent="openMenu($event, 'row', r)">{{ r + 1 }}</button></th><td v-for="(_, c) in widths" :key="c" :class="{ 'cell-selected': selection && (selection.axis === 'row' ? selection.index === r : selection.index === c) }" :title="row[c] ?? ''" :tabindex="writable ? 0 : undefined" @click="selection = undefined" @dblclick="beginCell(r, c)" @keydown.enter.prevent="beginCell(r, c)" @contextmenu="selection && (selection.axis === 'row' ? selection.index === r : selection.index === c) && ($event.preventDefault(), openMenu($event, selection.axis, selection.index))">
            <input v-if="editing?.row === r && editing.column === c" v-model="editing.value" :aria-label="`${label(c)}${r + 1}`" :disabled="busy" @keydown.enter.stop.prevent="finishCell" @keydown.escape.stop="editing = undefined" @keydown.tab="finishCell" @blur="!busy && finishCell()">
            <template v-else>{{ row[c] ?? '' }}</template>
          </td><td v-if="canAdd" class="empty-column"></td></tr></tbody>
        </table>
      </template>
      <template #tabs>
        <div ref="tabs" class="office-sheet-tabs" role="tablist" :aria-label="t('工作表')"><button v-for="(item, index) in sheets" :key="item.name" role="tab" :disabled="busy" :tabindex="selected === index ? 0 : -1" :aria-selected="selected === index" @click="switchSheet(index)" @contextmenu.prevent.stop="openSheetMenu($event, item.name)" @keydown.shift.f10.prevent="openSheetMenu($event, item.name)" @keydown.right.prevent="switchSheet((index + 1) % sheets.length)" @keydown.left.prevent="switchSheet((index + sheets.length - 1) % sheets.length)">{{ item.name }}</button></div>
        <button v-if="writable" class="add-sheet" :disabled="busy || sheets.length >= officeLimits.sheets || totalCells >= officeLimits.cells" :aria-label="t('新建工作表')" @click="addSheet"><Plus :size="16" /></button>
      </template>
    </DocumentReader>
    <Teleport to="body"><div v-if="menu" ref="menuElement" class="dropdown compact-action-menu sheet-context-menu" role="menu" tabindex="-1" :aria-label="menu.sheet ? t('工作表操作') : t('行列操作')" :style="{ left: `${menu.x}px`, top: `${menu.y}px`, visibility: menu.positioned ? 'visible' : 'hidden' }" @keydown="menuKey" @contextmenu.prevent>
      <template v-if="menu.sheet">
        <button role="menuitem" :disabled="!writable || busy" @click="beginRename"><Pencil :size="14" aria-hidden="true" />{{ t('重命名工作表') }}</button>
        <button role="menuitem" :disabled="!writable || busy || !canCopySheet" @click="sheetAction('copy-sheet')"><Copy :size="14" aria-hidden="true" />{{ t('复制工作表') }}</button>
        <div class="menu-divider" role="separator" />
        <button class="danger-text" role="menuitem" :disabled="!writable || busy || sheets.length <= 1" @click="sheetAction('delete-sheet')"><Trash2 :size="14" aria-hidden="true" />{{ t('删除工作表') }}</button>
      </template>
      <template v-else>
      <button role="menuitem" @click="copySelection"><Copy :size="14" aria-hidden="true" />{{ t('复制') }}</button>
      <button role="menuitem" :disabled="!writable || busy" @click="changeSelection('clear')"><Eraser :size="14" aria-hidden="true" />{{ t('清除内容') }}<kbd class="menu-shortcut" aria-hidden="true">Delete</kbd></button>
      <div class="menu-divider" role="separator" />
      <button class="danger-text" role="menuitem" :disabled="!writable || busy" @click="changeSelection('delete')"><Trash2 :size="14" aria-hidden="true" />{{ selection?.axis === 'row' ? t('删除行') : t('删除列') }}</button>
      </template>
    </div></Teleport>
  </section>
</template>

<style scoped>
.spreadsheet-editor { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; overflow:hidden; }
.sheet-rename { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px 12px; font-size:12px; border-bottom:1px solid var(--line); }
.sheet-rename input { color:var(--text); background:var(--paper); border:1px solid var(--line); border-radius:4px; padding:4px 6px; font:inherit; }
.sheet-rename button { padding:4px 8px; border-radius:4px; }
.axis-selector { display:block; width:100%; padding:0; border:0; background:transparent; color:inherit; font:inherit; }
.office-grid .axis-selected { background:color-mix(in srgb, var(--green) 20%, var(--paper)); color:var(--green); }
.office-grid td.cell-selected, .office-grid tr:hover td.cell-selected { background:color-mix(in srgb, var(--green) 12%, var(--paper)); }
.sheet-context-menu { position:fixed; z-index:100; max-height:calc(100dvh - 16px); overflow-y:auto; }
:where(.spreadsheet-editor) button { color:var(--text); background:var(--paper); border:1px solid var(--line); cursor:pointer; font:inherit; }
:where(.spreadsheet-editor) button:disabled { opacity:.5; cursor:default; }
.office-grid { --selected-grid-line:color-mix(in srgb, var(--text) 18%, var(--paper)); border-collapse:separate; border-spacing:0; table-layout:fixed; font:13px/18px var(--font-ui, sans-serif); }
.office-grid th, .office-grid td { box-sizing:border-box; height:22px; border:0; border-right:1px solid var(--line); border-bottom:1px solid var(--line); padding:1px 4px; text-align:left; vertical-align:top; white-space:nowrap; overflow:hidden; text-overflow:clip; }
/* Emphasize only boundaries shared by selected cells, never the outer edge. */
.office-grid[data-selection-axis='column'] thead .axis-selected,
.office-grid[data-selection-axis='column'] tbody tr:not(:last-child) .cell-selected { border-bottom-color:var(--selected-grid-line); }
.office-grid[data-selection-axis='row'] tbody .axis-selected,
.office-grid[data-selection-axis='row'] .cell-selected:has(+ .cell-selected) { border-right-color:var(--selected-grid-line); }
.office-grid th { color:var(--muted); background:var(--paper); font-weight:400; text-align:center; font-size:11px; user-select:none; }
.office-grid thead { position:sticky; top:0; z-index:2; }
.office-grid thead th { position:relative; overflow:visible; }
.office-grid tbody th, .office-grid .office-corner { position:sticky; left:0; width:44px; }
.office-grid .office-corner { z-index:4; }
.office-grid tr:hover td { background:color-mix(in srgb, var(--green) 5%, var(--paper)); }
.column-resizer { position:absolute; top:0; right:-5px; width:9px; height:100%; z-index:1; cursor:col-resize; touch-action:none; outline:none; }
.column-resizer::after { content:''; position:absolute; top:0; bottom:0; left:4px; width:0; border-right:1px solid var(--green); opacity:0; pointer-events:none; }
.column-resizer:hover::after, .column-resizer:focus-visible::after, .column-resizer:active::after { opacity:1; }
.office-grid input { box-sizing:border-box; width:100%; height:18px; padding:0; border:0; outline:1px solid var(--green); font:inherit; color:var(--text); background:var(--paper); }
.office-grid .add-column { padding:0 6px; border:0; vertical-align:middle; }
.add-column button { display:inline-flex; align-items:center; justify-content:center; gap:4px; min-height:22px; padding:2px 6px; border:0; border-radius:4px; color:var(--muted); background:transparent; font:inherit; white-space:nowrap; }
.add-column button:hover:not(:disabled) { color:var(--text); background:var(--hover); }
.add-column button svg { flex-shrink:0; }
.office-grid .empty-column, .office-grid tr:hover .empty-column { border:0; background:transparent; }
.office-sheet-tabs { display:flex; }
.office-sheet-tabs button { flex-shrink:0; padding:7px 18px; border:0; border-right:1px solid var(--line); border-bottom:2px solid transparent; background:transparent; color:var(--muted); font:12px var(--font-ui,sans-serif); }
.office-sheet-tabs button[aria-selected=true] { color:var(--green); background:var(--paper); border-bottom-color:var(--green); }
.office-sheet-tabs button:hover { background:var(--hover); }
.add-sheet { display:flex; align-items:center; padding:0 12px; border:0; border-right:1px solid var(--line); }
:where(.spreadsheet-editor) button:focus-visible, td:focus-visible { outline:2px solid var(--green); outline-offset:-2px; }
</style>
