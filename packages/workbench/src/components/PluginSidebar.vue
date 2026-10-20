<script setup lang="ts">
import { t } from '../i18n';
import { useWorkspaceStore } from '../stores/workspace';
import PluginView from './PluginView.vue';
import PluginMenu from './PluginMenu.vue';
const store = useWorkspaceStore();
const labels = { get panel() { return t('插件中心'); }, get tab() { return t('标签页'); }, get sidebar() { return t('侧栏'); }, get settings() { return t('设置'); } };
</script>
<template>
  <section class="plugin-sidebar" :aria-label="t('插件工作台')">
    <header><strong>{{ t('插件工作台') }}</strong><button @click="store.openPluginsTab()">{{ t('管理插件') }}</button></header>
    <nav :aria-label="t('插件视图')">
      <button v-for="view in store.pluginViews" :key="view.key" :aria-pressed="view.key === store.activePluginSidebar || view.key === store.activeId"
        @click="store.openPluginView(view.pluginId, view.id)"><span>{{ view.label }}</span><small>{{ view.pluginName }} · {{ labels[view.location ?? 'panel'] }}</small></button>
    </nav>
    <p v-if="!store.pluginViews.length">{{ t('安装插件后，可在这里打开扩展视图。') }}</p>
    <PluginMenu location="workspace" />
    <PluginView v-if="store.activePluginSidebar" :view-key="store.activePluginSidebar" />
  </section>
</template>
<style scoped>
.plugin-sidebar { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: auto; font-size: 12px; }
header { display: flex; justify-content: space-between; align-items: center; padding: 12px; gap: 8px; }
button { border: 0; border-radius: 5px; background: transparent; color: var(--text); font: inherit; padding: 8px; text-align: left; }
nav { padding: 0 8px; display: grid; gap: 3px; }
nav button { display: grid; gap: 4px; }
small, p { color: var(--muted); }
p { padding: 12px; }
button:hover, button[aria-pressed="true"] { background: var(--surface); }
</style>
