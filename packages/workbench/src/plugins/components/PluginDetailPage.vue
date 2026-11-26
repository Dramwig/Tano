<script setup lang="ts">
import './plugin-center.css';
import { computed, ref, watch } from 'vue';
import { ArrowUpRight, Download, LoaderCircle, ShieldCheck } from 'lucide-vue-next';
import { checkPluginCompatibility, type PluginMode } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { bundledPluginCatalog } from '../plugin-catalog';
import { pluginPermissionLabels as permissionLabels } from '../plugin-permissions';
import { userScopeUnsupportedReason } from '../user-plugins';
import { usePluginActions } from '../use-plugin-actions';
import PluginIcon from './PluginIcon.vue';
import PluginMaintenance from './PluginMaintenance.vue';
import PluginSettingsForm from './PluginSettingsForm.vue';
const props = defineProps<{ pluginId: string }>();
const store = useWorkspaceStore();
const detail = computed(
  () =>
    store.installedPlugins.find((item) => item.manifest.id === props.pluginId)?.manifest ??
    bundledPluginCatalog.find((item) => item.manifest.id === props.pluginId)?.manifest,
);
const {
  error,
  status,
  busy,
  selectedInstallation,
  policyMode,
  settingsText,
  sourceUrl,
  pathScopesText,
  change,
  authorize,
  savePolicy,
  saveUserSettings,
  installFromCatalog,
} = usePluginActions(detail);
const userScopeBlocked = computed(() => (detail.value ? userScopeUnsupportedReason(detail.value) : undefined));
const compatibility = computed(() =>
  detail.value ? checkPluginCompatibility(detail.value, store.pluginHostEnvironment) : { compatible: true },
);
const settingsSchema = computed(() =>
  detail.value?.manifestVersion === 2 ? detail.value.settingsSchema : undefined,
);
const detailViews = computed(() =>
  detail.value?.manifestVersion === 2
    ? detail.value.views.map((view) => ({
        ...view,
        pluginId: props.pluginId,
        key: `plugin:${props.pluginId}:${view.id}`,
      }))
    : [],
);
const commands = computed(() => (detail.value?.manifestVersion === 2 ? detail.value.commands : []));
const fileHandlers = computed(() => (detail.value?.manifestVersion === 2 ? (detail.value.fileHandlers ?? []) : []));
const tabKeys = { details: '详细信息', features: '功能', permissions: '权限', settings: '设置' };
const tabs = computed(() => [
  '详细信息',
  ...(detailViews.value.length || commands.value.length || fileHandlers.value.length ? ['功能'] : []),
  ...(detail.value?.manifestVersion === 2 ? ['权限'] : []),
  ...(selectedInstallation.value && !selectedInstallation.value.system ? ['设置'] : []),
]);
const active = ref('详细信息');
watch(tabs, (values) => {
  if (!values.includes(active.value)) active.value = values[0];
});
const modeLabels: Record<PluginMode, string> = {
  get required() {
    return t('必需');
  },
  get recommended() {
    return t('推荐');
  },
  get optional() {
    return t('允许自行启用');
  },
  get disabled() {
    return t('禁止');
  },
};
</script>
<template>
  <article v-if="detail" class="plugin-detail-page">
    <p v-if="error || store.pluginError" role="alert">{{ error || store.pluginError }}</p>
    <p v-if="status" role="status">{{ status }}</p>

    <div class="detail-heading">
      <PluginIcon :id="detail.id" />
      <div>
        <h3>{{ detail.name }}</h3>
        <p>
          v{{ detail.version }} · {{ detail.id
          }}<span v-if="selectedInstallation?.system"> · {{ t('系统插件') }}</span>
          <span v-else-if="selectedInstallation?.scope === 'user'"> · {{ t('全局插件') }}</span>
          <span v-else-if="selectedInstallation"> · {{ t('工作区插件') }}</span>
        </p>
      </div>
      <span
        v-if="selectedInstallation"
        class="plugin-state"
        :class="{ enabled: selectedInstallation.enabled }"
        >{{ selectedInstallation.enabled ? t('已启用') : t('已停用') }}</span
      >
    </div>
    <p v-if="!compatibility.compatible" role="alert" class="dialog-intro">
      {{ compatibility.reason }}
    </p>
    <p v-if="selectedInstallation?.shadowedUserPlugin" role="status" class="dialog-intro">
      {{ t('当前工作区已锁定此插件版本，正在优先使用工作区版本；切换到其他工作区后恢复你的全局版本。') }}
    </p>
    <footer class="detail-footer">
      <template v-if="selectedInstallation"
        ><button
          v-if="!selectedInstallation.system"
          class="pc-button pc-text uninstall"
          :disabled="busy || (selectedInstallation.scope !== 'user' && !store.canManagePlugins)"
          @click="change({ uninstall: detail.id })"
        >
          {{ t('卸载插件') }}</button
        ><button
          class="pc-button pc-secondary"
          :disabled="
            busy ||
            selectedInstallation.rule?.mode === 'required' ||
            selectedInstallation.rule?.mode === 'disabled'
          "
          @click="change({ id: detail.id, enabled: !selectedInstallation.enabled })"
        >
          {{ selectedInstallation.enabled ? t('停用插件') : t('启用插件') }}
        </button></template
      ><template v-else>
        <button
          class="pc-button pc-primary"
          :disabled="busy || !store.canManagePlugins"
          @click="installFromCatalog(detail, 'workspace')"
        >
          <Download v-if="!busy" :size="15" /><LoaderCircle v-else class="pc-spin" :size="15" />{{
            busy ? t('正在安装…') : t('安装插件')
          }}
        </button>
        <button
          v-if="!userScopeBlocked"
          class="pc-button pc-secondary"
          :disabled="busy"
          @click="installFromCatalog(detail, 'user')"
        >
          {{ t('安装为全局插件') }}
        </button>
      </template>
    </footer>
    <nav class="center-nav" :aria-label="t('插件详情')">
      <button
        v-for="tab in tabs"
        :key="tab"
        :class="{ active: active === tab }"
        :aria-pressed="active === tab"
        @click="active = tab"
      >
        {{ t(tab) }}
      </button>
    </nav>
    <section v-if="active === tabKeys.details">
      <p class="detail-description">
        {{ detail.description || t('为当前工作区添加自定义对象与关系。') }}
      </p>
      <section v-if="detail.appearance" class="detail-section">
        <h4>{{ t('主题与图标') }}</h4>
        <p v-for="color in detail.appearance.colors" :key="color.id">
          {{ t('配色主题') }}：{{ color.label }}
        </p>
        <p v-for="icons in detail.appearance.icons" :key="icons.id">
          {{ t('文件与目录图标') }}：{{ icons.label }}
        </p>
        <p
          v-for="iconRef in (detail.appearance.iconRefs ?? []).filter((ref) => !detail?.appearance?.icons?.some((item) => item.id === ref.id))"
          :key="iconRef.id"
        >
          {{ t('文件与目录图标') }}：{{ iconRef.label }}
        </p>
        <p v-for="layout in detail.appearance.layouts" :key="layout.id">
          {{ t('布局风格') }}：{{ layout.label }}
        </p>
        <p v-for="shape in detail.appearance.shapes" :key="shape.id">
          {{ t('形态与密度') }}：{{ shape.label }}
        </p>
        <p v-for="preset in detail.appearance.presets" :key="preset.id">
          {{ t('主题预设') }}：{{ preset.label }}
        </p>
        <p>
          {{
            t('安装后在设置 → 外观应用预设，或分别选择配色、图标、布局和形态。未指定的项保持当前。')
          }}
        </p>
      </section>
      <section class="detail-section">
        <h4>
          {{ t('扩展对象') }} <span>{{ detail.objectTypes.length }}</span>
        </h4>
        <div v-for="type in detail.objectTypes" :key="type.type" class="detail-type">
          <strong>{{ type.label }}</strong>
          <p>{{ type.fields?.map((field) => field.label).join('、') || t('无额外字段') }}</p>
        </div>
        <p v-if="!detail.objectTypes.length" class="dialog-intro">
          {{ t('此插件没有新增对象类型。') }}
        </p>
      </section>
      <section class="detail-section">
        <h4>
          {{ t('连接关系') }} <span>{{ detail.relationTypes.length }}</span>
        </h4>
        <div class="detail-relations">
          <span v-for="relation in detail.relationTypes" :key="relation.type">{{
            relation.label
          }}</span
          ><span v-if="!detail.relationTypes.length">{{ t('无新增关系类型') }}</span>
        </div>
      </section>
    </section>
    <section v-if="active === tabKeys.permissions">
      <section v-if="detail.manifestVersion === 2" class="detail-section">
        <h4>{{ t('运行权限') }}</h4>
        <p>
          {{
            detail.permissions.map((permission) => permissionLabels[permission]).join('、') ||
            t('仅显示插件界面')
          }}
        </p>
        <p v-if="detail.networkOrigins.length">
          {{ t('网络来源：') }}{{ detail.networkOrigins.join('、') }}
        </p>
        <p v-if="detail.nativeCommands.length">
          {{ t('本机能力：') }}{{ detail.nativeCommands.join('、') }}
        </p>
        <p class="dialog-intro">
          {{
            selectedInstallation?.system
              ? t('随应用提供，默认启用，无需单独授权；版本随应用更新。')
              : t('授权绑定当前内容摘要；更新后需要重新授权。')
          }}
        </p>
        <button
          v-if="selectedInstallation && !selectedInstallation.system"
          class="pc-button pc-secondary"
          @click="authorize(!selectedInstallation.authorized)"
        >
          {{ selectedInstallation.authorized ? t('撤销此设备授权') : t('授权此版本运行') }}
        </button>
        <button
          v-if="
            selectedInstallation?.scope === 'user' &&
            !selectedInstallation.globallyAuthorized &&
            store.canManagePlugins
          "
          class="pc-button pc-secondary"
          @click="authorize(true, { allWorkspaces: true })"
        >
          {{ t('在我的全部个人工作区授权此版本') }}
        </button>
        <p v-if="selectedInstallation?.globallyAuthorized" class="dialog-intro">
          {{ t('此精确版本已授权在你可管理的个人工作区自动运行；非管理员的团队工作区仍需单独授权。') }}
        </p>
        <p
          v-if="selectedInstallation?.scope === 'user' && selectedInstallation.personalCodePolicy === 'block'"
          role="alert"
          class="dialog-intro"
        >
          {{ t('当前工作区管理员策略禁止个人代码插件运行。') }}
        </p>
        <p
          v-else-if="selectedInstallation?.scope === 'user' && selectedInstallation.personalCodePolicy === 'read-only'"
          role="status"
          class="dialog-intro"
        >
          {{ t('当前工作区管理员策略仅允许个人代码插件只读访问，所有写入操作将被拦截。') }}
        </p>
      </section>
    </section>
    <section v-if="active === tabKeys.settings">
      <section
        v-if="selectedInstallation?.scope === 'user'"
        class="detail-section plugin-policy"
      >
        <h4>{{ t('全局插件设置') }}</h4>
        <p>{{ t('此插件为全局安装，跨工作区生效；设置保存在当前设备的应用数据中，不写入工作区文件。') }}</p>
        <PluginSettingsForm v-if="settingsSchema?.length" v-model="settingsText" :schema="settingsSchema" :disabled="busy" />
        <label v-else
          >{{ t('个人设置')
          }}<textarea
            v-model="settingsText"
            :aria-label="t('插件个人设置')"
            rows="4"
            spellcheck="false"
          />
        </label>
        <label v-if="detail.manifestVersion === 2"
          >{{ t('限制可访问目录（可选，每行一个目录前缀）')
          }}<textarea
            v-model="pathScopesText"
            :aria-label="t('插件目录权限范围')"
            :placeholder="t('例如：日报/')"
            rows="2"
            spellcheck="false"
          />
        </label>
        <button class="pc-button pc-secondary" :disabled="busy" @click="saveUserSettings">
          {{ t('保存全局设置') }}
        </button>
      </section>
      <section
        v-else-if="selectedInstallation?.rule && !selectedInstallation.system && store.canManagePlugins"
        class="detail-section plugin-policy"
      >
        <h4>{{ t('工作区规则') }}</h4>
        <p>
          {{
            t(
              '保存后影响此工作区的所有成员。必需仍需成员各自授权代码；禁止会在成员同步后停止运行，共享设置变更会重新启动已授权实例。',
            )
          }}
        </p>
        <label
          >{{ t('启用方式')
          }}<select v-model="policyMode" :aria-label="t('插件工作区规则')">
            <option value="required">{{ t('必需') }}</option>
            <option value="recommended">{{ t('推荐') }}</option>
            <option value="optional">{{ t('允许自行启用') }}</option>
            <option value="disabled">{{ t('禁止') }}</option>
          </select></label
        >
        <PluginSettingsForm v-if="settingsSchema?.length" v-model="settingsText" :schema="settingsSchema" :disabled="busy" />
        <label v-else
          >{{ t('共享设置')
          }}<textarea
            v-model="settingsText"
            :aria-label="t('插件共享设置')"
            rows="4"
            spellcheck="false"
          />
        </label>
        <label v-if="detail.manifestVersion === 2"
          >{{ t('限制可访问目录（可选，每行一个目录前缀）')
          }}<textarea
            v-model="pathScopesText"
            :aria-label="t('插件目录权限范围')"
            :placeholder="t('例如：日报/')"
            rows="2"
            spellcheck="false"
          />
        </label>
        <label v-if="detail.manifestVersion === 2"
          >{{ t('插件包 HTTPS 地址（可选）')
          }}<input v-model="sourceUrl" :aria-label="t('插件包下载地址')" type="url"
        /></label>
        <button class="pc-button pc-secondary" :disabled="busy" @click="savePolicy">
          {{ t('保存工作区规则') }}
        </button>
      </section>
      <p
        v-else-if="selectedInstallation?.rule && !selectedInstallation.system"
        class="dialog-intro"
      >
        {{ t('启用方式由工作区管理员控制：') }}{{ modeLabels[selectedInstallation.rule.mode] }}
      </p>
      <PluginMaintenance
        v-if="selectedInstallation && !selectedInstallation.system && detail.manifestVersion === 2"
        :id="detail.id"
      />
      <p class="detail-scope">
        <ShieldCheck :size="17" /><span
          >{{
            selectedInstallation?.system
              ? t('系统插件随应用提供；启用偏好仅保存在此设备。')
              : selectedInstallation?.scope === 'user'
                ? t('全局插件保存在此设备的应用数据中，跨工作区生效，不写入工作区文件。')
                : t('版本与共享设置保存在工作区；代码和缓存保存在应用数据中。')
          }}<br />{{ t('插件操作遵循你的文档权限。') }}</span
        >
      </p>
    </section>
    <section v-if="active === tabKeys.features">
      <div v-for="view in detailViews" :key="view.key">
        {{ view.label }}
        <button
          class="pc-button pc-secondary"
          :disabled="!store.pluginViews.some((item) => item.key === view.key)"
          @click="store.openPluginView(view.pluginId, view.id)"
        >
          {{ t('打开') }}
        </button>
      </div>
      <p v-for="command in commands" :key="command.id">
        {{ command.label }} {{ command.shortcut }}
      </p>
      <section v-if="fileHandlers.length" class="detail-section">
        <h4>{{ t('文件打开器') }}</h4>
        <p v-for="(handler, index) in fileHandlers" :key="index">
          {{ handler.extensions.join('、') }} · {{ handler.mode === 'editor' ? t('编辑') : t('预览') }}
        </p>
      </section>
    </section>
  </article>
</template>
<style scoped>
.plugin-detail-page {
  padding: 28px;
  height: 100%;
  overflow: auto;
  color: var(--text);
}
.detail-heading {
  display: flex;
  align-items: center;
  gap: 20px;
}
.detail-heading :deep(.plugin-icon) {
  width: 64px;
  height: 64px;
}
h3 {
  font-size: 24px;
  margin: 0 0 8px;
}
.detail-heading p {
  color: var(--muted);
}
.detail-footer,
nav {
  display: flex;
  gap: 12px;
  margin: 24px 0;
}
.detail-section {
  margin: 24px 0;
}
.plugin-policy label {
  display: block;
  margin: 12px 0;
}
input,
textarea,
select {
  display: block;
  width: min(100%, 600px);
}
.detail-type {
  margin: 12px 0;
}
.detail-relations {
  display: flex;
  gap: 12px;
}
</style>
