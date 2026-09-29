<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { AlertTriangle, Archive, Clock3, RotateCcw, X } from 'lucide-vue-next';
import type { WorkspaceBackupCatalog, WorkspaceRecoveryPreview } from '@tano/protocol';

const props = defineProps<{
  catalog: WorkspaceBackupCatalog;
  preview: WorkspaceRecoveryPreview | null;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{
  close: [];
  select: [snapshotId: string];
  restore: [snapshotId: string];
}>();
const selectedId = ref(props.catalog.pendingRestore ?? props.catalog.snapshots.find((item) => !item.error)?.snapshotId ?? '');
const firstButton = ref<HTMLButtonElement>();
const setFirst = (element: unknown) => { firstButton.value = element instanceof HTMLButtonElement ? element : undefined; };
const selected = computed(() => props.catalog.snapshots.find((item) => item.snapshotId === selectedId.value));
const currentPreview = computed(() => props.preview?.snapshot.snapshotId === selectedId.value ? props.preview : null);
watch(() => props.catalog, (catalog) => {
  if (!catalog.snapshots.some((item) => item.snapshotId === selectedId.value))
    selectedId.value = catalog.pendingRestore ?? catalog.snapshots.find((item) => !item.error)?.snapshotId ?? '';
});
onMounted(() => void nextTick(() => firstButton.value?.focus()));
const date = (value: number) => value ? new Date(value).toLocaleString('zh-CN') : '时间未知';
const size = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024
  ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
function choose(id: string) {
  selectedId.value = id;
  emit('select', id);
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy) { event.stopPropagation(); emit('close'); }
}
</script>

<template>
  <div class="recovery-backdrop" @mousedown.self="!busy && emit('close')">
    <section class="recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title" @keydown="keydown">
      <header class="recovery-header">
        <div>
          <h2 id="recovery-title">工作区备份与恢复</h2>
          <p :title="catalog.path">{{ catalog.path }}</p>
        </div>
        <button class="recovery-icon" type="button" aria-label="关闭" title="关闭" :disabled="busy" @click="emit('close')"><X :size="18" /></button>
      </header>
      <p v-if="catalog.pendingRestore" class="recovery-notice" role="status"><AlertTriangle :size="17" />上次恢复尚未完成。请继续恢复同一快照。</p>
      <div class="recovery-body">
        <nav class="recovery-list" aria-label="恢复快照">
          <h3>恢复快照</h3>
          <button v-for="(snapshot, index) in catalog.snapshots" :key="snapshot.snapshotId"
            :ref="index === 0 ? setFirst : undefined"
            type="button" :class="{ selected: selectedId === snapshot.snapshotId }"
            :aria-current="selectedId === snapshot.snapshotId ? 'true' : undefined"
            :disabled="busy" @click="choose(snapshot.snapshotId)">
            <Archive :size="17" />
            <span><strong>{{ date(snapshot.createdAt) }}</strong><small>{{ snapshot.error ? '备份损坏' : `${snapshot.fileCount} 个文件 · ${size(snapshot.bytes)}` }}</small></span>
          </button>
          <p v-if="!catalog.snapshots.length" class="recovery-empty">没有可用的恢复快照。</p>
        </nav>
        <main class="recovery-detail">
          <template v-if="selected">
            <div class="recovery-detail-heading"><Clock3 :size="19" /><div><h3>{{ date(selected.createdAt) }}</h3><p>{{ selected.fileCount }} 个文件 · {{ size(selected.bytes) }}</p></div></div>
            <p v-if="selected.error" class="recovery-error" role="alert">{{ selected.error }}</p>
            <template v-else-if="currentPreview">
              <div class="recovery-stats"><span>将恢复 {{ currentPreview.changes.length }} 处差异</span><span>工作区 {{ currentPreview.workspaceId }}</span></div>
              <div class="recovery-changes" aria-label="恢复差异">
                <div v-for="change in currentPreview.changes.slice(0, 200)" :key="change.path"><span :title="change.path">{{ change.path }}</span><small>{{ change.kind }}</small></div>
                <p v-if="currentPreview.changes.length > 200">另有 {{ currentPreview.changes.length - 200 }} 处差异</p>
                <p v-if="!currentPreview.changes.length">当前工作区数据与此快照一致。</p>
              </div>
              <p class="recovery-scope">恢复前的现存工作区数据会保留副本；Markdown 与附件保持现状。</p>
            </template>
            <p v-else-if="busy" class="recovery-empty">正在校验备份…</p>
            <p v-else class="recovery-empty">此快照无法预览，请检查错误信息。</p>
          </template>
          <p v-else class="recovery-empty">当前没有可恢复的备份。</p>
          <p v-if="!catalog.snapshots.some((item) => !item.error)" class="recovery-error" role="alert">没有有效快照，无法恢复原 UUID、文件短 ID、对象和关系；现存 Markdown 与附件仍可单独保留。</p>
          <p v-if="error" class="recovery-error" role="alert">{{ error }}</p>
          <footer>
            <button type="button" class="recovery-secondary" :disabled="busy" @click="emit('close')">关闭</button>
            <button type="button" class="recovery-primary" :disabled="busy || !selected || !!selected.error || (!currentPreview && catalog.pendingRestore !== selectedId)"
              @click="emit('restore', selectedId)"><RotateCcw :size="16" />{{ catalog.pendingRestore === selectedId ? '继续恢复' : '恢复此快照' }}</button>
          </footer>
        </main>
      </div>
    </section>
  </div>
</template>

<style scoped>
.recovery-backdrop { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: #1216198c; padding: 20px; }
.recovery-dialog { width: min(850px, 100%); max-height: min(720px, calc(100dvh - 40px)); display: flex; flex-direction: column; overflow: hidden; background: var(--paper); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 16px 56px #1113; }
.recovery-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.recovery-header h2 { margin: 0; font-size: 18px; font-weight: 650; }
.recovery-header p { margin: 5px 0 0; color: var(--muted); overflow-wrap: anywhere; font-size: 12px; }
.recovery-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 4px; }
.recovery-icon:hover, .recovery-list button:hover { background: var(--hover); }
.recovery-notice { display: flex; gap: 8px; align-items: center; margin: 0; padding: 11px 22px; background: var(--warning-bg); color: var(--warning); }
.recovery-body { display: grid; grid-template-columns: 245px minmax(0, 1fr); min-height: 0; flex: 1; }
.recovery-list { overflow: auto; padding: 16px 10px; border-right: 1px solid var(--line); background: var(--sidebar); }
.recovery-list h3 { font-size: 12px; color: var(--muted); font-weight: 600; margin: 0 10px 10px; }
.recovery-list button { display: flex; width: 100%; gap: 10px; align-items: center; text-align: left; padding: 10px; border-radius: 4px; }
.recovery-list button.selected { color: var(--green); background: var(--accent); }
.recovery-list button span { min-width: 0; }
.recovery-list button strong, .recovery-list button small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recovery-list button strong { font-size: 13px; font-weight: 600; }
.recovery-list button small { color: var(--muted); margin-top: 3px; font-size: 11px; }
.recovery-detail { display: flex; flex-direction: column; gap: 15px; overflow: auto; padding: 22px; min-height: 290px; }
.recovery-detail-heading { display: flex; align-items: center; gap: 11px; }
.recovery-detail-heading h3 { margin: 0; font-size: 16px; }
.recovery-detail-heading p { margin: 3px 0 0; color: var(--muted); }
.recovery-stats { display: flex; flex-wrap: wrap; gap: 5px 18px; color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.recovery-changes { overflow: auto; flex: 1; min-height: 90px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.recovery-changes > div { display: flex; gap: 14px; justify-content: space-between; padding: 9px 2px; border-bottom: 1px solid var(--line); }
.recovery-changes span { overflow-wrap: anywhere; min-width: 0; }
.recovery-changes small { color: var(--muted); flex: none; max-width: 46%; text-align: right; }
.recovery-scope { color: var(--text-secondary); margin: 0; font-size: 12px; }
.recovery-empty { color: var(--muted); margin: 12px 8px; }
.recovery-error { color: var(--danger); background: var(--danger-bg); padding: 10px; margin: 0; border-radius: 4px; overflow-wrap: anywhere; }
footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: auto; }
footer button { display: inline-flex; gap: 7px; align-items: center; justify-content: center; min-height: 34px; padding: 7px 13px; border-radius: 4px; }
.recovery-secondary { border: 1px solid var(--control-border); }
.recovery-primary { color: white; background: var(--green-fill); }
.recovery-primary:hover:not(:disabled) { background: var(--green-fill-hover); }
@media (max-width: 640px) { .recovery-backdrop { padding: 8px; } .recovery-dialog { max-height: calc(100dvh - 16px); } .recovery-body { grid-template-columns: 1fr; } .recovery-list { display: flex; gap: 5px; flex: none; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 9px; } .recovery-list h3 { display: none; } .recovery-list button { min-width: 180px; width: 180px; } .recovery-detail { padding: 16px; } }
</style>
