import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import type { PluginJson, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import { emptySummary, statuses, type DashboardState } from '../model';
import notices from '../THIRD_PARTY_NOTICES.txt';
import './style.css';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
const colors = ['#bb8c4d', '#4f8294', '#4e8665'];

function StatusChart({ counts, onSelect }: { counts: number[]; onSelect: (status: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), chart = useRef<Chart<'bar'>>(null), select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const instance = new Chart(canvas.current!, { type: 'bar', data: {
      labels: [...statuses], datasets: [{ label: '任务数', data: [0, 0, 0], backgroundColor: colors, borderRadius: 6, maxBarThickness: 70 }],
    }, options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: item => `${item.parsed.y} 项任务` } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e6ebe7' } }, x: { grid: { display: false } } },
      onClick: (_event, elements) => { if (elements[0]) select.current(elements[0].index); },
    } });
    chart.current = instance;
    return () => { instance.destroy(); chart.current = null; };
  }, []);
  useEffect(() => { if (chart.current) { chart.current.data.datasets[0].data = [...counts]; chart.current.update('none'); } }, [counts]);
  return <div className="chart"><canvas ref={canvas} role="img" aria-label={`任务状态分布：${statuses.map((label, i) => `${label} ${counts[i]} 项`).join('，')}`} /></div>;
}

function Dashboard({ api }: { api: TanoPluginViewApi }) {
  const [state, setState] = useState<DashboardState>({ ...emptySummary(), query: '', includeArchived: false, loading: true, error: '' });
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [selected, setSelected] = useState(-1);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const initialized = useRef(false);
  useEffect(() => api.onState(value => {
    const next = value as DashboardState;
    if (!initialized.current) { setQuery(next.query); setArchived(next.includeArchived); initialized.current = true; }
    setState(next);
  }), [api]);
  const send = async (message: PluginJson) => {
    setBusy(true); setError('');
    try { await api.postMessage(message); } catch (cause) { setError(cause instanceof Error ? cause.message : '请求未完成，请重试。'); }
    finally { setBusy(false); }
  };
  const rows = state.rows.filter(row => selected < 0 || row.status === selected);
  return <main>
    <header><div><span className="eyebrow">同页 · 工作区任务</span><h1>任务统计</h1><p>看见进度，找到下一步。</p></div>
      <button className="secondary" disabled={busy || state.loading} onClick={() => void send({ type: 'refresh' })}>刷新统计</button></header>
    <form onSubmit={event => { event.preventDefault(); void send({ type: 'filter', query, includeArchived: archived }); }}>
      <label className="search">搜索任务<input aria-label="搜索任务" maxLength={200} placeholder="按名称或描述筛选" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="checkbox"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />包含归档任务</label>
      <button disabled={busy || state.loading}>应用筛选</button>
    </form>
    <p role="status">{state.loading ? '正在读取任务…' : state.error ? '统计未完成' : `已统计 ${state.loaded} 项任务${state.total === null ? '' : `，匹配 ${state.total} 项`}`}</p>
    <p className="scope">{state.query ? `当前搜索：${state.query} · ` : ''}{state.includeArchived ? '包含归档' : '排除归档'} · 仅统计可完成的事件</p>
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
    {state.truncated && <p className="notice">当前为部分统计：每次最多读取 1,000 项或 40 页。请缩小搜索范围后重试。</p>}
    {state.skipped > 0 && <p className="notice">有 {state.skipped} 项未能读取，未计入统计。</p>}
    {!state.loading && !state.error && <>
      <div className="metrics" aria-label="按状态筛选">{statuses.map((label, i) => <button key={label} className={selected === i ? 'metric selected' : 'metric'}
        aria-pressed={selected === i} onClick={() => setSelected(selected === i ? -1 : i)}><span>{label}</span><strong>{state.counts[i]}</strong></button>)}</div>
      <section className="panel" aria-label="任务分布"><div className="panel-heading"><h2>状态分布</h2><span>点击柱形或上方状态查看任务</span></div>
        <StatusChart counts={state.counts} onSelect={setSelected} /></section>
      <section className="panel" aria-label="任务预览"><div className="panel-heading"><h2>{selected < 0 ? '任务预览' : statuses[selected]}</h2>
        <button className="text-button" onClick={() => setSelected(-1)} disabled={selected < 0}>显示全部状态</button></div>
        <p>每种状态预览按名称排序的前 20 项；统计包含本次读取的全部任务。</p>
        {rows.length ? <table><thead><tr><th>任务</th><th>状态</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.title}</td><td><span className={`badge status-${row.status}`}>{statuses[row.status]}</span></td></tr>)}</tbody></table> : <p className="empty">没有符合条件的任务。</p>}
      </section>
    </>}
    <footer><span>任务数据保留在工作区中，统计只读。</span><details><summary>开源组件许可</summary><pre>{notices}</pre></details></footer>
  </main>;
}

export default function mount(api: TanoPluginViewApi) {
  const root = createRoot(document.querySelector('#app')!);
  root.render(<Dashboard api={api} />);
  addEventListener('pagehide', () => root.unmount(), { once: true });
}
