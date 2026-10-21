// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceDashboard, { type DashboardWorkspace } from './WorkspaceDashboard.vue';
import { setUiLocale } from '../i18n';

let app: App;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.useRealTimers(); setUiLocale('zh-CN'); });
const entries: DashboardWorkspace[] = Array.from({ length: 7 }, (_, i) => ({
  id: String(i), name: `工作区 ${i}`, path: `C:/notes/${i}`, openedAt: i * 1000,
  source: i % 2 ? 'cloud' : 'local',
}));
function mount(busy = false, workspaces = entries, currentUserId?: string) {
  const open = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(WorkspaceDashboard, { workspaces, currentUserId, busy, onOpen: open }); app.mount(root);
  return open;
}
function named(name: string) {
  return [...root.querySelectorAll('button')].find(button => button.textContent?.includes(name))!;
}
const names = () => [...root.querySelectorAll('tbody strong')].map(item => item.textContent);
it('keeps loaded local rows usable while cloud rows load and clears each source independently', async () => {
  const state = reactive({ workspaces: [{ ...entries[0], openedAt: 1 }], loadingSources: ['cloud'] as DashboardWorkspace['source'][] });
  const open = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(WorkspaceDashboard, { ...state, onOpen: open }) }); app.mount(root);
  expect(names()).toEqual(['工作区 0']);
  expect(root.querySelectorAll('.dashboard-skeleton-row')).toHaveLength(2);
  expect(root.querySelector('.dashboard-empty')).toBeNull();
  named('工作区 0').click();
  expect(open).toHaveBeenCalledWith({ ...entries[0], openedAt: 1 });
  named('本地工作区').click(); await nextTick();
  expect(root.querySelectorAll('.dashboard-skeleton-row')).toHaveLength(0);
  named('在线工作区').click(); await nextTick();
  expect(root.querySelectorAll('.dashboard-skeleton-row')).toHaveLength(2);
  state.workspaces.push(entries[1]); state.loadingSources = [];
  await nextTick();
  expect(names()).toEqual(['工作区 1']);
  expect(root.querySelector('.dashboard-skeleton-row')).toBeNull();
  expect(root.querySelector('.dashboard-table-wrap')?.getAttribute('aria-busy')).toBe('false');
});
it('lists every workspace, filters by source and search, and sorts actual opening times', async () => {
  mount();
  expect(names()).toEqual(['工作区 6', '工作区 5', '工作区 4', '工作区 3', '工作区 2', '工作区 1']);
  named('在线工作区').click(); await nextTick();
  expect(names()).toEqual(['工作区 5', '工作区 3', '工作区 1']);
  named('全部工作区').click(); await nextTick();
  const search = root.querySelector('input')!;
  search.value = '  notes/2  '; search.dispatchEvent(new Event('input')); await nextTick();
  expect(names()).toEqual(['工作区 2']);
  search.value = 'missing'; search.dispatchEvent(new Event('input')); await nextTick();
  expect(root.textContent).toContain('没有找到匹配的工作区');
  search.value = ''; search.dispatchEvent(new Event('input')); await nextTick();
  named('最近打开').click(); await nextTick();
  expect(names()[0]).toBe('工作区 1');
  expect(root.querySelector('[aria-sort]')?.getAttribute('aria-sort')).toBe('ascending');
});
it('opens the exact selected workspace and disables opening during a transition', () => {
  const open = mount();
  named('工作区 5').click();
  expect(open).toHaveBeenCalledExactlyOnceWith(entries[5]);
});
it('prevents repeated workspace transitions while busy', () => {
  const open = mount(true);
  named('工作区 5').click();
  expect(open).not.toHaveBeenCalled();
  expect(named('工作区 5').disabled).toBe(true);
  const more = root.querySelector<HTMLButtonElement>('.dashboard-more')!;
  expect(more.disabled).toBe(true);
  more.click();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('opens the selected workspace only after choosing its menu action', async () => {
  const open = mount();
  const more = root.querySelector<HTMLButtonElement>('[aria-label="工作区 5 工作区操作"]')!;
  more.click(); await nextTick(); await nextTick();
  expect(open).not.toHaveBeenCalled();
  expect(more.getAttribute('aria-expanded')).toBe('true');
  const action = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(action.textContent).toContain('打开工作区');
  expect(document.activeElement).toBe(action);
  action.click(); await nextTick();
  expect(open).toHaveBeenCalledExactlyOnceWith(entries[5]);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('supports menu toggling, keyboard focus restoration, outside dismissal and filter changes', async () => {
  mount();
  const more = root.querySelector<HTMLButtonElement>('.dashboard-more')!;
  more.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await nextTick(); await nextTick();
  document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(more);
  root.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await nextTick(); await nextTick();
  document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(more);
  more.click(); await nextTick(); await nextTick();
  more.click(); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  more.click(); await nextTick(); await nextTick();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  more.click(); await nextTick(); await nextTick();
  named('在线工作区').click(); await nextTick();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('shows supplied owners, local ownership and an unknown owner without assuming the current account', () => {
  mount(false, [
    { ...entries[0], source: 'cloud', openedAt: 100, owner: '@alice', ownerProfile: { userId: 'alice', name: '小林', avatar: '🌙' } },
    { ...entries[1], source: 'local' },
    { ...entries[2], source: 'cloud' },
  ], 'alice');
  expect(root.querySelector('thead')?.textContent).toContain('所有者');
  expect([...root.querySelectorAll('.dashboard-owner')].map(cell => cell.textContent)).toEqual(['—', '本机用户', '小林']);
});

it.each([
  ['zh-CN', ['今天 5:00', '10月20日 14:03', '2025年10月21日 14:03', '尚未打开']],
  ['en-US', ['Today 5:00', 'Oct 20 14:03', 'Oct 21, 2025 14:03', 'Not opened yet']],
] as const)('formats opening dates relative to the local day and year in %s', (locale, expected) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 21, 16));
  setUiLocale(locale);
  const dates = [new Date(2026, 9, 21, 5).getTime(), new Date(2026, 9, 20, 14, 3).getTime(), new Date(2025, 9, 21, 14, 3).getTime(), 0];
  mount(false, dates.map((openedAt, i) => ({ ...entries[i], openedAt, createdAt: openedAt })));
  expect([...root.querySelectorAll('.dashboard-opened')].map(cell => cell.textContent)).toEqual(expected.slice(0, 3));
  expect([...root.querySelectorAll('.dashboard-created')].map(cell => cell.textContent)).toEqual(expected.slice(0, 3));
});

it('includes the year across local New Year midnight and tolerates invalid dates', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
  const dates = [new Date(2027, 0, 1).getTime(), new Date(2026, 11, 31, 23, 59).getTime(), Number.NaN, 1e20];
  mount(false, dates.map((openedAt, i) => ({ ...entries[i], openedAt })));
  const labels = [...root.querySelectorAll('.dashboard-opened')].map(cell => cell.textContent);
  expect(labels).toContain('今天 0:00');
  expect(labels).toContain('2026年12月31日 23:59');
  expect(labels.filter(label => label === '尚未打开')).toHaveLength(1);
  expect([...root.querySelectorAll('.dashboard-created')].every(cell => cell.textContent === '—')).toBe(true);
});

it('switches between recent, owned, shared and favorite workspace views', async () => {
  mount(false, [
    { ...entries[0], source: 'local', openedAt: 100 },
    { ...entries[1], source: 'cloud', openedAt: 200, ownerUserId: 'alice' },
    { ...entries[2], source: 'cloud', openedAt: 300, ownerUserId: 'bob', shared: true },
    { ...entries[3], source: 'cloud', openedAt: 400, ownerUserId: 'alice', favorite: true },
  ], 'alice');
  expect(names()).toEqual(['工作区 3', '工作区 2', '工作区 1', '工作区 0']);
  const tab = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('.dashboard-tabs button')]
    .find(button => button.textContent?.includes(label))!;
  tab('归我所有').click(); await nextTick();
  expect(names()).toEqual(['工作区 3', '工作区 1', '工作区 0']);
  tab('与我共享').click(); await nextTick();
  expect(names()).toEqual(['工作区 2']);
  tab('收藏').click(); await nextTick();
  expect(names()).toEqual(['工作区 3']);
});
