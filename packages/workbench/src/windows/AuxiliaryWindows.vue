<script setup lang="ts">
import { computed, inject, watch } from 'vue';
import { workbenchShellKey } from '../shell/workbench-context';
import { layoutPanes } from '../shell/pane-layout';
import AppTooltip from '../shell/components/AppTooltip.vue';
import WorkbenchSettings from '../settings/components/WorkbenchSettings.vue';
import DesktopWindow from '../shell/components/DesktopWindow.vue';
import WorkbenchPanes from '../shell/components/WorkbenchPanes.vue';
import WindowScope from './WindowScope.vue';

const workbench = inject(workbenchShellKey);
if (!workbench) throw new Error('Workbench context is required');
const entries = computed(() => [...workbench.auxiliaryWindows.entries.values()]);
watch(() => entries.value.map(entry => {
  const state = workbench.store.windowLayouts[entry.id];
  const active = state && layoutPanes(state.layout).find(pane => pane.id === state.activePaneId)?.activeId;
  const tab = workbench.store.tabs.find(tab => tab.id === active);
  return { entry, title: tab ? workbench.detachedTitle(tab) + ' — Tano / 同页' : undefined };
}), titles => {
  for (const { entry, title } of titles) {
    if (!title) continue;
    entry.aux.document.title = title;
    void entry.context.native?.setTitle(title).catch(workbench.store.report);
  }
});
</script>

<template>
  <Teleport v-for="entry in entries" :key="entry.id" :to="entry.aux.mount">
    <WindowScope :context="entry.context">
      <AppTooltip />
      <DesktopWindow>
        <WorkbenchSettings v-if="entry.kind === 'settings'" windowed />
        <div v-else class="app-shell sidebar-hidden">
          <div class="main-column"><WorkbenchPanes /></div>
        </div>
      </DesktopWindow>
    </WindowScope>
  </Teleport>
</template>
