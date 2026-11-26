<script setup lang="ts">
import type { Workspace } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import type { WorkbenchActions, WorkbenchExtensions } from '../../runtime';
import { PluginInstaller } from '../../shell/workbench-async-components';

defineProps<{
  workspace: Workspace;
  objectReferencesEnabled: boolean;
  developerMode: boolean;
  extensions: WorkbenchExtensions;
  extensionActions: WorkbenchActions;
}>();

const emit = defineEmits<{
  'enable-developer-mode': [];
  'create-object': [type: string];
}>();
</script>

<template>
  <main class="plugins-tab-page">
    <div class="plugins-tab-content">
      <p v-if="!objectReferencesEnabled" class="tool-level-notice">
        {{ t('「工作区对象与引用」已关闭，插件对象和关系暂时只读。可在工作区设置中重新启用。') }}
      </p>
      <p v-else-if="workspace.readOnly" class="tool-level-notice">
        {{ t('此工作区为只读，无法修改对象和关系。') }}
      </p>
      <PluginInstaller
        :developer-mode="developerMode"
        @enable-developer-mode="emit('enable-developer-mode')"
        @create-object="emit('create-object', $event)"
      >
        <template v-if="extensions.regions['plugin-customize']" #customize="{ developerMode: devMode }">
          <component
            :is="extensions.regions['plugin-customize']"
            :actions="extensionActions"
            :developer-mode="devMode"
          />
        </template>
        <template v-if="extensions.regions['plugin-forge']" #forge="{ canPublish, openPublishing, developerMode: devMode }">
          <component
            :is="extensions.regions['plugin-forge']"
            :actions="extensionActions"
            :can-publish="canPublish"
            :developer-mode="devMode"
            @open-publishing="openPublishing"
          />
        </template>
        <template v-if="extensions.regions['plugin-publishing']" #publishing="{ developerMode: devMode }">
          <component
            :is="extensions.regions['plugin-publishing']"
            :actions="extensionActions"
            :developer-mode="devMode"
          />
        </template>
      </PluginInstaller>
    </div>
  </main>
</template>
