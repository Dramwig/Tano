<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import { List, ListTree, Pin, Puzzle, Search, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { vOutlineMotion } from '../outline-motion';
import { workbenchDocumentsKey, workbenchShellKey } from '../../shell/workbench-context';
import PluginSurface from '../../plugins/components/PluginSurface.vue';
import DocumentOutline from './DocumentOutline.vue';

const shell = inject(workbenchShellKey);
const documents = inject(workbenchDocumentsKey);
if (!shell || !documents) throw new Error('Workbench context is required');
const { workspace, store, touchLayout } = toRefs(shell);
const {
  touchOutlineOpen,
  outlineOnLeft,
  hoverOutline,
  outlinePinned,
  outlinePosition,
  openOutlineContextMenu,
  releaseOutlinePointerFocus,
  outlineAutoCollapse,
  outlineSearchOpen,
  setOutlineSearchInput,
  toggleOutlineSearch,
  toggleOutlinePin,
  outlineSearch,
  visibleOutline,
  jumpToHeading,
  outline,
  activeHeading,
} = toRefs(documents);

const documentSidebarViews = computed(() =>
  store.value.pluginViews.filter((view) => view.location === 'documentSidebar'),
);
const activeDocumentSidebarView = computed(() =>
  documentSidebarViews.value.find((view) => view.key === store.value.activeDocumentPluginSidebar),
);
function selectDocumentPluginSidebar(key: string) {
  store.value.activeDocumentPluginSidebar = key;
  const view = documentSidebarViews.value.find((item) => item.key === key);
  if (view) {
    try {
      store.value.openPluginView(view.pluginId, view.id);
    } catch {
      /* Ignore if workspace is switching. */
    }
  }
}
</script>

<template>
  <aside
    v-outline-motion
    class="inspector"
    :style="!activeDocumentSidebarView ? outlinePosition : undefined"
    :class="{
      'inspector-outline': !activeDocumentSidebarView,
      'inspector-outline-left': !activeDocumentSidebarView && outlineOnLeft,
      'inspector-hover-outline':
        !activeDocumentSidebarView && !touchLayout && hoverOutline && !outlinePinned,
      'inspector-activity': !!activeDocumentSidebarView,
    }"
    :aria-label="
      activeDocumentSidebarView
        ? `${activeDocumentSidebarView.pluginName} · ${activeDocumentSidebarView.label}`
        : t('文档目录')
    "
    @contextmenu="openOutlineContextMenu"
    @pointerleave="releaseOutlinePointerFocus"
  >
    <div class="inspector-surface">
      <div v-if="activeDocumentSidebarView || documentSidebarViews.length" class="inspector-tabs">
        <button
          :class="{ active: !activeDocumentSidebarView }"
          @click="store.activeDocumentPluginSidebar = ''"
        >
          <List :size="14" />{{ t('大纲') }}
        </button>
        <button
          v-for="docView in documentSidebarViews"
          :key="docView.key"
          :class="{ active: activeDocumentSidebarView?.key === docView.key }"
          @click="selectDocumentPluginSidebar(docView.key)"
        >
          <Puzzle :size="14" />{{ docView.label }}
        </button>
      </div>
      <PluginSurface
        v-if="activeDocumentSidebarView && workspace"
        :key="`${workspace.id}:${activeDocumentSidebarView.key}`"
        :view="activeDocumentSidebarView"
        :workspace-id="workspace.id"
        :runtime="store.pluginRuntime.find((rt) => rt.id === activeDocumentSidebarView!.pluginId)"
        :execute="store.interactWithPlugin"
        compact
      />
      <template v-else>
        <div class="outline-controls">
          <span>{{ t('文档大纲') }}</span>
          <button
            v-if="touchLayout"
            type="button"
            class="outline-control"
            :aria-label="t('关闭文档大纲')"
            @click="touchOutlineOpen = false"
          >
            <X :size="18" />
          </button>
          <button
            class="outline-control"
            :class="{ active: outlineAutoCollapse }"
            type="button"
            :aria-label="t('自动折叠大纲')"
            :data-tooltip="t('自动折叠大纲')"
            :aria-pressed="outlineAutoCollapse"
            @click="outlineAutoCollapse = !outlineAutoCollapse"
          >
            <ListTree :size="15" />
          </button>
          <button
            class="outline-control"
            :class="{ active: outlineSearchOpen }"
            type="button"
            :aria-label="t('搜索大纲标题')"
            :data-tooltip="t('搜索大纲标题')"
            :aria-expanded="outlineSearchOpen"
            @click="toggleOutlineSearch"
          >
            <Search :size="15" />
          </button>
          <button
            v-if="hoverOutline"
            class="outline-control"
            :class="{ active: outlinePinned }"
            type="button"
            :aria-label="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
            :data-tooltip="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
            :aria-pressed="outlinePinned"
            @click="toggleOutlinePin"
          >
            <Pin :size="15" :fill="outlinePinned ? 'currentColor' : 'none'" />
          </button>
        </div>
        <div v-if="outlineSearchOpen" class="outline-search">
          <Search :size="14" aria-hidden="true" />
          <input
            :ref="setOutlineSearchInput"
            v-model="outlineSearch"
            type="search"
            :aria-label="t('搜索当前文档标题')"
            :placeholder="t('搜索标题')"
            autocomplete="off"
            @keydown.enter="visibleOutline[0] && jumpToHeading(visibleOutline[0].index, true)"
            @keydown.esc.stop.prevent="toggleOutlineSearch"
          />
        </div>
        <DocumentOutline
          :items="visibleOutline"
          :has-headings="!!outline.length"
          :active-index="activeHeading"
          @select="jumpToHeading($event, true)"
        />
      </template>
    </div>
  </aside>
</template>
