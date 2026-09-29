<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Download, Package, Upload, Check } from 'lucide-vue-next';
import { bundledObjectPlugins, parseObjectPlugin } from '@tano/protocol';
import type { ObjectPluginManifest } from '@tano/protocol';
import type { PluginChange } from '../workspace-plugins';
import { useWorkspaceStore } from '../stores/workspace';
const store = useWorkspaceStore();
const emit = defineEmits<{ objects: [] }>();
const input = ref<HTMLInputElement>();
const manifestText = ref('');
const preview = ref<ObjectPluginManifest>();
const error = ref('');
const status = ref('');
const busy = ref(false);
const query = ref('');
const catalog = computed(() =>
  bundledObjectPlugins.filter((plugin) =>
    `${plugin.name} ${plugin.description}`.includes(query.value),
  ),
);
watch(
  () => store.workspace?.id,
  () => {
    manifestText.value = '';
    preview.value = undefined;
    error.value = '';
    status.value = '';
  },
);
watch(manifestText, () => {
  preview.value = undefined;
});
function inspect() {
  error.value = '';
  status.value = '';
  try {
    preview.value = parseObjectPlugin(manifestText.value);
  } catch (cause) {
    error.value = String(cause);
  }
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  const workspace = store.workspace?.id;
  try {
    if (file.size > 256 * 1024) throw new Error('插件清单不能超过 256 KB');
    const content = await file.text();
    if (store.workspace?.id !== workspace) return;
    manifestText.value = content;
    // Watch invalidation must finish before publishing the inspected preview.
    await nextTick();
    inspect();
  } catch (cause) {
    error.value = String(cause);
  }
}
async function change(value: PluginChange) {
  if (busy.value || !store.workspace) return;
  const workspace = store.workspace.id;
  busy.value = true;
  error.value = '';
  status.value = '';
  try {
    await store.changePlugin(value, workspace);
    if (store.workspace?.id === workspace) {
      status.value =
        'install' in value
          ? `${value.install.name} 已安装并启用`
          : 'uninstall' in value
            ? '插件已卸载，对象和关系文件已保留'
            : value.enabled
              ? '插件已启用'
              : '插件已停用，对象和关系文件已保留';
      if ('install' in value) {
        preview.value = undefined;
        manifestText.value = '';
      }
    }
  } catch (cause) {
    if (store.workspace?.id === workspace) error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="tool-content plugin-installer">
    <div class="tool-intro">
      <div>
        <h3>为工作区添加领域对象</h3>
        <p>六种核心对象始终内置。按需安装论文、数据集、书籍等类型。</p>
      </div>
      <button class="tool-secondary" @click="emit('objects')">管理对象 →</button>
    </div>
    <p class="tool-note">
      安装与启用状态保存在此设备，按工作区生效。当前支持声明式对象与关系插件。
    </p>
    <p v-if="store.pluginError" class="tool-error" role="alert">{{ store.pluginError }}</p>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
    <p v-if="status" class="tool-success" role="status"><Check :size="16" />{{ status }}</p>
    <section aria-label="已安装插件">
      <h3>
        已安装 <span class="tool-count">{{ store.installedPlugins.length }}</span>
      </h3>
      <div v-if="!store.installedPlugins.length" class="tool-empty compact">
        <Package :size="26" />
        <p>还没有安装领域插件</p>
        <small>从下方选择一个，或导入自己的清单。</small>
      </div>
      <article
        v-for="item in store.installedPlugins"
        :key="item.manifest.id"
        class="plugin-installed"
      >
        <div>
          <strong>{{ item.manifest.name }}</strong
          ><span class="tool-badge">{{ item.enabled ? '已启用' : '已停用' }}</span>
          <p>
            {{ item.manifest.id }} · v{{ item.manifest.version }} ·
            {{ item.manifest.objectTypes.length }} 种对象 ·
            {{ item.manifest.relationTypes.length }} 种关系
          </p>
        </div>
        <div class="tool-actions">
          <button
            class="tool-secondary"
            :disabled="busy"
            @click="change({ id: item.manifest.id, enabled: !item.enabled })"
          >
            {{ item.enabled ? '停用' : '启用' }}</button
          ><button
            class="tool-text-button"
            :disabled="busy"
            @click="change({ uninstall: item.manifest.id })"
          >
            卸载
          </button>
        </div>
      </article>
    </section>
    <section aria-label="可安装插件">
      <div class="tool-section-heading">
        <h3>可安装插件 <span class="tool-badge">随应用提供</span></h3>
        <input v-model="query" aria-label="查找插件" placeholder="查找插件" />
      </div>
      <div class="plugin-catalog">
        <article v-for="plugin in catalog" :key="plugin.id" class="plugin-card">
          <Package :size="24" />
          <h4>{{ plugin.name }}</h4>
          <p>{{ plugin.description }}</p>
          <div class="plugin-types">
            <span v-for="type in plugin.objectTypes" :key="type.type" class="tool-badge">{{
              type.label
            }}</span>
          </div>
          <button
            class="tool-primary"
            :disabled="
              busy || store.installedPlugins.some((item) => item.manifest.id === plugin.id)
            "
            @click="change({ install: plugin })"
          >
            <Download :size="15" />{{
              store.installedPlugins.some((item) => item.manifest.id === plugin.id)
                ? '已安装'
                : '安装插件'
            }}
          </button>
        </article>
        <p v-if="!catalog.length" class="tool-note">没有匹配的插件。</p>
      </div>
    </section>
    <details class="plugin-import">
      <summary>导入插件清单</summary>
      <p class="tool-note">导入 JSON 清单即可添加对象字段和关系类型。清单不执行脚本。</p>
      <input ref="input" type="file" accept=".json,application/json" hidden @change="importFile" />
      <button class="tool-secondary" :disabled="busy" @click="input?.click()">
        <Upload :size="15" />选择 JSON 文件
      </button>
      <textarea
        v-model="manifestText"
        aria-label="插件 JSON 清单"
        spellcheck="false"
        placeholder="或粘贴插件 JSON 清单"
        rows="6"
      />
      <button class="tool-secondary" :disabled="!manifestText.trim() || busy" @click="inspect">
        检查清单
      </button>
      <div v-if="preview" class="plugin-preview">
        <strong>{{ preview.name }} · v{{ preview.version }}</strong>
        <p>{{ preview.description }}</p>
        <p>
          {{ preview.objectTypes.map((item) => item.label).join('、') || '无新增对象类型' }} ·
          {{ preview.relationTypes.length }} 种关系
        </p>
        <button class="tool-primary" :disabled="busy" @click="change({ install: preview })">
          {{
            store.installedPlugins.some((item) => item.manifest.id === preview!.id)
              ? '更新并启用插件'
              : '安装此插件'
          }}
        </button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.plugin-installer {
  padding: 24px 26px 28px;
}
.plugin-installer h3 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
}
.tool-intro {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}
.tool-intro p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.tool-note {
  color: var(--muted);
  font-size: 12px;
}
.tool-badge,
.tool-count {
  display: inline-block;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.tool-count {
  margin-left: 5px;
}
.tool-primary,
.tool-secondary,
.tool-text-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.tool-primary {
  background: var(--green-fill);
  color: #fff;
}
.tool-primary:hover:not(:disabled) {
  background: var(--green-hover);
}
.tool-secondary {
  border: 1px solid var(--line);
  background: var(--paper);
}
.tool-text-button {
  color: var(--muted);
}
.tool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tool-error {
  padding: 10px 12px;
  border: 1px solid #c5444430;
  border-radius: 6px;
  background: #c5444410;
  color: #b53939;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.tool-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--green);
  font-size: 13px;
}
.tool-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 15px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  text-align: center;
}
.tool-empty.compact {
  padding: 22px 15px;
}
.tool-empty p {
  margin: 8px 0 4px;
  font-size: 13px;
}
.tool-empty small {
  font-size: 12px;
}
input:not([type='file']),
textarea {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font-size: 13px;
}
.tool-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 20px 0 12px;
}
.tool-section-heading h3 {
  margin: 0;
}
section {
  margin-top: 24px;
}
.plugin-installed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid var(--line);
}
.plugin-installed strong {
  margin-right: 8px;
  font-size: 14px;
}
.plugin-installed p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.plugin-catalog {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.plugin-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.plugin-card > svg {
  color: var(--green);
}
.plugin-card p {
  min-height: 42px;
  margin: 6px 0;
  color: var(--muted);
  font-size: 13px;
}
.plugin-types {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 14px 0 18px;
}
.plugin-import {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.plugin-import summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.plugin-import textarea {
  display: block;
  width: 100%;
  margin: 12px 0;
  font-family: monospace;
  resize: vertical;
}
.plugin-preview {
  margin-top: 16px;
  padding: 16px;
  border-radius: 8px;
  background: var(--surface);
  font-size: 13px;
}
@media (max-width: 700px) {
  .plugin-installer {
    padding: 16px;
  }
  .plugin-catalog {
    grid-template-columns: 1fr;
  }
  .plugin-installed,
  .tool-section-heading {
    flex-wrap: wrap;
  }
}
@media (max-width: 420px) {
  .tool-intro {
    flex-wrap: wrap;
  }
}
</style>
