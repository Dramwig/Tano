<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import { ArrowRight, Check, Eye, FilePlus2, FileText, Files, LayoutTemplate, Plus, Save, Search, X } from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import type { FileEntry } from '@tano/protocol';
import { localDayKey } from '../calendar';
import { builtinTemplates, nameTemplate, renderTemplate, templateVariables } from '../workspace-templates';
import type { DocumentTemplate } from '../workspace-templates';
import { filterTemplates, templateCategories, templateDocumentPath, templateInfo, templatePreview } from '../template-catalog';
import type { TemplateCategory } from '../template-catalog';
import { useWorkspaceStore } from '../stores/workspace';
import { recordHelpCompleted } from '../help-checklist';
import TemplateThumbnail from './TemplateThumbnail.vue';
import WorkspaceBreadcrumb from './WorkspaceBreadcrumb.vue';

const props = defineProps<{ source?: string; demoLabel?: string | null; initialize?: { title: string; apply: (content: string) => void } }>();
const emit = defineEmits<{ close: []; openFile: [file: FileEntry] }>();
const store = useWorkspaceStore(), workspaceId = store.workspace!.id;
const page = ref<HTMLElement>(), scroller = ref<HTMLElement>();
const custom = ref<DocumentTemplate[]>([]), selected = ref<DocumentTemplate>();
const query = ref(''), category = ref<TemplateCategory>('all');
const mode = ref<'browse' | 'detail' | 'preview' | 'edit'>('browse');
const busy = ref(false), loading = ref(true), error = ref(''), loadError = ref('');
const body = ref(''), templateName = ref(''), editBase = ref<DocumentTemplate>();
const targetPath = ref(''), values = ref<Record<string, string>>({});
const labels: Record<string, string> = { get title() { return t('标题'); }, get date() { return t('日期 / 周期'); }, get owner() { return t('参与人 / 接手人'); }, get project() { return t('项目 / 目录'); } };
const templateLabel = (template: DocumentTemplate) => template.path ? template.name : t(template.name);
const order = ['meeting', 'weekly', 'project', 'todo', 'study', 'travel', 'handoff'];
const builtins = [...builtinTemplates].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const visibleBuiltins = computed(() => filterTemplates(builtins, category.value, query.value));
const visibleCustom = computed(() => filterTemplates(custom.value, category.value, query.value));
const variables = computed(() => templateVariables(selected.value?.content ?? ''));
const fields = computed(() => variables.value.filter(key => !props.initialize || key !== 'title'));
const missing = computed(() => variables.value.filter(key => !values.value[key]?.trim()));
const rendered = computed(() => { try { return renderTemplate(selected.value?.content ?? '', values.value); } catch { return ''; } });
const preview = computed(() => {
  if (!selected.value) return '';
  try { return templatePreview(selected.value, values.value); } catch { return ''; }
});
const disabled = computed(() => busy.value || store.workspace?.id !== workspaceId || store.workspace.readOnly);
const canAdd = computed(() => !disabled.value && !!rendered.value && (!!props.initialize || !!targetPath.value.trim()));
const addLabel = computed(() => props.initialize ? t('添加到当前文档') : t('添加到工作区'));
const breadcrumbPages = computed(() => [
  { id: 'browse', get label() { return t('模板库'); }, icon: LayoutTemplate, current: mode.value === 'browse', disabled: busy.value },
  ...(selected.value && (mode.value === 'detail' || mode.value === 'preview')
    ? [{ id: 'detail', label: templateLabel(selected.value), current: mode.value === 'detail', disabled: busy.value }] : []),
  ...(mode.value === 'preview' ? [{ id: 'preview', get label() { return t('预览'); }, current: true }] : []),
  ...(mode.value === 'edit' ? [{ id: 'edit', label: editBase.value?.path ? t('编辑模板') : t('创建模板'), current: true }] : []),
]);
let browseScroll = 0;

async function load() {
  const result = await store.templates(workspaceId);
  custom.value = result.templates; loadError.value = result.errors.join('\n');
}
async function navigate(next: typeof mode.value) {
  if (mode.value === 'browse') browseScroll = scroller.value?.scrollTop ?? 0;
  mode.value = next; error.value = '';
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = next === 'browse' ? browseScroll : 0;
  if (next === 'browse' && selected.value) {
    const card = [...page.value?.querySelectorAll<HTMLElement>('[data-template-id]') ?? []].find(element => element.dataset.templateId === selected.value?.id);
    if (card) { card.focus({ preventScroll: true }); return; }
  }
  page.value?.querySelector<HTMLElement>('h1[tabindex]')?.focus({ preventScroll: true });
}
function navigateBreadcrumb(id: string) {
  if (!busy.value && (id === 'browse' || id === 'detail')) void navigate(id);
}
function choose(template: DocumentTemplate) {
  selected.value = template;
  values.value = { title: props.initialize?.title ?? template.name, date: localDayKey(new Date()), owner: '', project: store.workspace?.name ?? '' };
  targetPath.value = templateDocumentPath(template.name, store.workspace?.files.map(file => file.path) ?? []);
  void navigate('detail');
}
function cancelEdit() {
  if (busy.value) return;
  void navigate(selected.value ? 'detail' : 'browse');
}
function edit(fresh = false) {
  editBase.value = fresh ? undefined : selected.value;
  body.value = fresh ? props.source || '# {{title}}\n\n## 内容\n\n' : selected.value?.content ?? '';
  templateName.value = fresh ? '' : selected.value?.name ?? '';
  void navigate('edit');
}
async function save(copy = false) {
  if (disabled.value) return;
  busy.value = true; error.value = '';
  try {
    const path = await store.writeTemplate(nameTemplate(body.value, templateName.value), workspaceId, copy ? undefined : editBase.value);
    await load();
    const saved = custom.value.find(item => item.path === path);
    if (!saved) throw new Error(t('模板已保存，但暂时无法重新读取，请从模板库重新打开。'));
    choose(saved);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function create() {
  if (!canAdd.value) return;
  busy.value = true; error.value = '';
  try {
    if (props.initialize) props.initialize.apply(rendered.value);
    else await store.create(targetPath.value.trim(), false, rendered.value, workspaceId);
    recordHelpCompleted('use-template'); emit('close');
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
onMounted(async () => {
  page.value?.querySelector<HTMLElement>('h1[tabindex]')?.focus({ preventScroll: true });
  try { await load(); } catch (reason) { loadError.value = String(reason); }
  finally { loading.value = false; }
});
</script>

<template>
  <section ref="page" class="template-library" :aria-label="t('模板库')">
    <header class="topbar template-library-nav">
      <slot name="navigation" />
      <div class="template-breadcrumb" :class="{ 'template-breadcrumb-preview': mode === 'preview' }"><WorkspaceBreadcrumb
        :workspace-id="store.workspace?.id" :workspace-name="store.workspace?.name ?? 'Tano'"
        :entries="store.workspace?.files ?? []" :demo-label="demoLabel" :read-only="store.workspace?.readOnly"
        :pages="breadcrumbPages" @navigate="navigateBreadcrumb" @open="emit('openFile', $event)"
      /></div>
      <button v-if="mode === 'browse'" class="template-button" :disabled="disabled" @click="edit(true)"><Plus :size="15" />{{ t('创建模板') }}</button>
      <button v-else-if="mode === 'preview'" class="template-button template-button-primary" @click="navigate('detail')"><FilePlus2 :size="15" />{{ t('使用模板') }}</button>
    </header>

    <div ref="scroller" class="template-library-scroll panel-scrollbar">
      <main class="template-library-content" :class="{ 'template-preview-content': mode === 'preview' }">
        <template v-if="mode === 'browse'">
          <div class="template-library-hero">
            <div><h1 tabindex="-1">{{ t('下一页，从这里开始。') }}</h1><p>{{ t('为工作、学习和生活，找到一个好用的起点。') }}</p></div>
            <div class="template-search"><Search :size="17" /><input v-model="query" :aria-label="t('搜索模板')" :placeholder="t('搜索模板')" type="search" /><button v-if="query" class="icon-button" :aria-label="t('清空搜索')" @click="query = ''"><X :size="15" /></button></div>
          </div>
          <div class="template-categories" role="group" :aria-label="t('模板分类')">
              <button v-for="item in templateCategories" :key="item.id" :aria-pressed="category === item.id" :class="{ selected: category === item.id }" @click="category = item.id">{{ item.label }}</button>
          </div>
          <p v-if="loadError" class="template-error" role="alert">{{ loadError }}</p>
          <div v-if="category === 'all' && !query.trim()" class="template-collections">
            <button class="template-collection collection-work" @click="category = 'work'">
              <div><strong>{{ t('让工作，有条不紊。') }}</strong><span>{{ t('浏览工作模板') }}<ArrowRight :size="15" /></span></div>
              <div class="template-collection-pages" aria-hidden="true"><TemplateThumbnail :template="builtins[2]!" /><TemplateThumbnail :template="builtins[0]!" /></div>
            </button>
            <button class="template-collection collection-life" @click="category = 'life'">
              <div><strong>{{ t('给生活，留一点空间。') }}</strong><span>{{ t('浏览生活模板') }}<ArrowRight :size="15" /></span></div>
              <div class="template-collection-pages" aria-hidden="true"><TemplateThumbnail :template="builtins[5]!" /><TemplateThumbnail :template="builtins[3]!" /></div>
            </button>
          </div>
          <section v-if="visibleBuiltins.length" class="template-section" :aria-label="t('精选模板')">
            <div class="template-section-heading"><h2>{{ query.trim() ? t('搜索结果') : category === 'all' ? t('精选模板') : t('{0}模板', [templateCategories.find(item => item.id === category)?.label]) }}</h2><span>{{ visibleBuiltins.length }} {{ t('个模板') }}</span></div>
            <div class="template-grid">
              <button v-for="item in visibleBuiltins" :key="item.id" class="template-card" :data-template-id="item.id" :aria-label="t('查看{0}模板', [templateLabel(item)])" @click="choose(item)">
                <TemplateThumbnail :template="item" />
                <div class="template-card-caption"><FileText :size="17" /><div><strong>{{ templateLabel(item) }}</strong><p>{{ templateInfo(item).description }}</p></div><span>{{ t('内置') }}</span></div>
              </button>
            </div>
          </section>
          <section v-if="(category === 'all' || category === 'custom') && (!query.trim() || visibleCustom.length)" class="template-section" :aria-label="t('我的模板')">
            <div class="template-section-heading"><h2>{{ t('我的模板') }}</h2><span>{{ t('当前工作区') }}</span></div>
            <LoadingSkeleton v-if="loading && !visibleCustom.length" :rows="4" />
            <div v-else-if="visibleCustom.length" class="template-grid">
              <button v-for="item in visibleCustom" :key="item.id" class="template-card" :data-template-id="item.id" :aria-label="t('查看{0}模板', [templateLabel(item)])" @click="choose(item)">
                <TemplateThumbnail :template="item" /><div class="template-card-caption"><FileText :size="17" /><div><strong>{{ templateLabel(item) }}</strong><p>{{ templateInfo(item).description }}</p></div><span>{{ t('工作区') }}</span></div>
              </button>
            </div>
            <div v-else class="template-custom-empty"><Files :size="26" /><div><strong>{{ t('把常用的内容，留作下一次的起点') }}</strong><p>{{ t('将文档保存为模板，在这个工作区重复使用。') }}</p></div><button class="template-button" :disabled="disabled" @click="edit(true)"><Plus :size="15" />{{ t('创建模板') }}</button></div>
          </section>
          <div v-if="!visibleBuiltins.length && !visibleCustom.length && (query.trim() || !['all', 'custom'].includes(category))" class="template-no-results" role="status"><Search :size="28" /><h2>{{ t('没有找到匹配的模板') }}</h2><p>{{ t('试试其他关键词，或查看全部模板。') }}</p><button class="template-button" @click="query = ''; category = 'all'">{{ t('查看全部模板') }}</button></div>
          <p class="template-library-note">{{ t('内置模板与当前工作区模板 · 暂不支持在线模板市场') }}</p>
        </template>

        <template v-else-if="mode === 'edit'">
          <div class="template-detail-heading"><h1 tabindex="-1">{{ editBase?.path ? t('编辑模板') : t('创建模板') }}</h1><p>{{ t('保存常用的文档结构，让下一次开始更轻松。') }}</p></div>
          <form class="template-edit-form" @submit.prevent="save()">
            <label>{{ t('模板名称') }}<input v-model="templateName" required maxlength="100" :disabled="disabled" :placeholder="t('例如：团队周报')" /></label>
            <label>{{ t('模板 Markdown') }}<textarea v-model="body" required rows="16" :disabled="disabled" spellcheck="false" /></label>
            <p class="template-hint">{{ t('使用双花括号定义填写字段，例如') }} <code v-text="'{{title}}'" /> {{ t('和') }} <code v-text="'{{date}}'" />。</p>
            <p v-if="error" class="template-error" role="alert">{{ error }}</p>
            <div class="template-edit-actions"><button class="template-button template-button-primary" type="submit" :disabled="disabled || !body.trim() || !templateName.trim()"><Save :size="15" />{{ busy ? t('正在保存…') : t('保存模板') }}</button><button v-if="editBase?.path" class="template-button" type="button" :disabled="disabled || !body.trim() || !templateName.trim()" @click="save(true)"><Plus :size="15" />{{ t('另存模板') }}</button><button class="template-button" type="button" :disabled="busy" @click="cancelEdit">{{ t('取消') }}</button></div>
          </form>
        </template>

        <template v-else-if="selected">
          <div v-if="mode === 'preview'" class="template-detail-heading"><h1 tabindex="-1">{{ templateLabel(selected) }}</h1><p>{{ t('模板预览') }}</p></div>
          <div class="template-detail-layout" :class="{ 'is-preview': mode === 'preview' }">
            <div class="template-document-stage" :class="`tone-${templateInfo(selected).tone}`">
              <div class="template-document-paper" :aria-label="t('模板内容预览')">
                <MarkdownEditor :key="selected.id" :model-value="preview" :document-id="`template-preview-${workspaceId}-${selected.id}`" readonly :preferences="{ folding: false, previewMathWhileEditing: true, blankBlockAiShortcut: false }" :show-document-properties="false" :reveal-markdown="false" :resolve-image="() => null" @error="error = $event" />
              </div>
            </div>
            <aside v-if="mode === 'detail'" class="template-detail-sidebar" :aria-label="t('使用模板')">
              <div class="template-detail-heading"><span class="template-detail-category">{{ templateCategories.find(item => item.id === templateInfo(selected!).category)?.label }}</span><h1 tabindex="-1">{{ templateLabel(selected) }}</h1><p>{{ templateInfo(selected).description }}</p></div>
              <div class="template-author"><FileText :size="19" />{{ selected.path ? t('当前工作区 · 自定义模板') : t('同页 · 内置模板') }}</div>
              <form @submit.prevent="create">
                <button type="submit" class="template-button template-button-primary template-wide" :disabled="!canAdd"><FilePlus2 :size="17" />{{ busy ? t('正在添加…') : addLabel }}</button>
                <button type="button" class="template-button template-wide" @click="navigate('preview')"><Eye :size="17" />{{ t('预览模板') }}</button>
                <p v-if="initialize" class="template-target"><span>{{ t('添加到「') }}{{ initialize.title }}{{ t('」，保留当前标题和文档属性。') }}</span></p>
                <p v-else class="template-target"><span>{{ t('在当前工作区创建一篇新文档。') }}</span></p>
                <div v-if="fields.length || !initialize" class="template-fields">
                  <h2>{{ t('填写模板信息') }}</h2>
                  <label v-for="key in fields" :key="key">{{ labels[key] ?? key }}<input v-model="values[key]" :aria-label="labels[key] ?? key" :disabled="disabled" required :placeholder="t('填写{0}', [labels[key] ?? key])" /></label>
                  <label v-if="!initialize">{{ t('新文档路径') }}<input v-model="targetPath" required :disabled="disabled" /></label>
                </div>
                <p v-if="missing.length" class="template-hint">{{ t('填写') }}{{ missing.map(key => labels[key] ?? key).join('、') }}{{ t('后即可添加。') }}</p>
                <p v-if="error" class="template-error" role="alert">{{ error }}</p>
              </form>
              <div class="template-about"><h2>{{ t('关于这个模板') }}</h2><p><Check :size="14" />{{ t('添加后可自由编辑内容') }}</p><p><Check :size="14" />{{ t('以 Markdown 文档保存在工作区') }}</p></div>
              <button class="template-customize" :disabled="disabled" @click="edit()">{{ selected.path ? t('编辑模板') : t('自定义这个模板') }}<ArrowRight :size="15" /></button>
            </aside>
          </div>
          <p v-if="mode === 'preview'" class="template-library-note">{{ t('模板预览 · 只读，尚未添加到文档') }}</p>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.template-library { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; width: 100%; background: var(--paper); color: var(--text); container-type: inline-size; }
.template-library-nav > .template-button { flex-shrink: 0; }
.template-breadcrumb { display: flex; flex: 1; min-width: 0; }
.template-breadcrumb :deep(.breadcrumb) { flex: 1; }
.template-breadcrumb :deep(.breadcrumb > svg) { flex-shrink: 0; display: block; }
.template-breadcrumb-preview :deep(.breadcrumb-current) { flex-shrink: 0; }
.template-library-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.template-library-content { max-width: 1360px; margin: 0 auto; padding: 34px 46px 44px; }
.template-library h1 { margin: 0; font-size: 34px; line-height: 1.4; letter-spacing: -1px; font-weight: 650; overflow-wrap: anywhere; outline: none; }
.template-library h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.template-library p { margin: 0; line-height: 1.7; }
.template-library-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 6px 0 34px; }
.template-library-hero p { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
.template-search { display: flex; align-items: center; gap: 10px; flex: 0 1 330px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--paper); }
.template-search:focus-within { border-color: var(--green); }
.template-search input { flex: 1; min-width: 0; padding: 0; border: 0; outline: none; background: transparent; height: 100%; font-size: 13px; }
.template-search input::-webkit-search-cancel-button { display: none; }
.template-search .icon-button { width: 25px; height: 25px; }
.template-categories { display: flex; align-items: center; gap: 28px; border-bottom: 1px solid var(--line); margin-bottom: 22px; }
.template-categories button { position: relative; padding: 12px 0 15px; border: 0; border-radius: 0; background: transparent; color: var(--muted); font-size: 13px; line-height: 18px; white-space: nowrap; }
.template-categories button.selected { color: var(--text); font-weight: 600; }
.template-categories button.selected::after { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; border-radius: 1px; background: var(--text); content: ''; }
.template-categories button:hover:not(.selected) { color: var(--text); }
.template-collections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 30px; }
.template-collection { position: relative; display: flex; align-items: center; min-height: 148px; padding: 26px; border: 0; border-radius: 6px; text-align: left; overflow: hidden; color: var(--text); isolation: isolate; }
.collection-work { background: color-mix(in srgb, #a6b39a 22%, var(--paper)); }
.collection-life { background: color-mix(in srgb, #d1bd93 21%, var(--paper)); }
.template-collection > div:first-child { position: relative; z-index: 1; }
.template-collection strong { display: block; max-width: 230px; font-size: 20px; line-height: 1.5; font-weight: 600; letter-spacing: -.5px; }
.template-collection span { display: inline-flex; align-items: center; gap: 10px; margin-top: 17px; font-size: 11px; }
.template-collection:hover span { text-decoration: underline; text-underline-offset: 4px; }
.template-collection-pages { position: absolute; pointer-events: none; left: 64%; top: 28px; width: 50%; height: 180px; }
.template-collection-pages :deep(.template-thumbnail) { position: absolute; width: 155px; height: 210px; padding: 0; background: transparent; border: 0; box-shadow: 0 2px 12px #00000006; transform: rotate(-12deg); }
.template-collection-pages :deep(.template-thumbnail + .template-thumbnail) { left: 84px; top: 20px; transform: rotate(10deg); }
.template-collection-pages :deep(.template-mini-page) { min-height: 340px; }
.template-section { margin-bottom: 36px; }
.template-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.template-section-heading > span { color: var(--muted); font-size: 12px; }
.template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px 18px; align-items: start; }
.template-card { display: block; width: 100%; padding: 0; min-width: 0; text-align: left; border: 0; border-radius: 6px; background: transparent; color: var(--text); }
.template-card :deep(.template-thumbnail) { transition: box-shadow .15s; }
.template-card:hover :deep(.template-thumbnail) { box-shadow: 0 0 0 1px var(--control-border); }
.template-card-caption { display: flex; align-items: flex-start; gap: 8px; padding: 11px 2px 0; }
.template-card-caption > svg { flex-shrink: 0; margin-top: 2px; }
.template-card-caption > div { flex: 1; min-width: 0; }
.template-card-caption > span { flex-shrink: 0; color: var(--muted); font-size: 10px; line-height: 22px; }
.template-card-caption strong { display: block; font-size: 13px; line-height: 22px; overflow-wrap: anywhere; }
.template-card-caption p { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.template-button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; padding: 8px 13px; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font-size: 12px; line-height: 18px; }
.template-button:hover:not(:disabled) { background: var(--surface); }
.template-button-primary { background: var(--text); border-color: var(--text); color: var(--paper); }
.template-button-primary:hover:not(:disabled) { background: var(--text-secondary); border-color: var(--text-secondary); }
.template-button:disabled { opacity: .45; }
.template-custom-empty { display: flex; align-items: center; gap: 18px; padding: 28px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); }
.template-custom-empty > svg { flex-shrink: 0; opacity: .7; }
.template-custom-empty > div { flex: 1; }
.template-custom-empty strong { color: var(--text-secondary); font-size: 13px; font-weight: 500; }
.template-custom-empty p { margin-top: 4px; font-size: 12px; }
.template-empty, .template-no-results { text-align: center; padding: 40px 12px; color: var(--muted); }
.template-no-results { display: grid; justify-items: center; gap: 14px; }
.template-no-results p { font-size: 13px; }
.template-library-note { text-align: center; color: var(--muted); font-size: 11px; padding-top: 8px; }
.template-detail-heading { margin: 4px 0 28px; }
.template-detail-heading > p { margin-top: 9px; font-size: 13px; color: var(--muted); }
.template-detail-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; align-items: start; gap: 44px; }
.template-document-stage { background: var(--surface); border: 0; border-radius: 6px; padding: 32px; min-width: 0; }
.template-document-paper { min-height: 720px; padding: 40px 34px 56px; background: var(--paper); box-shadow: 0 2px 14px #00000004; overflow: hidden; overflow-wrap: anywhere; }
.template-document-paper :deep(.tano-editor) { min-height: 0; }
.template-document-paper :deep(.ProseMirror) { min-height: 0; font-size: 13px; line-height: 1.8; padding: 0; }
.template-document-paper :deep(.ProseMirror h1) { font-size: 25px; margin: 0 0 22px; }
.template-document-paper :deep(.ProseMirror h2) { font-size: 17px; margin: 26px 0 12px; }
.template-document-paper :deep(.ProseMirror h3) { font-size: 15px; }
.template-document-paper :deep(.ProseMirror table) { font-size: 12px; }
.template-detail-sidebar { min-width: 0; padding-top: 12px; }
.template-detail-sidebar .template-detail-heading { margin: 0 0 20px; }
.template-detail-category { display: block; color: var(--muted); font-size: 12px; margin-bottom: 18px; }
.template-detail-sidebar h1 { font-size: 32px; }
.template-detail-sidebar .template-detail-heading p { margin-top: 14px; }
.template-author { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 12px; margin: 0 0 28px; }
.template-wide { width: 100%; min-height: 40px; font-size: 13px; margin-bottom: 10px; }
.template-fields { display: grid; gap: 15px; padding-top: 24px; margin-top: 24px; border-top: 1px solid var(--line); }
.template-fields h2 { font-size: 12px; margin-bottom: 2px; }
.template-library label { display: grid; gap: 7px; min-width: 0; font-size: 12px; line-height: 18px; color: var(--text-secondary); }
.template-library input, .template-library textarea { color: var(--text); font-family: inherit; }
.template-fields input, .template-edit-form input, .template-edit-form textarea { width: 100%; min-width: 0; padding: 9px 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); font-size: 13px; line-height: 20px; }
.template-library input:focus-visible, .template-library textarea:focus-visible, .template-library button:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.template-search input:focus-visible { outline: none; }
.template-hint { margin-top: 12px !important; font-size: 11px; color: var(--muted); }
.template-target { display: flex; gap: 7px; margin-top: 3px !important; font-size: 11px; color: var(--muted); }
.template-target svg { flex-shrink: 0; margin-top: 3px; color: var(--green); }
.template-about { margin-top: 28px; padding-top: 23px; border-top: 1px solid var(--line); }
.template-about h2 { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.template-about p { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--muted); font-size: 12px; }
.template-about p svg { flex-shrink: 0; }
.template-customize { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 25px; padding: 20px 0 0; border: 0; border-top: 1px solid var(--line); color: var(--text-secondary); background: transparent; font-size: 12px; }
.template-detail-layout.is-preview { display: block; }
.template-preview-content { max-width: 950px; }
.is-preview .template-document-paper { padding: 44px 54px 60px; }
.is-preview .template-document-paper :deep(.ProseMirror) { font-size: 15px; }
.template-edit-form { display: grid; gap: 20px; max-width: 760px; }
.template-edit-form textarea { resize: vertical; min-height: 280px; font-family: var(--font-mono); font-size: 12px; line-height: 1.8; }
.template-edit-form .template-hint { margin-top: -10px !important; }
.template-edit-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.template-error { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--danger); font-size: 12px; padding: 12px 0; }
@container (max-width: 760px) {
  .template-library-content { padding: 28px; }
  .template-library-hero { align-items: flex-start; flex-direction: column; gap: 22px; padding-bottom: 18px; }
  .template-search { flex: none; width: 100%; max-width: 420px; }
  .template-collection { padding: 20px; min-height: 134px; }
  .template-collection strong { font-size: 17px; max-width: 190px; }
  .template-collection-pages { left: 70%; }
  .template-detail-layout { grid-template-columns: minmax(0, 1fr) 235px; gap: 22px; }
  .template-document-stage { padding: 18px; }
  .template-document-paper { padding: 24px 20px 36px; }
  .template-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 600px) {
  .template-library-nav { padding: 0 16px; gap: 8px; }
  .template-breadcrumb :deep(.breadcrumb-workspace) { display: inline-flex; }
  .template-breadcrumb :deep(.breadcrumb-workspace-label) { display: none; }
  .template-library-content { padding: 24px 18px; }
  .template-library h1 { font-size: 25px; }
  .template-library-hero { padding: 8px 0 20px; }
  .template-categories { gap: 24px; overflow-x: auto; }
  .template-categories button { padding: 12px 0; }
  .template-collections { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .template-collection { min-height: 124px; }
  .template-collection strong { font-size: 20px; max-width: 230px; }
  .template-collection-pages { left: 64%; }
  .template-detail-layout { display: flex; flex-direction: column; gap: 24px; }
  .template-detail-sidebar { order: -1; width: 100%; }
  .template-about, .template-customize { margin-top: 18px; }
  .template-document-stage { width: 100%; padding: 14px; }
  .template-document-paper, .is-preview .template-document-paper { padding: 24px 20px 36px; }
  .template-custom-empty { flex-wrap: wrap; padding: 22px; }
  .template-custom-empty > div { min-width: 160px; }
  .template-button { min-height: 38px; }
}
@container (max-width: 420px) {
  .template-grid { grid-template-columns: minmax(0, 1fr); }
  .template-custom-empty > svg { display: none; }
}
@media (prefers-reduced-motion: reduce) { .template-card :deep(.template-thumbnail) { transition: none; } }
</style>
