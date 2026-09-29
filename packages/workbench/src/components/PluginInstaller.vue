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
