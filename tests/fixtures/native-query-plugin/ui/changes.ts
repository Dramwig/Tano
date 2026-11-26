/*!
 * Vue runtime — The MIT License (MIT)
 * Copyright (c) 2018-present, Yuxi (Evan) You
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { createApp, h, reactive } from 'vue/dist/vue.runtime.esm-bundler.js';
import type { PluginGitStatus, PluginGitDiff, PluginGitLog, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import './style.css';

export default function mount(tano: TanoPluginViewApi) {
  const state = reactive<PluginGitStatus & { total: number; diff: (PluginGitDiff & { truncated: boolean }) | null; history: PluginGitLog; error: string; busy: boolean }>({ branch: null, detached: false, entries: [], total: 0, diff: null, history: { path: null, commits: [] }, error: '', busy: false });
  tano.onState(value => { if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(state, value); });
  const send = (message: { type: string; path?: string; staged?: boolean }) => { void tano.postMessage(message).catch(error => { state.error = String(error); }); };
  const label = (value: string) => ({ M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪', T: '类型变化' }[value] ?? '—');
  const mark = (value: string) => ({ M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: '!', '?': '?', T: 'T' }[value] ?? '·');
  const statusClass = (value: string) => ({ M: 'status-M', A: 'status-A', D: 'status-D', U: 'status-U', '?': 'status-untracked' }[value] ?? 'status-other');
  const canRead = (path: string) => !path.split('/').some(part => part.startsWith('.'));
  createApp({ render: () => h('main', [
    h('header', [h('div', [h('h1', 'Git 变更'), h('p', state.branch ? `当前分支 · ${state.branch}` : state.detached ? '当前处于分离 HEAD' : '本地仓库')]),
      h('button', { disabled: state.busy, onClick: () => send({ type: 'refresh' }) }, state.busy ? '正在查询…' : '刷新状态')]),
    h('p', { class: 'hint' }, '显示磁盘上已保存文件的状态。查询不运行自定义 Git 过滤器；未跟踪文件尚无 Git 差异。'),
    state.error ? h('p', { role: 'alert' }, state.error) : null,
    h('section', { 'aria-label': 'Git 文件状态' }, [h('h2', `${state.total} 项变更`), state.entries.length < state.total ? h('p', { class: 'hint' }, `列表过大，当前预览前 ${state.entries.length} 项。`) : null, state.entries.length ? h('table', [
      h('thead', h('tr', ['文件', '暂存区', '工作区', '查看差异'].map(title => h('th', title)))),
      h('tbody', state.entries.map(entry => h('tr', { key: entry.path }, [h('td', { class: 'path' }, entry.path), h('td', label(entry.index)), h('td', label(entry.worktree)),
        h('td', { class: 'actions' }, [h('span', { class: ['status-mark', statusClass(entry.index === ' ' ? entry.worktree : entry.index)], title: `${entry.path} · ${label(entry.index === ' ' ? entry.worktree : entry.index)}` }, mark(entry.index === ' ' ? entry.worktree : entry.index)),
          h('button', { disabled: state.busy || !canRead(entry.path) || entry.index === ' ' || entry.index === '?', 'aria-label': `查看 ${entry.path} 暂存差异`, onClick: () => send({ type: 'diff', path: entry.path, staged: true }) }, '暂存区'),
          h('button', { disabled: state.busy || !canRead(entry.path) || entry.worktree === ' ' || entry.index === '?', 'aria-label': `查看 ${entry.path} 工作区差异`, onClick: () => send({ type: 'diff', path: entry.path, staged: false }) }, '工作区')])]))),
    ]) : h('p', { class: 'empty' }, state.busy ? '正在读取仓库…' : state.error ? '修复上方问题后刷新。' : '已保存文件没有 Git 变更。')]),
    state.diff ? h('section', { 'aria-label': 'Git 文件差异' }, [h('h2', `${state.diff.path} · ${state.diff.staged ? '暂存区' : '工作区'}`),
      state.diff.truncated ? h('p', { class: 'hint' }, '差异较长，仅预览前 48 KiB。') : null,
      h('pre', state.diff.patch || '当前没有可显示的文本差异。')]) : null,
    h('section', { 'aria-label': 'Git 提交历史' }, [h('h2', '提交历史'), state.history.commits.length ? h('ol', { class: 'history-list' }, state.history.commits.map(commit => h('li', { key: commit.id }, [
      h('span', { class: 'history-mark', 'aria-hidden': 'true' }, '↗'),
      h('div', [h('strong', commit.subject), h('small', `${commit.shortId} · ${commit.author} · ${new Date(commit.date).toLocaleString()}`)])
    ]))) : h('p', { class: 'empty' }, state.busy ? '正在读取历史…' : '仓库尚无提交历史。')]),
  ]) }).mount(document.body.appendChild(document.createElement('div')));
}
