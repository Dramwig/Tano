<script setup lang="ts">
import { computed } from 'vue';
import type { FileEntry, ReferenceIdentity } from '@tano/protocol';
import { t } from '../i18n';
import { useWorkspaceStore } from '../stores/workspace';
import LoadingSkeleton from './LoadingSkeleton.vue';
import WorkspaceViewPage from './WorkspaceViewPage.vue';
const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{
  'open-file': [file: FileEntry];
  'edit-document-properties': [file: FileEntry];
  'open-object': [identity: ReferenceIdentity];
}>();
const store = useWorkspaceStore();
const record = computed(() => store.workspaceViews.find(record => `workspace-view:${record.view.id}` === props.tabId));
</script>

<template>
  <LoadingSkeleton v-if="store.workspaceLoading.views" variant="document" :rows="6" />
  <WorkspaceViewPage v-else-if="record" :view="record.view"
    @open-file="emit('open-file', $event)" @edit-document-properties="emit('edit-document-properties', $event)"
    @open-object="emit('open-object', $event)" />
  <p v-else role="status">{{ t('视图已不存在') }}</p>
</template>
