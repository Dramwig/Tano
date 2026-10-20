<script setup lang="ts">
import { t } from '../i18n';
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
    :label="t('工作区导航')"
    :menu-label="t('导航按钮显示设置')"
    @open="$emit('open')"
  >
    <slot :is-visible="isVisible" />
  </ButtonVisibilityGroup>
</template>
