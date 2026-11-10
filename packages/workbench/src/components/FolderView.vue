<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUp } from 'lucide-vue-next';
import { isDataTableFilePath, isMarkdown, isWorkspaceInternalPath, parentPath, type FileEntry } from '@tano/protocol';
import { uiLocale, t } from '../i18n';
import { indexFolderHomes, type FolderHomeFileName } from '../folder-home';
import DocumentFileIcon from './DocumentFileIcon.vue';
import ResourceIcon from './ResourceIcon.vue';

const props = defineProps<{
  directory: { path: string; name: string; missing: boolean };
  entries: FileEntry[];
  folderHomeFileName?: FolderHomeFileName;
  documentIcons?: Readonly<Record<string, string>>;
  loadDocumentIcon?: (file: FileEntry, signal: AbortSignal) => Promise<string>;
}>();
const emit = defineEmits<{ open: [file: FileEntry]; up: [] }>();
const homes = computed(() => indexFolderHomes(props.entries, props.folderHomeFileName));
const homeFor = (file: FileEntry) => file.kind === 'directory' ? homes.value.get(file.path) : undefined;
const children = computed(() => props.directory.missing ? [] : props.entries
  .filter(file => !isWorkspaceInternalPath(file.path) && parentPath(file.path) === props.directory.path)
  .sort((a, b) => a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1)
    : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })));
const fileType = (file: FileEntry) => file.kind === 'directory' ? t('文件夹') : file.name.includes('.') ? file.name.split('.').at(-1)!.toUpperCase() : t('文件');
const fileSize = (file: FileEntry) => file.kind === 'directory' ? '—' : file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
</script>

<template>
  <section class="folder-view panel-scrollbar" :aria-label="t('文件夹视图')">
    <header class="folder-view-header">
      <h1><ResourceIcon :path="directory.path" kind="directory" :size="22" />{{ directory.name }}</h1>
      <button v-if="directory.path && !directory.missing" type="button" @click="emit('up')"><ArrowUp :size="16" />{{ t('返回上级目录') }}</button>
    </header>
    <p v-if="directory.missing" class="folder-view-empty" role="status">{{ t('文件夹不可用') }}</p>
    <template v-else>
      <div class="folder-view-columns" aria-hidden="true"><span>{{ t('名称') }}</span><span>{{ t('修改时间') }}</span><span>{{ t('类型') }}</span><span>{{ t('大小') }}</span></div>
      <ul class="folder-view-list">
        <li v-for="file in children" :key="file.id">
          <button type="button" class="folder-view-entry" :data-path="file.path" :title="file.name" @click="emit('open', file)">
            <span class="folder-view-name">
              <DocumentFileIcon v-if="homeFor(file)" :file="homeFor(file)!"
                :icon="documentIcons?.[homeFor(file)!.id]" :load="loadDocumentIcon" :resource="{ ...file, folderHome: true }" />
              <DocumentFileIcon v-else-if="file.kind === 'file' && (isMarkdown(file.path) || isDataTableFilePath(file.path))"
                :file="file" :icon="documentIcons?.[file.id]" :load="isMarkdown(file.path) ? loadDocumentIcon : undefined" />
              <ResourceIcon v-else :path="file.path" :name="file.name" :kind="file.kind" />
              <span>{{ file.name }}</span>
            </span>
            <span class="folder-view-date">{{ file.modified ? new Date(file.modified).toLocaleString(uiLocale) : '—' }}</span>
            <span class="folder-view-type">{{ fileType(file) }}</span><span class="folder-view-size">{{ fileSize(file) }}</span>
          </button>
        </li>
      </ul>
      <p v-if="!children.length" class="folder-view-empty" role="status">{{ t('此目录为空') }}</p>
    </template>
  </section>
</template>

<style scoped>
.folder-view { flex: 1; min-height: 0; overflow: auto; padding: 24px 32px; color: var(--text); }
.folder-view-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.folder-view-header h1 { display: flex; align-items: center; gap: 10px; min-width: 0; margin: 0; font-size: 20px; overflow-wrap: anywhere; }
.folder-view-header button { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 7px 10px; border-radius: 6px; }
.folder-view-columns, .folder-view-entry { display: grid; grid-template-columns: minmax(140px, 1fr) 180px 90px 90px; align-items: center; gap: 16px; padding: 10px 12px; }
.folder-view-columns { color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--line); }
.folder-view-list { list-style: none; margin: 6px 0; padding: 0; }
.folder-view-entry { width: 100%; min-height: 44px; text-align: left; border-radius: 6px; font-size: 13px; }
.folder-view-entry:hover, .folder-view-header button:hover { background: var(--hover); }
.folder-view-entry:focus-visible, .folder-view-header button:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; background: var(--hover); }
.folder-view-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
.folder-view-name > :first-child { flex-shrink: 0; color: var(--muted); }
.folder-view-name > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-view-date, .folder-view-type, .folder-view-size { color: var(--muted); }
.folder-view-size { text-align: right; }
.folder-view-empty { padding: 48px 12px; text-align: center; color: var(--muted); }
@media (max-width: 900px) {
  .folder-view { padding: 20px 16px; }
  .folder-view-columns, .folder-view-entry { grid-template-columns: minmax(0, 1fr) 64px; gap: 12px; }
  .folder-view-date, .folder-view-type, .folder-view-columns > :nth-child(2), .folder-view-columns > :nth-child(3) { display: none; }
}
</style>
