<script setup lang="ts">
import { uiLocale, t } from '../i18n';
import { onMounted, onBeforeUnmount } from 'vue';
import { createGitInspection } from '../workspace-git';
const props = defineProps<{ workspaceId: string }>();
const git = createGitInspection(() => props.workspaceId);
const { status, history, diff, busy, error } = git;
onMounted(git.refresh); onBeforeUnmount(git.dispose);
const label = (value: string) => t({ M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪', T: '类型变化' }[value] ?? '—');
const canRead = (path: string) => !path.split('/').some(part => part.startsWith('.'));
</script>
<template>
  <section class="git-inspection" :aria-label="t('Git 变更与历史')">
    <header><strong>{{ status.branch ? t('当前分支 · {0}', [status.branch]) : status.detached ? t('分离 HEAD') : t('本地 Git 仓库') }}</strong>
      <button class="secondary-button" :disabled="busy" @click="git.refresh">{{ busy ? t('正在读取…') : t('刷新 Git 状态') }}</button></header>
    <p>{{ t('读取已保存文件。未保存草稿不参与 Git 查询；未跟踪文件尚无 Git 差异。') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <h3>{{ t('文件变更 ·') }} {{ status.entries.length }}</h3>
    <div v-if="status.entries.length" class="git-table-scroll"><table>
      <thead><tr><th>{{ t('文件') }}</th><th>{{ t('暂存区') }}</th><th>{{ t('工作区') }}</th><th>{{ t('差异') }}</th></tr></thead>
      <tbody><tr v-for="entry in status.entries" :key="entry.path"><td>{{ entry.path }}</td><td>{{ label(entry.index) }}</td><td>{{ label(entry.worktree) }}</td>
        <td class="git-diff-actions"><button class="secondary-button" :aria-label="t('查看 {0} 暂存差异', [entry.path])" :disabled="busy || !canRead(entry.path) || entry.index === ' ' || entry.index === '?'" @click="git.showDiff(entry.path, true)">{{ t('暂存区') }}</button>
        <button class="secondary-button" :aria-label="t('查看 {0} 工作区差异', [entry.path])" :disabled="busy || !canRead(entry.path) || entry.worktree === ' ' || entry.index === '?'" @click="git.showDiff(entry.path, false)">{{ t('工作区') }}</button></td></tr></tbody>
    </table></div>
    <p v-else-if="!busy && !error">{{ t('已保存文件没有 Git 变更。') }}</p>
    <section v-if="diff" :aria-label="t('Git 文件差异')"><h3>{{ diff.path }} · {{ diff.staged ? t('暂存区') : t('工作区') }}</h3>
      <p v-if="diff.truncated">{{ t('差异较长，仅预览前 48 KiB。') }}</p><pre>{{ diff.patch || t('当前没有文本差异。') }}</pre></section>
    <section :aria-label="t('Git 提交历史')"><h3>{{ t('最近提交') }}</h3><ol v-if="history.commits.length"><li v-for="commit in history.commits" :key="commit.id"><strong>{{ commit.subject }}</strong><small>{{ commit.shortId }} · {{ commit.author }} · {{ new Date(commit.date).toLocaleString(uiLocale) }}</small></li></ol><p v-else-if="!busy && !error">{{ t('尚无提交历史。') }}</p></section>
  </section>
</template>
<style scoped>
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; } p, small { color: var(--muted, #787774); } h3 { font-size: 14px; margin: 20px 0 10px; } .git-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; } th, td { padding: 9px 8px; border-bottom: 1px solid var(--border, #ddd); } td:first-child { overflow-wrap: anywhere; min-width: 140px; } .git-diff-actions { white-space: nowrap; } .git-diff-actions button + button { margin-left: 6px; }
pre { overflow: auto; max-height: 280px; padding: 12px; border: 1px solid var(--border, #ddd); border-radius: 8px; font: 12px/1.6 var(--font-mono); } ol { list-style: none; padding: 0; } li { padding: 10px 0; border-bottom: 1px solid var(--border, #ddd); } small { display: block; margin-top: 4px; } [role=alert] { color: var(--danger, #c33); }
</style>
