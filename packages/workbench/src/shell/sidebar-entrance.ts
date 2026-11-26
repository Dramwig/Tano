import { staggerIn } from '@tano/editor/motion';

/* Sidebar view entrance — every sidebar view builds itself up the way the mail
 * sidebar does: when the user switches views, the first visible rows rise in
 * one after another. Fixed chrome (brand row, module/view switcher, footer)
 * stays still; only the view's own content plays.
 *
 * Items are listed here, not tagged in each component, so the rhythm is tuned
 * in one place. Nested matches are fine: a picked item carries its children.
 */
export const SIDEBAR_ENTRANCE_ITEMS = [
  // 文件
  '.workspace-root-header',
  '.tree-row[data-entry-id]',
  '.tree-empty',
  // 事件与任务 / 计划
  '.sidebar-calendar-heading',
  '.sidebar-calendar-weekdays',
  '.sidebar-calendar-scroll',
  '.plan-section-heading',
  '.plan-completed-heading',
  '.plan-events > li',
  '.sidebar-calendar-empty',
  // 助手
  '.assistant-navigation-new',
  '.assistant-navigation-search',
  '.assistant-navigation-session',
  '.assistant-navigation-empty',
  // 邮箱
  '.sidebar-mail-head',
  '.sidebar-mail-empty',
  '.sidebar-mail-account-head',
  '.sidebar-mail-folder-list > li',
  // 插件
  '.plugin-explorer > header',
  '.plugin-explorer > .group',
  '.plugin-explorer .row',
  // Plugin-provided sidebar views move as one block.
  '.plugin-surface',
  '.extension-sidebar',
].join(', ');

/** How long after a switch a late-mounting view (async chunk) still enters. */
const LATE_MOUNT_WINDOW = 800;

/** Plays the entrance for the view now shown in `aside`. Views behind async
 * components can mount a little later; those enter when their node arrives.
 * Returns a disposer that stops waiting for a late view. */
export function playSidebarEntrance(aside: HTMLElement | null | undefined): () => void {
  if (!aside) return () => {};
  staggerIn(aside, SIDEBAR_ENTRANCE_ITEMS, { viewport: aside });
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        // nodeType, not instanceof: the shell may render in another window realm.
        if (node.nodeType === 1 && !(node as HTMLElement).dataset?.motionGhost)
          staggerIn(node as HTMLElement, SIDEBAR_ENTRANCE_ITEMS, { viewport: aside });
      }
    }
  });
  observer.observe(aside, { childList: true });
  const timer = setTimeout(() => observer.disconnect(), LATE_MOUNT_WINDOW);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
