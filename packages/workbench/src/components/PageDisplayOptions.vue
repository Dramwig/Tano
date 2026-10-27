<script setup lang="ts">
import { Check, Space, Heading1, SlidersHorizontal, List, ListOrdered } from 'lucide-vue-next';
import { t } from '../i18n';
defineProps<{
  autoSpacing: boolean;
  showPageTitle: boolean;
  showDocumentProperties: boolean;
  showOutline: boolean;
  showAllLineNumbers: boolean;
  detachedWindow: boolean;
  source: boolean;
}>();
const emit = defineEmits<{ toggle: [option: 'autoSpacing' | 'title' | 'properties' | 'outline' | 'lineNumbers'] }>();
</script>

<template>
  <button
    type="button"
    role="menuitemcheckbox"
    :aria-checked="autoSpacing ?? false"
    @click="emit('toggle', 'autoSpacing')"
  >
    <Space :size="15" />{{ t('正文自动间距') }}<Check
      v-if="autoSpacing"
      class="page-context-check"
      :size="14"
    />
  </button>
  <div class="menu-divider" role="separator" />
  <button
    type="button"
    role="menuitemcheckbox"
    :aria-checked="showPageTitle"
    @click="emit('toggle', 'title')"
  >
    <Heading1 :size="15" />{{ t('页面内标题') }}<Check
      v-if="showPageTitle"
      class="page-context-check"
      :size="14"
    />
  </button>
  <button
    type="button"
    role="menuitemcheckbox"
    :aria-checked="showDocumentProperties"
    @click="emit('toggle', 'properties')"
  >
    <SlidersHorizontal :size="15" />{{ t('文档属性') }}<Check
      v-if="showDocumentProperties"
      class="page-context-check"
      :size="14"
    />
  </button>
  <button
    v-if="!detachedWindow"
    type="button"
    role="menuitemcheckbox"
    :aria-checked="showOutline"
    @click="emit('toggle', 'outline')"
  >
    <List :size="15" />{{ t('显示目录') }}<Check
      v-if="showOutline"
      class="page-context-check"
      :size="14"
    />
  </button>
  <button
    v-if="source"
    type="button"
    role="menuitemcheckbox"
    :aria-checked="showAllLineNumbers"
    @click="emit('toggle', 'lineNumbers')"
  >
    <ListOrdered :size="15" />{{ t('显示所有行号') }}<Check
      v-if="showAllLineNumbers"
      class="page-context-check"
      :size="14"
    />
  </button>
</template>
