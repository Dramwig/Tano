<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FilePlus2, Plus, Save, X } from 'lucide-vue-next';
import { localDayKey } from '../calendar';
import { builtinTemplates, nameTemplate, renderTemplate, templateVariables } from '../workspace-templates';
import type { DocumentTemplate } from '../workspace-templates';
import { useWorkspaceStore } from '../stores/workspace';
const props = defineProps<{ source?: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore(), workspaceId = store.workspace!.id;
const panel = ref<HTMLElement>(), custom = ref<DocumentTemplate[]>([]), selected = ref('meeting');
const editing = ref(false), body = ref(''), targetPath = ref('会议纪要.md'), busy = ref(false), error = ref('');
const templateName = ref('');
const values = ref<Record<string, string>>({ title: '会议纪要', date: localDayKey(new Date()), owner: '', project: store.workspace!.name });
const all = computed(() => [...builtinTemplates, ...custom.value]);
const current = computed(() => all.value.find(item => item.id === selected.value));
const variables = computed(() => templateVariables(current.value?.content ?? ''));
const labels: Record<string, string> = { title: '标题', date: '日期 / 周期', owner: '参与人 / 接手人', project: '项目 / 目录' };
const rendered = computed(() => { try { return renderTemplate(current.value?.content ?? '', values.value); } catch { return ''; } });
const disabled = computed(() => busy.value || store.workspace?.id !== workspaceId || store.workspace.readOnly);
const previous = document.activeElement as HTMLElement | null;
async function load() { const result = await store.templates(workspaceId); custom.value = result.templates; error.value = result.errors.join('\n'); }
function choose() {
  editing.value = false; error.value = '';
  values.value.title = current.value?.name ?? '';
  targetPath.value = `${current.value?.name ?? '新建文档'}.md`;
}
function edit(copy = false) { body.value = copy ? props.source ?? '# 新模板\n\n' : current.value?.content ?? ''; templateName.value = copy ? '新模板' : current.value?.name ?? ''; if (copy) selected.value = ''; editing.value = true; error.value = ''; }
async function save(copy = false) {
  if (disabled.value) return;
  busy.value = true; error.value = '';
  try {
    const path = await store.writeTemplate(nameTemplate(body.value, templateName.value), workspaceId, copy ? undefined : current.value);
    await load(); selected.value = custom.value.find(item => item.path === path)!.id; editing.value = false; choose();
  } catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
async function create() {
  if (disabled.value || !rendered.value) return;
  busy.value = true; error.value = '';
  try { await store.create(targetPath.value.trim(), false, rendered.value, workspaceId); emit('close'); }
  catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy.value) emit('close'); }
  if (event.key !== 'Tab') return;
  const elements = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
  if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
}
onMounted(async () => { panel.value?.focus(); try { await load(); } catch (reason) { error.value = String(reason); } });
onBeforeUnmount(() => { if (previous?.isConnected) previous.focus(); });
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="!busy && emit('close')">
    <section ref="panel" class="modal template-dialog" role="dialog" aria-modal="true" aria-label="文档模板" tabindex="-1" @keydown="keyboard">
      <header><h2>文档模板</h2><button class="icon-button" title="关闭模板" aria-label="关闭模板" :disabled="busy" @click="emit('close')"><X :size="18" /></button></header>
      <div class="template-scroll">
        <div class="template-picker"><label>模板<select v-model="selected" aria-label="选择文档模板" :disabled="disabled || editing" @change="choose"><option value="" disabled>新模板</option><option v-for="item in all" :key="item.id" :value="item.id">{{ item.name }}{{ item.path ? ' · 工作区' : '' }}</option></select></label><button class="icon-button" aria-label="新建模板" title="新建模板" :disabled="disabled || editing" @click="edit(true)"><Plus :size="18" /></button></div>
        <template v-if="editing"><label>模板名称<input v-model="templateName" maxlength="100" :disabled="disabled" /></label><label>模板 Markdown<textarea v-model="body" rows="12" :disabled="disabled" /></label></template>
        <template v-else><div class="template-fields"><label v-for="key in variables" :key="key">{{ labels[key] ?? key }}<input v-model="values[key]" :disabled="disabled" /></label></div><label>新文档路径<input v-model="targetPath" :disabled="disabled" /></label><pre class="template-preview">{{ rendered || current?.content }}</pre></template>
        <p v-if="error" role="alert">{{ error }}</p>
      </div>
      <footer v-if="editing"><button :disabled="disabled || !body.trim() || !templateName.trim()" @click="save()"><Save :size="15" />保存模板</button><button v-if="current?.path" :disabled="disabled || !body.trim() || !templateName.trim()" @click="save(true)"><Plus :size="15" />另存模板</button><button :disabled="busy" @click="editing = false; selected = selected || 'meeting'">取消</button></footer>
      <footer v-else><button :disabled="disabled || !current" @click="edit()"><Save :size="15" />{{ current?.path ? '编辑模板' : '自定义模板' }}</button><button :disabled="disabled || !rendered || !targetPath.trim()" @click="create"><FilePlus2 :size="15" />创建文档</button></footer>
    </section>
  </div>
</template>
<style scoped>
.template-dialog { display: flex; flex-direction: column; width: min(680px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 0; min-width: 0; border-radius: 8px; }
header, footer { display: flex; align-items: center; gap: 14px; padding: 16px 22px; flex-shrink: 0; }
header { justify-content: space-between; border-bottom: 1px solid var(--line); } h2 { margin: 0; font-size: 16px; }
footer { justify-content: flex-end; border-top: 1px solid var(--line); flex-wrap: wrap; }
.template-scroll { overflow: auto; padding: 20px 22px; display: grid; gap: 16px; }
label { display: grid; gap: 6px; font-size: 12px; min-width: 0; }
.template-picker { display: grid; grid-template-columns: minmax(0, 1fr) 32px; align-items: end; gap: 12px; }
.template-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
input, select, textarea { width: 100%; min-width: 0; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; }
textarea { resize: vertical; min-height: 160px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-size: 12px; line-height: 1.7; padding: 14px 0; border-top: 1px solid var(--line); }
footer button { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; } p { margin: 0; color: var(--danger); white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 500px) { .template-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
