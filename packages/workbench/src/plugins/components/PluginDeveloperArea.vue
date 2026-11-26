<script setup lang="ts">
import { ref, useSlots, watch } from 'vue';
import { Code2, Hammer, Send, Square, Upload } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import PluginRepositoryStorage from './PluginRepositoryStorage.vue';

const props = defineProps<{
  canPublish?: boolean;
  initialSection?: 'tools' | 'forge' | 'publishing';
}>();
const emit = defineEmits<{
  openImport: [];
}>();

const slots = useSlots();
const store = useWorkspaceStore();

type DevSection = 'tools' | 'forge' | 'publishing';
const section = ref<DevSection>(props.initialSection ?? 'tools');
const publishingOpened = ref(props.initialSection === 'publishing');

watch(
  () => props.initialSection,
  (next) => {
    if (!next) return;
    chooseSection(next);
  },
);

function chooseSection(next: DevSection) {
  if (next === 'forge' && !slots.forge) return;
  if (next === 'publishing' && !slots.publishing) return;
  if (next === 'publishing') publishingOpened.value = true;
  section.value = next;
}

defineExpose({ chooseSection });
</script>

<template>
  <section class="plugin-developer-area" :aria-label="t('插件开发者区')">
    <nav v-if="$slots.forge || $slots.publishing" class="dev-subnav" :aria-label="t('开发者工具导航')">
      <button
        type="button"
        :class="{ active: section === 'tools' }"
        :aria-pressed="section === 'tools'"
        @click="chooseSection('tools')"
      >
        <Code2 :size="14" aria-hidden="true" />{{ t('导入与调试') }}
      </button>
      <button
        v-if="$slots.forge"
        type="button"
        :class="{ active: section === 'forge' }"
        :aria-pressed="section === 'forge'"
        @click="chooseSection('forge')"
      >
        <Hammer :size="14" aria-hidden="true" />{{ t('插件工坊') }}
      </button>
      <button
        v-if="$slots.publishing"
        type="button"
        :class="{ active: section === 'publishing' }"
        :aria-pressed="section === 'publishing'"
        @click="chooseSection('publishing')"
      >
        <Send :size="14" aria-hidden="true" />{{ t('我的投稿') }}
      </button>
    </nav>

    <div v-if="section === 'tools'" class="dev-tools-panel">
      <div class="dev-card">
        <div class="dev-card-copy">
          <h3>{{ t('导入本地插件包') }}</h3>
          <p>{{ t('导入 .tano-plugin.zip 归档包或声明式 JSON 清单，也可载入内置示例或仅缓存到当前设备用于调试。') }}</p>
        </div>
        <button type="button" class="pc-button pc-primary" :aria-label="t('导入插件')" @click="emit('openImport')">
          <Upload :size="15" aria-hidden="true" />{{ t('导入插件包…') }}
        </button>
      </div>

      <div v-if="store.pluginDevelopment.active" class="dev-card dev-watch-card" role="status">
        <div class="dev-card-copy">
          <h3>{{ t('本地开发监听运行中') }}</h3>
          <p>
            <code>{{ store.pluginDevelopment.pluginId }}</code> · {{ store.pluginDevelopment.message }}
          </p>
        </div>
        <div class="dev-card-actions">
          <button
            v-if="store.pluginDevelopment.pluginId"
            type="button"
            class="pc-button pc-secondary"
            @click="store.openPluginDetail(store.pluginDevelopment.pluginId)"
          >
            {{ t('查看详情') }}
          </button>
          <button
            type="button"
            class="pc-button pc-secondary"
            @click="store.stopPluginDevelopment()"
          >
            <Square :size="13" aria-hidden="true" />{{ t('停止自动重载') }}
          </button>
        </div>
      </div>

      <PluginRepositoryStorage />
    </div>

    <div v-if="$slots.forge && section === 'forge'" class="dev-slot-panel">
      <slot
        name="forge"
        :can-publish="Boolean(canPublish && $slots.publishing)"
        :developer-mode="true"
        :open-publishing="() => chooseSection('publishing')"
      />
    </div>

    <div v-if="$slots.publishing && publishingOpened" v-show="section === 'publishing'" class="dev-slot-panel">
      <slot name="publishing" :developer-mode="true" />
    </div>
  </section>
</template>

<style scoped>
.plugin-developer-area {
  display: grid;
  gap: 16px;
}
.dev-subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dev-subnav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--muted);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.dev-subnav button.active {
  color: var(--text);
  border-color: var(--text);
  background: var(--surface);
  font-weight: 500;
}
.dev-tools-panel {
  display: grid;
  gap: 12px;
}
.dev-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
.dev-card-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.dev-card-copy h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.dev-card-copy p {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}
.dev-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
