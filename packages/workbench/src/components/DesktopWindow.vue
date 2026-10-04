<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Component } from 'vue';
import { Minus, X } from 'lucide-vue-next';
import { getCurrentWindow } from '@tauri-apps/api/window';

defineProps<{ view: Component }>();

const appWindow = getCurrentWindow();
const maximized = ref(false);
let unlistenResize: (() => void) | undefined;
let mounted = false;

async function refreshMaximized() {
  const value = await appWindow.isMaximized();
  if (mounted) maximized.value = value;
}

onMounted(async () => {
  mounted = true;
  await refreshMaximized();
  const unlisten = await appWindow.onResized(() => void refreshMaximized());
  if (mounted) unlistenResize = unlisten;
  else unlisten();
});

onBeforeUnmount(() => {
  mounted = false;
  unlistenResize?.();
});

function drag(event: MouseEvent) {
  if (event.button === 0 && event.detail === 1) void appWindow.startDragging();
}

async function toggleMaximize() {
  await appWindow.toggleMaximize();
  await refreshMaximized();
}
</script>

<template>
  <div class="desktop-window">
    <header class="desktop-window-titlebar">
      <div id="desktop-window-tab-slot" class="desktop-window-tab-slot" />
      <div
        class="desktop-window-drag"
        title="拖动窗口"
        @mousedown="drag"
        @dblclick="toggleMaximize"
      >
        <img src="/favicon-green.svg?v=3" alt="" draggable="false" />
      </div>
      <div class="desktop-window-actions" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" @click="appWindow.minimize()">
          <Minus :size="15" :stroke-width="1.6" />
        </button>
        <button
          type="button"
          :aria-label="maximized ? '还原窗口' : '最大化'"
          :title="maximized ? '还原窗口' : '最大化'"
          @click="toggleMaximize"
        >
          <span
            :class="maximized ? 'desktop-window-restore-icon' : 'desktop-window-maximize-icon'"
            aria-hidden="true"
          />
        </button>
        <button
          class="desktop-window-close"
          type="button"
          aria-label="关闭窗口"
          title="关闭窗口"
          @click="appWindow.close()"
        >
          <X :size="16" :stroke-width="1.5" />
        </button>
      </div>
    </header>
    <div class="desktop-window-content"><component :is="view" /></div>
  </div>
</template>

<style>
.desktop-window {
  --desktop-titlebar-height: 36px;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
}
.desktop-window-titlebar {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: stretch;
  height: var(--desktop-titlebar-height);
  left: 0;
  background: var(--sidebar);
  color: var(--text-secondary);
  user-select: none;
  transition: left 240ms ease;
}
.desktop-window-titlebar::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  border-bottom: 1px solid var(--line);
  pointer-events: none;
}
.desktop-window:has(.app-shell.workspace-empty) .desktop-window-titlebar::after,
.desktop-window:has(.workspace-native-tabs) .desktop-window-titlebar::after {
  display: none;
}
.desktop-window:has(.app-shell.workspace-empty) .desktop-window-titlebar {
  background: transparent;
  box-shadow: none;
}
.desktop-window:has(.app-shell.workspace-empty) .desktop-window-drag img {
  display: none;
}
.desktop-window:has(.app-shell:not(.sidebar-hidden)) .desktop-window-titlebar {
  left: var(--sidebar-width);
}
.desktop-window:has(.app-shell.sidebar-resizing) .desktop-window-titlebar {
  transition: none;
}
.desktop-window-tab-slot:has(.desktop-tab-strip) {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  max-width: calc(100% - 190px);
}
.desktop-sidebar-toggle {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 100%;
  overflow: hidden;
  padding: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  color: var(--text-secondary);
  transition: flex-basis 240ms ease, width 240ms ease, border-color 240ms ease;
}
.desktop-sidebar-toggle-hidden {
  flex-basis: 0;
  width: 0;
  border-right-color: transparent;
}
.desktop-sidebar-toggle:hover {
  background: color-mix(in srgb, var(--paper) 55%, var(--sidebar));
  color: var(--text);
}
.desktop-window-drag {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding-left: 12px;
  font-size: 12px;
  cursor: grab;
}
.desktop-window-drag:active {
  cursor: grabbing;
}
.desktop-window:has(.desktop-tab-strip) .desktop-window-drag {
  min-width: 52px;
  padding-left: 16px;
}
.desktop-window:has(.desktop-tab-strip) .desktop-window-drag img {
  display: none;
}
.desktop-window-drag img {
  width: 15px;
  height: 15px;
  pointer-events: none;
}
.desktop-window-actions {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}
.desktop-window-actions button {
  display: grid;
  place-items: center;
  width: 46px;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--text-secondary);
}
.desktop-window-actions button:hover {
  background: var(--hover);
}
.desktop-window-actions .desktop-window-close:hover {
  background: #d92d20;
  color: #fff;
}
.desktop-window-maximize-icon,
.desktop-window-restore-icon {
  display: block;
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
}
.desktop-window-restore-icon {
  position: relative;
  width: 9px;
  height: 9px;
}
.desktop-window-restore-icon::before {
  content: '';
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  border-top: 1px solid currentColor;
  border-right: 1px solid currentColor;
}
.desktop-window-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.desktop-window-content > .app-shell {
  height: 100%;
  min-height: 0;
}
.desktop-window-content > .app-shell .sidebar-header {
  height: var(--desktop-titlebar-height);
}
.desktop-window-content > .app-shell .main-column {
  --topbar-height: 44px;
  --inspector-top: calc(var(--desktop-titlebar-height) + 44px + 44px + 16px);
  padding-top: var(--desktop-titlebar-height);
}
.desktop-window-content > .app-shell.workspace-empty .main-column {
  padding-top: 0;
}
/* Each pane owns its title strip. Only the native window controls float above
   the top-right strip; blank space in those strips remains a drag handle. */
.desktop-window:has(.workspace-native-tabs) .desktop-window-titlebar {
  z-index: 30;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
}
.desktop-window:has(.workspace-native-tabs) .desktop-window-tab-slot,
.desktop-window:has(.workspace-native-tabs) .desktop-window-drag {
  display: none;
}
.desktop-window:has(.workspace-native-tabs) .desktop-window-actions {
  margin-left: auto;
  /* Leave the pane's bottom separator visible beneath button backgrounds. */
  margin-bottom: 1px;
  background: var(--sidebar);
  pointer-events: auto;
}
.desktop-window-content > .app-shell:has(.workspace-native-tabs) .main-column {
  padding-top: 0;
}
.workspace-native-tabs .workspace-pane {
  --inspector-top: calc(36px + 44px + 44px + 16px);
}
.workspace-native-tabs .workspace-pane-top-right > .workspace-tabbar {
  padding-right: 138px;
}
.workspace-window-drag {
  flex: 1 0 24px;
  min-width: 24px;
  cursor: grab;
}
.workspace-window-drag:active {
  cursor: grabbing;
}
.desktop-window-content > .app-shell .topbar {
  padding-inline: 6px 20px;
}
.desktop-window-content > .app-shell .breadcrumb > svg {
  color: var(--muted);
}
.desktop-window-content > .app-shell .breadcrumb-workspace {
  color: var(--text-secondary);
}
.desktop-window-content > .web-entry {
  min-height: 100%;
  height: 100%;
  overflow-y: auto;
  padding-top: 70px;
}
</style>
