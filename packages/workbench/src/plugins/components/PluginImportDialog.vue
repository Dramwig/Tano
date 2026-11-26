<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Check, Download, Upload } from 'lucide-vue-next';
import {
  checkPluginCompatibility,
  isPluginArchiveV2Bytes,
  parsePluginPackage,
  PLUGIN_ARCHIVE_V2_LIMIT,
  pluginPackageLimit,
  unpackPluginArchiveV2,
} from '@tano/protocol';
import type { PluginManifest, PluginPackage } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { isAppearanceOnlyPlugin, userScopeUnsupportedReason } from '../user-plugins';
import { usePluginActions } from '../use-plugin-actions';
import { documentOverviewPlugin } from '../example';
import PluginChangeSummary from './PluginChangeSummary.vue';
import PluginDialog from './PluginDialog.vue';

const emit = defineEmits<{
  close: [];
  installed: [];
  feedback: [status: string, error: string];
}>();

const store = useWorkspaceStore();
const { error, status, busy, change } = usePluginActions();
const input = ref<HTMLInputElement>();
const manifestText = ref('');
const preview = ref<PluginManifest>();
const previewPackage = ref<PluginPackage>();
const previewBinaryAssets = ref<Record<string, Uint8Array>>();
const importScope = ref<'workspace' | 'user'>('workspace');
let importSequence = 0;

const installedById = computed(
  () => new Map(store.installedPlugins.map((item) => [item.manifest.id, item])),
);
const importUserReason = computed(() =>
  preview.value ? userScopeUnsupportedReason(preview.value) : undefined,
);
const importCompat = computed(() =>
  preview.value
    ? checkPluginCompatibility(preview.value, store.pluginHostEnvironment)
    : { compatible: true },
);
const feedbackError = computed(() => error.value || store.pluginError);

watch([status, error], ([message, failure]) => emit('feedback', message, failure));
watch(status, (value) => {
  if (!value) return;
  emit('installed');
  emit('close');
});
watch(
  () => store.workspace?.id,
  () => {
    importSequence++;
    emit('close');
  },
);
watch(manifestText, () => {
  preview.value = undefined;
  previewPackage.value = undefined;
  previewBinaryAssets.value = undefined;
});

function closeDialog() {
  if (busy.value) return;
  importSequence++;
  emit('close');
}

function inspect() {
  error.value = '';
  status.value = '';
  preview.value = undefined;
  try {
    previewPackage.value = parsePluginPackage(manifestText.value);
    preview.value = previewPackage.value.manifest;
    importScope.value =
      isAppearanceOnlyPlugin(preview.value) && !userScopeUnsupportedReason(preview.value)
        ? 'user'
        : 'workspace';
  } catch (cause) {
    error.value =
      cause instanceof SyntaxError
        ? t('JSON 格式有误，请检查引号、逗号和括号后重试。')
        : String(cause);
  }
}

async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  preview.value = undefined;
  error.value = '';
  status.value = '';
  const workspace = store.workspace?.id;
  const sequence = ++importSequence;
  try {
    const lowerName = typeof file.name === 'string' ? file.name.toLowerCase() : '';
    const isZip = lowerName.endsWith('.zip') || lowerName.endsWith('.tano-plugin');
    if (file.size > (isZip ? PLUGIN_ARCHIVE_V2_LIMIT : pluginPackageLimit)) {
      throw new Error(isZip ? t('插件归档包不能超过 16 MiB') : t('插件包不能超过 4 MiB'));
    }
    let content: string;
    let unpackedBinaryAssets: Record<string, Uint8Array> | undefined;
    if (typeof file.arrayBuffer === 'function') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isPluginArchiveV2Bytes(bytes)) {
        const archive = unpackPluginArchiveV2(bytes);
        content = JSON.stringify(archive.pkg);
        if (Object.keys(archive.binaryAssets).length) {
          unpackedBinaryAssets = archive.binaryAssets;
        }
      } else {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
    } else {
      content = await file.text();
    }
    if (store.workspace?.id !== workspace || sequence !== importSequence) return;
    manifestText.value = content;
    await nextTick();
    if (store.workspace?.id === workspace && sequence === importSequence) {
      previewBinaryAssets.value = unpackedBinaryAssets;
      inspect();
    }
  } catch (cause) {
    if (store.workspace?.id === workspace && sequence === importSequence)
      error.value = String(cause);
  }
}

async function importCachedPackage() {
  try {
    await store.cachePluginPackage(manifestText.value, previewBinaryAssets.value);
    status.value = t('插件包已保存到此设备，请在详情中授权运行');
    await store.refresh();
  } catch (cause) {
    error.value = String(cause);
  }
}
</script>

<template>
  <Teleport to="body">
    <PluginDialog :title="t('导入插件')" :busy="busy" @close="closeDialog">
      <p v-if="feedbackError" class="pc-feedback error" role="alert">{{ feedbackError }}</p>
      <p v-if="status" class="pc-feedback success" role="status">
        <Check :size="16" />{{ status }}
      </p>
      <p class="dialog-intro">
        {{ t('导入声明式清单或代码插件包。管理员为工作区安装，成员可补充此设备缺少的插件包。') }}
      </p>
      <button
        class="pc-button pc-secondary"
        @click="manifestText = JSON.stringify(documentOverviewPlugin, null, 2)"
      >
        {{ t('载入文档总览示例') }}
      </button>
      <input
        ref="input"
        type="file"
        accept=".json,.zip,.tano-plugin,application/json,application/zip"
        hidden
        @change="importFile"
      />
      <button class="import-file" :disabled="busy" @click="input?.click()">
        <Upload :size="25" /><strong>{{ t('选择插件包文件') }}</strong>
        <span>{{ t('支持 .json 或 .tano-plugin.zip 文件') }}</span>
      </button>
      <label class="manifest-label" for="plugin-manifest">{{ t('或粘贴插件清单') }}</label>
      <textarea
        id="plugin-manifest"
        v-model="manifestText"
        :aria-label="t('插件 JSON 清单')"
        :disabled="busy"
        spellcheck="false"
        :placeholder="t('在此粘贴 JSON 内容…')"
        rows="6"
      />
      <div class="import-check">
        <span>{{ t('代码插件需要单独授权；导入和检查不会执行脚本。') }}</span>
        <button
          class="pc-button pc-secondary"
          :disabled="!manifestText.trim() || busy"
          @click="inspect"
        >
          {{ t('检查清单') }}
        </button>
      </div>
      <div v-if="preview" class="plugin-preview">
        <div>
          <Check :size="17" /><strong>{{ preview.name }}</strong>
          <span>v{{ preview.version }}</span>
        </div>
        <p>{{ preview.description }}</p>
        <PluginChangeSummary
          :before="installedById.get(preview.id)?.manifest"
          :after="preview"
          :workspace="store.workspace?.name"
        />
        <p>
          {{ preview.objectTypes.map((item) => item.label).join('、') || t('无新增对象类型') }} ·
          {{ preview.relationTypes.length }} {{ t('种关系') }}
        </p>
        <label class="import-scope">
          {{ t('安装范围') }}
          <select v-model="importScope" :aria-label="t('插件安装范围')" :disabled="busy">
            <option value="workspace">{{ t('当前工作区（随工作区同步）') }}</option>
            <option value="user" :disabled="!!importUserReason">
              {{ t('全局插件（跨工作区生效）') }}
            </option>
          </select>
        </label>
        <p v-if="!importCompat.compatible" class="pc-feedback error" role="alert">
          {{ importCompat.reason }}
        </p>
        <p v-if="importUserReason" class="dialog-intro">{{ importUserReason }}</p>
        <button
          class="pc-button pc-primary"
          :disabled="busy || (importScope === 'workspace' ? !store.canManagePlugins : !!importUserReason)"
          @click="
            change({
              install: preview,
              package: previewPackage,
              binaryAssets: previewBinaryAssets,
              scope: importScope,
            })
          "
        >
          <Download :size="15" />{{
            installedById.has(preview.id) ? t('更新并启用插件') : t('安装此插件')
          }}
        </button>
        <button
          v-if="preview.manifestVersion === 2"
          class="pc-button pc-secondary"
          :disabled="busy"
          @click="importCachedPackage"
        >
          {{ t('仅保存到此设备') }}
        </button>
      </div>
    </PluginDialog>
  </Teleport>
</template>

<style scoped>
@layer components {
.pc-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
}
.pc-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.pc-button svg {
  flex: none;
}
.pc-primary {
  color: var(--on-accent, #fff);
  background: var(--green-fill);
}
.pc-primary:hover:not(:disabled) {
  background: var(--green-fill-hover);
}
.pc-secondary {
  border-color: var(--line);
  color: var(--text-secondary);
  background: var(--paper);
}
.pc-secondary:hover:not(:disabled) {
  background: var(--surface);
  border-color: var(--control-border, var(--line));
}
.pc-feedback {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pc-feedback svg {
  flex: none;
}
.pc-feedback.error {
  background: var(--danger-bg);
  color: var(--danger);
}
.pc-feedback.success {
  color: var(--green);
}
.dialog-intro {
  margin: 0 0 18px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
}
.import-file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding: 24px;
  border: 1px dashed var(--control-border);
  border-radius: 10px;
  color: var(--green);
  background: var(--surface);
  cursor: pointer;
}
.import-file:hover:not(:disabled) {
  border-color: var(--green);
  background: var(--accent);
}
.import-file strong {
  font-size: 13px;
  font-weight: 500;
}
.import-file span {
  color: var(--muted);
  font-size: 11px;
}
.manifest-label {
  display: block;
  margin: 22px 0 8px;
  font-size: 12px;
  font-weight: 500;
}
#plugin-manifest {
  display: block;
  width: 100%;
  min-height: 140px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--text);
  font: 12px/1.7 var(--font-mono);
  resize: vertical;
  box-sizing: border-box;
}
.import-check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.import-check > span {
  color: var(--muted);
  font-size: 11px;
}
.plugin-preview {
  margin-top: 20px;
  padding: 18px;
  border-radius: 10px;
  background: var(--accent);
  font-size: 12px;
}
.plugin-preview > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--green);
}
.plugin-preview p {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.import-scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  color: var(--text);
  font-size: 12px;
}
.import-scope select {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
}
}
</style>
