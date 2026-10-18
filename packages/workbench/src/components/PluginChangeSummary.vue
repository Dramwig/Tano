<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { canonicalPluginJson, type PluginManifest } from '@tano/protocol';
const props = defineProps<{ before?: PluginManifest; after: PluginManifest; workspace?: string }>();
const labels: Record<string, string> = { get 'documents.read'() { return t('读取与打开文档'); }, get 'documents.write'() { return t('创建与修改文档'); }, get 'objects.read'() { return t('读取对象'); }, get 'objects.write'() { return t('创建与修改对象'); }, get 'relations.read'() { return t('读取关系'); }, get 'relations.write'() { return t('修改关系'); }, get storage() { return t('保存插件本机状态'); }, get network() { return t('访问指定网络来源'); }, get connections() { return t('使用单独授权的服务凭据'); }, get native() { return t('调用指定本机能力'); }, get ui() { return t('运行隔离的自定义界面'); } };
function capabilities(manifest?: PluginManifest) {
  return manifest?.manifestVersion === 2 ? [manifest.permissions.map(value => labels[value] ?? value), manifest.networkOrigins, manifest.nativeCommands] : [[], [], []];
}
const changes = computed(() => {
  const before = capabilities(props.before), after = capabilities(props.after);
  return [t('运行权限'), t('联网地址'), t('本机能力')].map((label, i) => ({ label, before: before[i]!, after: after[i]!,
    added: after[i]!.filter(value => !before[i]!.includes(value)), removed: before[i]!.filter(value => !after[i]!.includes(value)) }));
});
const schemaChanged = computed(() => props.before && canonicalPluginJson([props.before.objectTypes, props.before.relationTypes]) !== canonicalPluginJson([props.after.objectTypes, props.after.relationTypes]));
</script>
<template>
  <section class="plugin-change-summary" :aria-label="t('插件变更与影响')">
    <h4>{{ before ? t('版本变更：{0} → {1}', [before.version, after.version]) : t('安装版本：{0}', [after.version]) }}</h4>
    <p>{{ t('影响工作区：') }}{{ workspace || t('当前工作区') }}{{ t('。成员同步规则后使用此版本，其他工作区的版本保持独立。') }}</p>
    <table><thead><tr><th>{{ t('能力') }}</th><th>{{ before ? t('当前版本') : t('安装前') }}</th><th>{{ t('目标版本') }}</th></tr></thead><tbody>
      <tr v-for="change in changes" :key="change.label"><th>{{ change.label }}</th><td>{{ change.before.join('、') || t('无') }}</td><td>{{ change.after.join('、') || t('无') }}</td></tr>
    </tbody></table>
    <template v-for="change in changes" :key="change.label">
      <p v-if="change.added.length">{{ t('新增') }}{{ change.label }}：{{ change.added.join('、') }}</p>
      <p v-if="change.removed.length">{{ t('移除') }}{{ change.label }}：{{ change.removed.join('、') }}</p>
    </template>
    <p v-if="schemaChanged">{{ t('对象或关系定义将变化。现有 Markdown 数据会保留，请先核对旧数据在新版本中的展示。') }}</p>
    <p v-if="after.manifestVersion === 2">{{ t('每位成员需在自己的设备上授权新代码摘要；已有服务连接和后台任务若绑定旧摘要，需要重新授权。') }}</p>
    <p v-if="before">{{ t('保留当前共享设置和历史版本。正在运行的旧实例将停止，未完成的调用会取消。') }}</p>
  </section>
</template>
<style scoped>
.plugin-change-summary { padding: 14px; border: 1px solid var(--line); border-radius: 8px; margin: 16px 0; font-size: 12px; }
h4 { margin: 0 0 10px; } p { line-height: 1.65; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th:first-child { width: 20%; } tbody th { font-weight: 500; }
</style>
