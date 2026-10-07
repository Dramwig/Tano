<script setup lang="ts">
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';

withDefaults(defineProps<{ items: readonly { id: string; label: string }[]; active?: boolean }>(), { active: true });
defineEmits<{ open: [] }>();
</script>

<template>
  <ButtonVisibilityGroup
    v-slot="{ isVisible }"
    :items="items"
    :active="active"
    preference-key="tano.preference.sidebarHiddenViews"
    tag="nav"
    group-class="sidebar-navigation"
    label="工作区导航"
    menu-label="导航按钮显示设置"
    @open="$emit('open')"
  >
    <slot :is-visible="isVisible" />
  </ButtonVisibilityGroup>
</template>
