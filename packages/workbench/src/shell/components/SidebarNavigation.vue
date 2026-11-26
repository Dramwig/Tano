<script setup lang="ts">
import { t } from '../../i18n/i18n';
import {
  isOverlaySidebarNavHidden,
  overlaySidebarNavOrderStyle,
} from '../../plugins/overlay-mapping';
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';

const props = withDefaults(
  defineProps<{
    items: readonly { id: string; label: string }[];
    active?: boolean;
    overlayHiddenIds?: readonly string[];
    overlayOrder?: readonly string[];
  }>(),
  { active: true },
);
defineEmits<{ open: [] }>();

function combinedVisible(id: string, groupVisible: (target: string) => boolean): boolean {
  return groupVisible(id) && !isOverlaySidebarNavHidden(id, props.overlayHiddenIds);
}

function orderStyle(id: string) {
  return overlaySidebarNavOrderStyle(id, props.overlayOrder);
}
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
    <slot :is-visible="(id: string) => combinedVisible(id, isVisible)" :order-style="orderStyle" />
  </ButtonVisibilityGroup>
</template>
