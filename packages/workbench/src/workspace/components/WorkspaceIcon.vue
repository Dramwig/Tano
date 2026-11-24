<script setup lang="ts">
import { computed } from 'vue';
import { BookOpen, Cloud, FolderOpen } from 'lucide-vue-next';
import { builtinWorkspaceIcon } from '../workspace-icons';
import { workspaceIconComponents } from '../workspace-icon-components';
import { workspaceEmojiSprite } from '../workspace-emoji';
const props = withDefaults(defineProps<{ icon?: string; size?: number; mode?: 'demo' | 'web' | 'local' }>(), {
  size: 17,
  mode: 'local',
});
const builtin = computed(() => builtinWorkspaceIcon(props.icon));
const emojiSprite = computed(() => props.icon && !props.icon.startsWith('data:') && !props.icon.startsWith('icon:')
  ? workspaceEmojiSprite(props.icon) : undefined);
</script>
<template>
  <img v-if="icon?.startsWith('data:image/png;base64,')" class="workspace-custom-icon" :src="icon" alt="" />
  <component v-else-if="builtin" :is="workspaceIconComponents[builtin.id]" class="workspace-default-icon" :size="size" aria-hidden="true" />
  <span v-else-if="icon && !icon.startsWith('icon:')" class="workspace-emoji-icon" :data-emoji="icon" :style="{ fontSize: `${size}px` }" aria-hidden="true">
    <span v-if="emojiSprite" class="workspace-emoji-sprite" :style="emojiSprite" />
    <template v-else>{{ icon }}</template>
  </span>
  <Cloud v-else-if="mode === 'web'" class="workspace-default-icon" :size="size" aria-hidden="true" />
  <BookOpen v-else-if="mode === 'demo'" class="workspace-default-icon" :size="size" aria-hidden="true" />
  <FolderOpen v-else class="workspace-default-icon" :size="size" aria-hidden="true" />
</template>
<style>
.workspace-default-icon, .workspace-emoji-icon { color: var(--text); }
.workspace-custom-icon { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.workspace-emoji-icon { display: inline-flex; align-items: center; justify-content: center; line-height: 1; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.workspace-emoji-sprite { display: block; flex: none; width: 1em; height: 1em; background-repeat: no-repeat; }
</style>
