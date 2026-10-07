<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Copy, Download } from 'lucide-vue-next';
import type { Workspace } from '@tano/protocol';
import { defaultWorkspaceSettings } from '../workspace-settings';
import type { WorkspaceSettings, WorkspaceSettingsPatch } from '../workspace-settings';
import WorkspaceIconPicker from './WorkspaceIconPicker.vue';

const props = defineProps<{
  workspace: (Pick<Workspace, 'name' | 'path' | 'readOnly'> & { id?: string }) | null;
  settings?: WorkspaceSettings;
  pages?: { id: string; path: string }[];
  mode: 'demo' | 'web' | 'local';
  saving?: boolean;
  error?: string;
  exporting?: boolean;
  exportError?: string;
}>();
const emit = defineEmits<{
  change: [workspaceId: string, patch: WorkspaceSettingsPatch];
  reload: [];
  export: [workspaceId: string];
}>();
const settings = computed(() => props.settings ?? defaultWorkspaceSettings);
const disabled = computed(() => !props.workspace?.id || props.workspace.readOnly || props.saving || !!props.error);
const name = ref(props.workspace?.name ?? '');
const nameBase = ref(settings.value.name);
const nameDirty = ref(false);
const localError = ref('');
const imageInput = ref<HTMLInputElement>();
const copied = ref(false);
let reloadingName = false;
watch(() => props.workspace?.id, () => {
  name.value = props.workspace?.name ?? ''; nameBase.value = settings.value.name;
  nameDirty.value = false; localError.value = ''; copied.value = false;
});
watch(() => [props.workspace?.name, settings.value.name], () => {
  if (!nameDirty.value || name.value.trim() === props.workspace?.name) {
    name.value = props.workspace?.name ?? ''; nameBase.value = settings.value.name; nameDirty.value = false;
  }
});
watch(() => props.error, error => {
  if (reloadingName && !error) { nameBase.value = settings.value.name; reloadingName = false; }
});
function reload() { reloadingName = true; emit('reload'); }
function change(patch: WorkspaceSettingsPatch) {
  if (disabled.value || !props.workspace?.id) return;
  localError.value = '';
  emit('change', props.workspace.id, patch);
}
function saveName() {
  const value = name.value.trim();
  if (!value || [...value].length > 65) { localError.value = '请输入 1–65 个字符的工作区名称。'; return; }
  if (value === props.workspace?.name) return;
  change({ key: 'name', value, previous: nameBase.value });
}
function pickIcon(value: string) {
  change({ key: 'icon', value: value.trim(), previous: settings.value.icon });
}
async function uploadIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (file) await uploadImage(file);
}
async function uploadImage(file: File) {
  if (disabled.value) return;
  const workspaceId = props.workspace?.id;
  const previous = settings.value.icon;
  localError.value = '';
  try {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024)
      throw new Error('请选择不超过 2 MB 的 PNG、JPEG、WebP 或 GIF 图片。');
    const url = URL.createObjectURL(file);
    let value: string;
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法处理图片，请使用表情符号。');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
      value = canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
    if (props.workspace?.id === workspaceId) change({ key: 'icon', value, previous });
  } catch (error) { if (props.workspace?.id === workspaceId) localError.value = String(error instanceof Error ? error.message : error); }
}
async function copyId() {
  try { await navigator.clipboard.writeText(props.workspace!.id!); copied.value = true; }
  catch { localError.value = '无法复制，请选中工作区 ID 手动复制。'; }
}
const sidebarOptions = [
  { key: 'showPlan', label: '显示计划', description: '在侧栏显示计划与日历入口。' },
  { key: 'showGraph', label: '显示关系图谱', description: '在侧栏顶部显示关系图谱入口。' },
  { key: 'showPlugins', label: '显示插件', description: '在侧栏顶部显示插件管理入口。' },
  { key: 'showCollaborationViews', label: '显示协作应用', description: '在在线工作区侧栏显示聊天、收件箱等协作入口。' },
] as const;
</script>

<template>
  <p v-if="error || localError" class="settings-notice" role="alert">{{ error || localError }}
    <button v-if="error" type="button" class="settings-button" @click="reload">重新读取设置</button>
  </p>
  <p v-if="!workspace || workspace.readOnly" class="settings-local-note">{{ !workspace ? '打开工作区后即可设置。' : '当前工作区为只读，可以查看设置和导出内容。' }}</p>
  <section class="settings-section" aria-label="工作区设置">
    <h3>工作区设置</h3>
    <div class="settings-card">
      <form class="settings-row settings-row-with-controls" @submit.prevent="saveName">
        <div>
          <strong><label for="workspace-setting-name">工作区名称</label></strong>
          <p>最多 65 个字符，显示在侧栏和工作区菜单中。</p>
          <p v-if="nameDirty && settings.name !== nameBase">工作区当前名称：{{ workspace?.name }}。重新读取设置后可再次保存你的草稿。</p>
        </div>
        <div class="settings-controls workspace-name-control">
          <input id="workspace-setting-name" v-model="name" class="settings-input" aria-label="工作区名称" :disabled="disabled" @input="nameDirty = true" />
          <button class="settings-button" type="submit" :disabled="disabled || !nameDirty">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </form>
      <div class="settings-row settings-row-with-controls">
        <div><strong>图标</strong><p>选择内置图标、表情符号或上传图片，显示在侧栏和工作区菜单中。</p></div>
        <div class="workspace-icon-setting">
          <div class="settings-controls workspace-icon-controls">
            <WorkspaceIconPicker :key="workspace?.id" :icon="settings.icon" :mode="mode" :disabled="disabled" @select="pickIcon" @upload="imageInput?.click()" @paste-image="uploadImage" />
            <input ref="imageInput" hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传工作区图标" :disabled="disabled" @change="uploadIcon" />
          </div>
        </div>
      </div>
      <div class="settings-row">
        <div><strong>默认打开页面</strong><p>首次打开时进入此页面；已有会话会恢复上次打开的标签页。</p></div>
        <select aria-label="默认打开页面" :value="settings.homePageId" :disabled="disabled" @change="change({ key: 'homePageId', value: ($event.target as HTMLSelectElement).value, previous: settings.homePageId })">
          <option value="">自动选择</option>
          <option v-if="settings.homePageId && !pages?.some(page => page.id === settings.homePageId)" :value="settings.homePageId" disabled>原页面已移除（请重新选择）</option>
          <option v-for="page in pages" :key="page.id" :value="page.id">{{ page.path }}</option>
        </select>
      </div>
    </div>
    <p class="settings-local-note">名称点击保存，其余修改即时保存。{{ mode === 'demo' ? '演示数据仅保存在当前浏览器。' : '' }}<span v-if="saving" role="status">正在保存…</span></p>
  </section>
  <section class="settings-section" aria-label="侧栏">
    <h3>侧栏</h3>
    <div class="settings-card">
      <template v-for="option in sidebarOptions" :key="option.key">
        <div v-if="option.key !== 'showCollaborationViews' || mode === 'web'" class="settings-row">
          <div><strong>{{ option.label }}</strong><p>{{ option.description }}</p></div>
          <button type="button" class="settings-switch" :class="{ on: settings[option.key] }" role="switch" :aria-label="option.label" :aria-checked="settings[option.key]" :disabled="disabled" @click="change({ key: option.key, value: !settings[option.key], previous: settings[option.key] })"><span /></button>
        </div>
      </template>
    </div>
  </section>
  <section class="settings-section" aria-label="导出">
    <h3>导出</h3>
    <div class="settings-card">
      <div class="settings-row"><div><strong>工作区内容</strong><p>将已保存的 Markdown、附件和工作区设置导出为 ZIP，保留文件夹结构。</p></div><button type="button" class="settings-button" :disabled="!workspace?.id || exporting" @click="emit('export', workspace!.id!)"><Download :size="14" />{{ exporting ? '导出中…' : '导出' }}</button></div>
      <slot name="members-export" />
    </div>
    <p v-if="exportError" class="settings-notice" role="alert">{{ exportError }}</p>
  </section>
  <section class="settings-section" aria-label="浏览统计">
    <h3>浏览统计</h3>
    <div class="settings-card">
      <div class="settings-row is-disabled"><div><strong>保存并显示页面浏览统计 <span class="settings-scope">尚未开放</span></strong><p>页面浏览量统计尚未实现，当前不会收集浏览数据。</p></div><button type="button" class="settings-switch" role="switch" aria-label="保存并显示页面浏览统计" aria-checked="false" disabled><span /></button></div>
    </div>
  </section>
  <section class="settings-section" aria-label="人物">
    <h3>人物</h3>
    <div class="settings-card">
      <div class="settings-row"><div><strong>人物目录</strong><p>在工作区对象列表中显示人物；关闭后仍可通过已有引用访问人物。</p></div><button type="button" class="settings-switch" :class="{ on: settings.showPeopleDirectory }" role="switch" aria-label="人物目录" :aria-checked="settings.showPeopleDirectory" :disabled="disabled" @click="change({ key: 'showPeopleDirectory', value: !settings.showPeopleDirectory, previous: settings.showPeopleDirectory })"><span /></button></div>
      <div v-for="label in ['在人物资料中显示近期活动', '人物悬浮卡片']" :key="label" class="settings-row is-disabled"><div><strong>{{ label }} <span class="settings-scope">尚未开放</span></strong><p>{{ label === '人物悬浮卡片' ? '悬停时展示人物资料的卡片尚未实现。' : '人物的编辑与评论活动展示尚未实现。' }}</p></div><button type="button" class="settings-switch" role="switch" :aria-label="label" aria-checked="false" disabled><span /></button></div>
    </div>
  </section>
  <section v-if="workspace?.id" class="settings-section" aria-label="工作区 ID">
    <h3>工作区 ID</h3>
    <div class="settings-card">
      <div class="settings-row settings-row-with-controls"><div><strong>工作区 ID</strong></div><div class="settings-controls workspace-id-control"><code>{{ workspace.id }}</code><button type="button" class="settings-button" :aria-label="copied ? '已复制工作区 ID' : '复制工作区 ID'" @click="copyId"><Check v-if="copied" :size="14" /><Copy v-else :size="14" /></button></div></div>
    </div>
  </section>
</template>

<style>
.workspace-name-control, .workspace-icon-setting { flex: 0 0 268px; max-width: 100%; }
.workspace-name-control input { flex: 1; width: 0; }
.workspace-icon-controls { flex-wrap: wrap; justify-content: flex-end; }
.workspace-id-control code { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; user-select: all; }
</style>
