<script setup lang="ts">
import { FolderOpen, Search, SquarePen } from 'lucide-vue-next';

defineProps<{ createDisabled?: boolean }>();
defineEmits<{ create: []; open: []; search: [] }>();
</script>

<template>
  <div class="editor-empty">
    <div class="editor-empty-mark" aria-hidden="true" />
    <nav class="editor-empty-actions" aria-label="文档操作">
      <button :disabled="createDisabled" @click="$emit('create')">
        <span><SquarePen :size="14" />新建文档</span>
        <span class="editor-empty-keys" aria-hidden="true"><kbd>Ctrl</kbd><span>+</span><kbd>N</kbd></span>
      </button>
      <button @click="$emit('open')">
        <span><FolderOpen :size="14" />打开文件</span>
        <span class="editor-empty-keys" aria-hidden="true"><kbd>Ctrl</kbd><span>+</span><kbd>O</kbd></span>
      </button>
      <button @click="$emit('search')">
        <span><Search :size="14" />查找文档</span>
        <span class="editor-empty-keys" aria-hidden="true"><kbd>Ctrl</kbd><span>+</span><kbd>K</kbd></span>
      </button>
    </nav>
  </div>
</template>
