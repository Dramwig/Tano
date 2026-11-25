<script setup lang="ts">
import { inject, toRefs } from 'vue';
import {
  AppWindow,
  ArrowDownToLine,
  Blocks,
  Check,
  CopyPlus,
  Eye,
  EyeOff,
  FileOutput,
  FilePlus2,
  FileSliders,
  FileSymlink,
  FileText,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderTree,
  House,
  Link,
  PanelLeftOpen,
  PanelsTopLeft,
  Paperclip,
  Route,
  Table2,
  TextCursorInput,
  Trash2,
} from 'lucide-vue-next';
import ShortcutHint from '@tano/editor/shortcut-hint';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { workbenchContextKey } from '../workbench-context';
import PageDisplayOptions from './PageDisplayOptions.vue';
import PluginMenu from '../../plugins/components/PluginMenu.vue';

const context = inject(workbenchContextKey);
if (!context) throw new Error('Workbench context is required');
const {
  activeWindow,
  workspace,
  isAuxiliaryWindow,
  t,
  store,
  mobile,
  localNative,
  busy,
  switchingWorkspace,
  fileContextMenu,
  multipleContextEntries,
  contextEntries,
  fileContextKeydown,
  selectionDeleteDisabled,
  fileContextAction,
  shortcutHint,
  contextFolderHome,
  folderHomeContextAction,
  fileMutationDisabled,
  directoryHasManagedFile,
  isMarkdown,
  isDataTableFilePath,
  attachments,
  tabsEnabled,
  canDuplicateEntry,
  isWorkspaceInternalPath,
  folderConversionIssue,
  convertDocumentStructure,
  revealedHomeId,
  closeFileContextMenu,
  fileDeleteDisabled,
  directoryContextMenu,
  directoryContextAction,
  directoryContextDuplicateDisabled,
  directoryContextRenameDisabled,
  directoryContextDeleteDisabled,
  workspaceEntryContextMenu,
  workspaceEntryContextKeydown,
  workspaceEntryContextAction,
  pageContextMenu,
  pageContextKeydown,
  workspaceLocked,
  editorPreferences,
  showPageTitle,
  showDocumentProperties,
  showOutline,
  showAllLineNumbers,
  paneSource,
  togglePageOption,
  toggleWorkspaceLock,
  outlineContextMenu,
  outlineContextKeydown,
  outlineOnLeft,
  toggleOutlineSide,
} = toRefs(context);
</script>

<template>
  <Teleport :to="activeWindow.overlays">
    <div
      v-surface-motion="'App:0'"
      v-if="fileContextMenu"
      class="dropdown compact-action-menu file-context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="
        multipleContextEntries
          ? t('{0} 个条目操作', [contextEntries.length])
          : t('{0} 操作', [fileContextMenu.file.name])
      "
      :style="{ left: `${fileContextMenu.x}px`, top: `${fileContextMenu.y}px` }"
      @keydown="fileContextKeydown"
    >
      <template v-if="multipleContextEntries">
        <div class="file-context-count" role="presentation">
          {{ t('已选中') }} {{ contextEntries.length }} {{ t('个条目') }}
        </div>
        <button
          v-if="!mobile && localNative"
          role="menuitem"
          :disabled="selectionDeleteDisabled"
          @click="fileContextAction('duplicate')"
        >
          <CopyPlus :size="15" />{{ t('为所选条目创建副本') }}
        </button>
        <div v-if="!mobile && localNative" class="menu-divider" role="separator" />
        <button role="menuitem" @click="fileContextAction('copy')">
          <Route :size="15" />{{ t('复制相对路径') }}
        </button>
        <button
          v-if="localNative && !mobile"
          role="menuitem"
          @click="fileContextAction('copy-full-path')"
        >
          <FolderTree :size="15" />{{ t('复制完整路径') }}
        </button>
        <div class="menu-divider" role="separator" />
        <button
          class="danger-text"
          role="menuitem"
          :disabled="selectionDeleteDisabled"
          @click="fileContextAction('delete')"
        >
          <Trash2 :size="15" />{{
            store.isDemo
              ? t('删除所选条目')
              : store.isWeb
                ? t('删除所选文档')
                : t('将所选条目移入回收站')
          }}
          <kbd class="menu-shortcut" aria-hidden="true"
            ><ShortcutHint :label="shortcutHint('deleteFile')"
          /></kbd>
        </button>
      </template>
      <template v-else>
        <!-- Open actions precede editing and organization. -->
        <template v-if="fileContextMenu.file.kind === 'directory'">
          <template v-if="contextFolderHome">
            <button role="menuitem" @click="folderHomeContextAction(false)">
              <House :size="15" />{{ t('打开首页') }}
            </button>
            <div class="menu-divider" role="separator" />
          </template>
          <button
            role="menuitem"
            :disabled="fileMutationDisabled(fileContextMenu.file)"
            @click="fileContextAction('document')"
          >
            <FilePlus2 :size="15" />{{ t('在此新建文档') }}
          </button>
          <button
            role="menuitem"
            :disabled="fileMutationDisabled(fileContextMenu.file)"
            @click="fileContextAction('folder')"
          >
            <FolderPlus :size="15" />{{ t('在此新建文件夹') }}
          </button>
          <button
            role="menuitem"
            :disabled="
              fileMutationDisabled(fileContextMenu.file) ||
              directoryHasManagedFile(fileContextMenu.file)
            "
            @click="fileContextAction('rename')"
          >
            <TextCursorInput :size="15" />{{ t('重命名文件夹') }}
            <kbd class="menu-shortcut" aria-hidden="true"
              ><ShortcutHint :label="shortcutHint('renameFile')"
            /></kbd>
          </button>
        </template>
        <template v-else>
          <button
            v-if="
              isMarkdown(fileContextMenu.file.path) ||
              isDataTableFilePath(fileContextMenu.file.path) ||
              attachments
            "
            role="menuitem"
            @click="fileContextAction('open')"
          >
            <Table2 v-if="isDataTableFilePath(fileContextMenu.file.path)" :size="15" />
            <FileText v-else-if="isMarkdown(fileContextMenu.file.path)" :size="15" />
            <Paperclip v-else :size="15" />{{
              isDataTableFilePath(fileContextMenu.file.path)
                ? t('打开数据表')
                : isMarkdown(fileContextMenu.file.path)
                  ? t('打开文档')
                  : t('打开附件')
            }}
          </button>
          <button
            v-if="
              tabsEnabled &&
              (isMarkdown(fileContextMenu.file.path) ||
                isDataTableFilePath(fileContextMenu.file.path))
            "
            role="menuitem"
            @click="fileContextAction('open-new-tab')"
          >
            <PanelsTopLeft :size="15" />{{ t('在新标签页中打开') }}
          </button>
          <button
            v-if="store.hasMarkdownFileHandler(fileContextMenu.file)"
            role="menuitem"
            @click="fileContextAction('open-markdown-source')"
          >
            <FileText :size="15" />{{ t('用 Markdown 源码打开') }}
          </button>
          <div
            v-if="
              isMarkdown(fileContextMenu.file.path) ||
              isDataTableFilePath(fileContextMenu.file.path) ||
              attachments
            "
            class="menu-divider"
            role="separator"
          />
          <button
            v-if="isMarkdown(fileContextMenu.file.path)"
            role="menuitem"
            :disabled="fileMutationDisabled(fileContextMenu.file)"
            @click="fileContextAction('rename')"
          >
            <TextCursorInput :size="15" />{{ t('重命名文档') }}
            <kbd class="menu-shortcut" aria-hidden="true"
              ><ShortcutHint :label="shortcutHint('renameFile')"
            /></kbd>
          </button>
          <button
            v-else-if="attachments || isDataTableFilePath(fileContextMenu.file.path)"
            role="menuitem"
            :disabled="fileMutationDisabled(fileContextMenu.file)"
            @click="fileContextAction('rename')"
          >
            <TextCursorInput :size="15" />{{ t('重命名文件') }}
            <kbd class="menu-shortcut" aria-hidden="true"
              ><ShortcutHint :label="shortcutHint('renameFile')"
            /></kbd>
          </button>
        </template>
        <button
          v-if="canDuplicateEntry(fileContextMenu.file)"
          role="menuitem"
          :disabled="fileMutationDisabled(fileContextMenu.file)"
          @click="fileContextAction('duplicate')"
        >
          <CopyPlus :size="15" />{{ t('创建副本') }}
        </button>
        <button
          v-if="
            fileContextMenu.file.kind === 'file' &&
            isMarkdown(fileContextMenu.file.path) &&
            !isWorkspaceInternalPath(fileContextMenu.file.path)
          "
          role="menuitem"
          :disabled="
            fileMutationDisabled(fileContextMenu.file) ||
            !!folderConversionIssue(fileContextMenu.file, 'child')
          "
          :data-tooltip="
            folderConversionIssue(fileContextMenu.file, 'child') ||
            t('将此文档作为文件夹首页，并新建子文档；相关链接会同步更新。')
          "
          @click="convertDocumentStructure('child')"
        >
          <FolderPlus :size="15" />{{ t('新建子文档') }}
        </button>
        <div class="menu-divider" role="separator" />
        <!-- Copy and export. -->
        <button role="menuitem" @click="fileContextAction('copy')">
          <Route :size="15" />{{ t('复制相对路径') }}
        </button>
        <button
          v-if="
            store.isWeb &&
            fileContextMenu.file.kind === 'file' &&
            (isMarkdown(fileContextMenu.file.path) ||
              isDataTableFilePath(fileContextMenu.file.path))
          "
          role="menuitem"
          @click="fileContextAction('copy-link')"
        >
          <Link :size="15" />{{ t('复制链接') }}
        </button>
        <button
          v-if="localNative && !mobile"
          role="menuitem"
          @click="fileContextAction('copy-full-path')"
        >
          <FolderTree :size="15" />{{
            fileContextMenu.file.kind === 'directory' ? t('复制文件夹路径') : t('复制文件路径')
          }}
        </button>
        <template v-if="fileContextMenu.file.kind === 'file'">
          <button
            v-if="attachments && !isWorkspaceInternalPath(fileContextMenu.file.path)"
            role="menuitem"
            @click="fileContextAction('export')"
          >
            <FileOutput :size="15" />{{ t('导出文件副本') }}
          </button>
        </template>
        <!-- System actions stay together before file information. -->
        <template v-if="localNative && !mobile">
          <div class="menu-divider" role="separator" />
          <button role="menuitem" @click="fileContextAction('open-default')">
            <AppWindow :size="15" />{{ t('使用默认应用打开') }}
          </button>
          <button role="menuitem" @click="fileContextAction('reveal-entry')">
            <FolderSearch :size="15" />{{ t('在系统资源管理器中显示') }}
          </button>
        </template>
        <!-- File information and less frequent folder structure actions. -->
        <template v-if="fileContextMenu.file.kind === 'directory'">
          <div class="menu-divider" role="separator" />
          <template v-if="contextFolderHome">
            <button role="menuitem" @click="folderHomeContextAction(true)">
              <EyeOff v-if="revealedHomeId === contextFolderHome.id" :size="15" />
              <Eye v-else :size="15" />{{
                t(revealedHomeId === contextFolderHome.id ? '隐藏首页文件' : '显示首页文件')
              }}
            </button>
            <button
              role="menuitem"
              :disabled="
                fileMutationDisabled(fileContextMenu.file) ||
                !!folderConversionIssue(fileContextMenu.file, 'flatten')
              "
              :data-tooltip="
                folderConversionIssue(fileContextMenu.file, 'flatten') ||
                t('仅首页会移出，空文件夹将被移除，相关链接会同步更新。')
              "
              @click="convertDocumentStructure('flatten')"
            >
              <FileSymlink :size="15" />{{ t('转为普通文档') }}
            </button>
          </template>
        </template>
        <template v-else-if="!isWorkspaceInternalPath(fileContextMenu.file.path)">
          <div class="menu-divider" role="separator" />
          <button
            v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)"
            role="menuitem"
            @click="fileContextAction('metadata')"
          >
            <FileSliders :size="15" />{{ t('文件属性') }}
          </button>
          <button
            v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)"
            role="menuitem"
            @click="fileContextAction('object')"
          >
            <Blocks :size="15" />{{ t('查看文件对象') }}
          </button>
        </template>
        <PluginMenu
          v-if="fileContextMenu.file.kind === 'file'"
          location="file"
          :file-id="fileContextMenu.file.id"
          @selected="closeFileContextMenu()"
        />
        <template v-if="!fileDeleteDisabled(fileContextMenu.file) || !store.isWeb">
          <div class="menu-divider" role="separator" />
          <button
            class="danger-text"
            role="menuitem"
            :disabled="fileDeleteDisabled(fileContextMenu.file)"
            @click="fileContextAction('delete')"
          >
            <Trash2 :size="15" />{{
              store.isDemo
                ? t('删除')
                : store.isWeb
                  ? fileContextMenu.file.kind === 'directory'
                    ? t('删除在线文件夹')
                    : t('删除在线文档')
                  : t('移入回收站')
            }}
            <kbd class="menu-shortcut" aria-hidden="true"
              ><ShortcutHint :label="shortcutHint('deleteFile')"
            /></kbd>
          </button>
        </template>
      </template>
    </div>
  </Teleport>

  <Teleport :to="activeWindow.overlays">
    <div
      v-surface-motion="'App:1'"
      v-if="directoryContextMenu"
      class="dropdown compact-action-menu file-context-menu directory-context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="t('目录操作')"
      :style="{ left: `${directoryContextMenu.x}px`, top: `${directoryContextMenu.y}px` }"
      @keydown="fileContextKeydown"
    >
      <button
        role="menuitem"
        :disabled="!workspace || workspace.readOnly || busy"
        @click="directoryContextAction('document')"
      >
        <FilePlus2 :size="15" />{{ t('新建文档') }}
      </button>
      <button
        role="menuitem"
        :disabled="!workspace || workspace.readOnly || busy"
        @click="directoryContextAction('folder')"
      >
        <FolderPlus :size="15" />{{ t('新建文件夹') }}
      </button>
      <button
        v-if="!directoryContextMenu.parent"
        role="menuitem"
        :disabled="!workspace || workspace.readOnly || busy"
        @click="directoryContextAction('import')"
      >
        <ArrowDownToLine :size="15" />{{ t('导入') }}
      </button>
      <template v-if="directoryContextMenu.parent">
        <button
          role="menuitem"
          :disabled="directoryContextDuplicateDisabled()"
          @click="directoryContextAction('duplicate')"
        >
          <CopyPlus :size="15" />{{ t('创建副本') }}
        </button>
        <button role="menuitem" @click="directoryContextAction('copy')">
          <Route :size="15" />{{ t('复制相对路径') }}
        </button>
        <div class="menu-divider" role="separator" />
        <button
          role="menuitem"
          :disabled="directoryContextRenameDisabled()"
          @click="directoryContextAction('rename')"
        >
          <TextCursorInput :size="15" />{{ t('重命名文件夹') }}
          <kbd class="menu-shortcut" aria-hidden="true"
            ><ShortcutHint :label="shortcutHint('renameFile')"
          /></kbd>
        </button>
        <button
          class="danger-text"
          role="menuitem"
          :disabled="directoryContextDeleteDisabled()"
          @click="directoryContextAction('delete')"
        >
          <Trash2 :size="15" />{{
            store.isDemo
              ? t('删除文件夹')
              : store.isWeb
                ? t('删除在线文件夹')
                : t('将文件夹移入回收站')
          }}
          <kbd class="menu-shortcut" aria-hidden="true"
            ><ShortcutHint :label="shortcutHint('deleteFile')"
          /></kbd>
        </button>
      </template>
    </div>
  </Teleport>

  <Teleport :to="activeWindow.overlays">
    <div
      v-surface-motion="'App:2'"
      v-if="workspaceEntryContextMenu"
      :ref="(el) => { context.workspaceEntryContextMenuElement = (el as HTMLElement | null) ?? undefined; }"
      class="dropdown compact-action-menu file-context-menu workspace-entry-context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="t('{0} 工作区操作', [workspaceEntryContextMenu.item.name])"
      :style="{ left: `${workspaceEntryContextMenu.x}px`, top: `${workspaceEntryContextMenu.y}px` }"
      @keydown="workspaceEntryContextKeydown"
    >
      <button role="menuitem" :disabled="busy" @click="workspaceEntryContextAction('open')">
        <FolderOpen :size="15" />{{ t('打开工作区') }}
        <Check
          v-if="workspaceEntryContextMenu.item.id === workspace?.id"
          class="workspace-entry-context-check"
          :size="14"
        />
      </button>
      <template v-if="workspaceEntryContextMenu.item.id === workspace?.id">
        <button
          v-if="localNative && !mobile"
          role="menuitem"
          :disabled="busy"
          @click="workspaceEntryContextAction('reveal')"
        >
          <FolderSearch :size="15" />{{ t('在资源管理器中显示') }}
        </button>
      </template>
    </div>
  </Teleport>

  <Teleport :to="activeWindow.overlays">
    <div
      v-surface-motion="'App:6'"
      v-if="pageContextMenu && !switchingWorkspace"
      :ref="(el) => { context.pageContextMenuElement = (el as HTMLElement | null) ?? undefined; }"
      class="dropdown compact-action-menu page-context-menu workspace-options-menu"
      role="menu"
      :aria-label="t('页面显示选项')"
      tabindex="-1"
      :style="{ left: `${pageContextMenu.x}px`, top: `${pageContextMenu.y}px` }"
      @keydown="pageContextKeydown"
    >
      <PageDisplayOptions
        :workspace-locked="workspaceLocked"
        :workspace-available="!!workspace"
        :auto-spacing="editorPreferences.autoSpacing ?? false"
        :show-page-title="showPageTitle"
        :show-document-properties="showDocumentProperties"
        :show-outline="showOutline"
        :show-all-line-numbers="showAllLineNumbers"
        :auxiliary-window="!!isAuxiliaryWindow"
        :source="paneSource(store.activeId)"
        @toggle="togglePageOption"
        @toggle-workspace-lock="toggleWorkspaceLock"
      />
    </div>
  </Teleport>

  <Teleport :to="activeWindow.overlays">
    <div
      v-surface-motion="'App:7'"
      v-if="outlineContextMenu && !switchingWorkspace"
      :ref="(el) => { context.outlineContextMenuElement = (el as HTMLElement | null) ?? undefined; }"
      class="dropdown compact-action-menu page-context-menu outline-context-menu"
      role="menu"
      :aria-label="t('目录显示选项')"
      tabindex="-1"
      :style="{ left: `${outlineContextMenu.x}px`, top: `${outlineContextMenu.y}px` }"
      @keydown="outlineContextKeydown"
    >
      <button
        type="button"
        role="menuitemcheckbox"
        :aria-checked="outlineOnLeft"
        @click="toggleOutlineSide"
      >
        <PanelLeftOpen :size="15" />{{ t('显示在左侧')
        }}<Check v-if="outlineOnLeft" class="page-context-check" :size="14" />
      </button>
    </div>
  </Teleport>
</template>
