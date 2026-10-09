<script setup lang="ts">
import { computed } from 'vue';
import { canonicalPluginJson, type PluginManifest } from '@tano/protocol';
const props = defineProps<{ before?: PluginManifest; after: PluginManifest; workspace?: string }>();
const labels: Record<string, string> = { 'documents.read': '读取与打开文档', 'documents.write': '创建与修改文档', 'objects.read': '读取对象', 'objects.write': '创建与修改对象', 'relations.read': '读取关系', 'relations.write': '修改关系', storage: '保存插件本机状态', network: '访问指定网络来源', connections: '使用单独授权的服务凭据', native: '调用指定本机能力', ui: '运行隔离的自定义界面' };
function capabilities(manifest?: PluginManifest) {
  return manifest?.manifestVersion === 2 ? [manifest.permissions.map(value => labels[value] ?? value), manifest.networkOrigins, manifest.nativeCommands] : [[], [], []];
}
const changes = computed(() => {
  const before = capabilities(props.before), after = capabilities(props.after);
  return ['运行权限', '联网地址', '本机能力'].map((label, i) => ({ label, before: before[i]!, after: after[i]!,
    added: after[i]!.filter(value => !before[i]!.includes(value)), removed: before[i]!.filter(value => !after[i]!.includes(value)) }));
});
const schemaChanged = computed(() => props.before && canonicalPluginJson([props.before.objectTypes, props.before.relationTypes]) !== canonicalPluginJson([props.after.objectTypes, props.after.relationTypes]));
</script>
<template>
  <section class="plugin-change-summary" aria-label="插件变更与影响">
    <h4>{{ before ? `版本变更：${before.version} → ${after.version}` : `安装版本：${after.version}` }}</h4>
    <p>影响工作区：{{ workspace || '当前工作区' }}。成员同步规则后使用此版本，其他工作区的版本保持独立。</p>
    <table><thead><tr><th>能力</th><th>{{ before ? '当前版本' : '安装前' }}</th><th>目标版本</th></tr></thead><tbody>
      <tr v-for="change in changes" :key="change.label"><th>{{ change.label }}</th><td>{{ change.before.join('、') || '无' }}</td><td>{{ change.after.join('、') || '无' }}</td></tr>
    </tbody></table>
    <template v-for="change in changes" :key="change.label">
      <p v-if="change.added.length">新增{{ change.label }}：{{ change.added.join('、') }}</p>
      <p v-if="change.removed.length">移除{{ change.label }}：{{ change.removed.join('、') }}</p>
    </template>
    <p v-if="schemaChanged">对象或关系定义将变化。现有 Markdown 数据会保留，请先核对旧数据在新版本中的展示。</p>
    <p v-if="after.manifestVersion === 2">每位成员需在自己的设备上授权新代码摘要；已有服务连接和后台任务若绑定旧摘要，需要重新授权。</p>
    <p v-if="before">保留当前共享设置和历史版本。正在运行的旧实例将停止，未完成的调用会取消。</p>
  </section>
</template>
<style scoped>
.plugin-change-summary { padding: 14px; border: 1px solid var(--line); border-radius: 8px; margin: 16px 0; font-size: 12px; }
h4 { margin: 0 0 10px; } p { line-height: 1.65; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th:first-child { width: 20%; } tbody th { font-weight: 500; }
</style>
