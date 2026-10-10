// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import HelpLauncher from './HelpLauncher.vue';
import { helpPreferenceKey, helpTiming, readHelpPreferences, useHelpPreferences } from '../help-guidance';
import { helpChecklist, type HelpContext } from '../help-content';
import { helpChecklistKey, readHelpCompleted, recordHelpCompleted } from '../help-checklist';
import { createButterflyIdleTrigger } from '../assistant/butterfly-idle';

let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 10));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  app?.unmount(); app = undefined;
  document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(context: HelpContext = 'document') {
  const props = reactive({ context, available: true, blocked: false, scope: 'workspace-one', native: false,
    documentationBaseUrl: 'http://127.0.0.1:43941/zh-cn/docs' });
  const settings = vi.fn();
  const documentation = vi.fn();
  let preferenceControl!: ReturnType<typeof useHelpPreferences>;
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ setup() {
    preferenceControl = useHelpPreferences();
    return () => h(HelpLauncher, { ...props, onSettings: settings, onDocumentation: documentation });
  } });
  app.mount(root);
  await nextTick();
  const trigger = root.querySelector<HTMLButtonElement>('button')!;
  return { props, trigger, settings, documentation, preferenceControl };
}
const find = (selector: string) => document.querySelector<HTMLElement>(selector);
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLElement>('button, a')].find(button => button.textContent?.trim() === text)!;
  // Navigation is exercised in the browser; keep jsdom on its current document.
  if (button?.tagName === 'A') button.addEventListener('click', event => event.preventDefault(), { once: true });
  expect(button, `button: ${text}`).toBeDefined(); button.click(); await nextTick();
}
async function time(ms: number) { await vi.advanceTimersByTimeAsync(ms); await nextTick(); }
function event(type: string, target: EventTarget = window) { target.dispatchEvent(new Event(type, { bubbles: true })); }

describe('help entry point', () => {
  it('separates the delayed timeline from the click menu and keeps About under More', async () => {
    const { trigger, settings } = await mount();
    expect(trigger.hasAttribute('title')).toBe(false);
    event('pointerenter', trigger); await time(499);
    expect(find('.help-preview')).toBeNull();
    await time(1);
    expect(find('[aria-label="上手指引"]')?.textContent).toContain('上手 · 开始记录');
    expect(document.querySelectorAll('.help-timeline li')).toHaveLength(4);
    expect(document.querySelectorAll('.help-timeline p')).toHaveLength(1);
    expect(find('[role="dialog"]')).toBeNull();
    trigger.click(); await nextTick();
    expect(find('.help-preview')).toBeNull();
    expect(find('[role="dialog"]')?.textContent).toContain('快速上手');
    expect(find('[role="dialog"]')?.textContent).not.toContain('关于同页');
    expect(find('[role="dialog"]')?.textContent).not.toContain('键盘快捷键');
    expect(find('[role="dialog"]')?.textContent).not.toContain('偶尔显示使用提示');
    expect(find('[role="switch"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(settings).not.toHaveBeenCalled();
    await click('更多'); await click('关于同页');
    expect(settings).toHaveBeenCalledWith('about');
    expect(find('[role="dialog"]')).toBeNull();
  });

  it('links to the existing documentation in a new tab and keeps the workbench in place', async () => {
    const { trigger, documentation } = await mount();
    trigger.click(); await nextTick();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.help-main-links a')];
    expect(links.map(link => link.href)).toEqual([
      'http://127.0.0.1:43941/zh-cn/docs/quickstart', 'http://127.0.0.1:43941/zh-cn/docs',
    ]);
    expect(links.every(link => link.target === '_blank' && link.rel.includes('noopener'))).toBe(true);
    const currentUrl = location.href;
    await click('使用指南');
    expect(find('.help-guide-list')).toBeNull(); expect(find('.help-article')).toBeNull();
    expect(find('.help-popover')).toBeNull(); expect(location.href).toBe(currentUrl);
    expect(documentation).not.toHaveBeenCalled();
  });

  it('uses the native external opener only after the user follows a documentation link', async () => {
    const { props, trigger, documentation } = await mount();
    props.native = true; await nextTick();
    trigger.click(); await nextTick();
    expect(documentation).not.toHaveBeenCalled();
    await click('快速上手');
    expect(documentation).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:43941/zh-cn/docs/quickstart');
    expect(find('.help-popover')).toBeNull();
  });

  it('restores focus on Escape without opening settings or documents', async () => {
    const { trigger, settings } = await mount();
    trigger.click(); await nextTick();
    expect(settings).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await nextTick();
    expect(find('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await time(1000); expect(find('.help-preview')).toBeNull();
  });

  it('supports arrow navigation, opens shortcuts explicitly and never traps outside focus', async () => {
    const { trigger, settings } = await mount();
    trigger.click(); await nextTick(); await nextTick();
    expect(document.activeElement?.textContent).toBe('快速上手');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('使用指南');
    await click('更多'); await click('键盘快捷键'); expect(settings).toHaveBeenCalledWith('shortcuts');
    expect(find('[role="menu"]')).toBeNull();
    trigger.click(); await nextTick(); await nextTick();
    const input = document.createElement('input'); document.body.append(input); input.focus();
    await nextTick(); expect(find('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(input);
  });

  it.each([
    { width: 1024, height: 768, parentLeft: 200, rowTop: 520, left: 452, top: 515 },
    { width: 500, height: 300, parentLeft: 240, rowTop: 280, left: 60, top: 249 },
    { width: 300, height: 300, parentLeft: 12, rowTop: 280, left: 112, top: 249 },
  ])('opens More beside its parent and stays within a $width px viewport', async bounds => {
    vi.stubGlobal('innerWidth', bounds.width); vi.stubGlobal('innerHeight', bounds.height);
    const { trigger, settings } = await mount();
    trigger.click(); await nextTick();
    const parent = find('.help-popover')!;
    const more = parent.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({ left: bounds.parentLeft, right: bounds.parentLeft + 248 } as DOMRect);
    vi.spyOn(more, 'getBoundingClientRect').mockReturnValue({ top: bounds.rowTop } as DOMRect);
    await click('更多');
    const submenu = find('[role="menu"]')!;
    expect(submenu).not.toBeNull();
    expect(parent.contains(submenu)).toBe(false);
    expect(parent.textContent).not.toContain('关于同页');
    expect([...submenu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['键盘快捷键', '关于同页']);
    expect(submenu.style.left).toBe(`${bounds.left}px`);
    expect(submenu.style.top).toBe(`${bounds.top}px`);
    expect(more.getAttribute('aria-controls')).toBe(submenu.id);
    expect(document.activeElement).toBe(submenu.querySelector('[role="menuitem"]'));
    event('pointerdown', submenu.querySelector('button')!); await nextTick();
    expect(find('[role="menu"]')).toBe(submenu);
    await click('关于同页');
    expect(settings).toHaveBeenCalledWith('about');
    expect(find('.help-popover')).toBeNull(); expect(find('[role="menu"]')).toBeNull();
  });

  it('uses Right to enter the submenu and Left or Escape to return one level', async () => {
    const { trigger } = await mount(); trigger.click(); await nextTick();
    const more = find('[aria-haspopup="menu"]')!;
    const key = (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    more.focus(); key(more, 'ArrowRight'); await nextTick();
    expect(find('[role="menu"]')).not.toBeNull();
    key(find('[role="menuitem"]')!, 'ArrowLeft'); await nextTick();
    expect(find('[role="menu"]')).toBeNull();
    expect(find('.help-popover')).not.toBeNull(); expect(document.activeElement).toBe(more);
    key(more, 'ArrowRight'); await nextTick();
    key(find('[role="menuitem"]')!, 'Escape'); await nextTick();
    expect(find('[role="menu"]')).toBeNull();
    expect(find('.help-popover')).not.toBeNull(); expect(document.activeElement).toBe(more);
    key(more, 'Escape'); await nextTick();
    expect(find('.help-popover')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });

  it('dismisses both menu levels on outside interaction and removes the submenu when opening a guide', async () => {
    const { trigger } = await mount(); trigger.click(); await nextTick(); await click('更多');
    event('pointerdown', document.body); await nextTick();
    expect(find('.help-popover')).toBeNull(); expect(find('[role="menu"]')).toBeNull();
    trigger.click(); await nextTick(); await click('更多'); await click('快速上手');
    expect(find('[role="menu"]')).toBeNull(); expect(find('.help-popover')).toBeNull();
  });
});

describe('hover onboarding checklist', () => {
  it('opens without taking focus, lets the pointer cross to the card and closes after leaving', async () => {
    const { trigger } = await mount();
    const editor = document.createElement('textarea'); document.body.append(editor); editor.focus();
    event('pointerenter', trigger); await time(500);
    expect(document.activeElement).toBe(editor);
    expect(trigger.getAttribute('aria-controls')).toBe(find('.help-preview')?.id);
    event('pointerleave', trigger); await time(150);
    event('pointerenter', find('.help-preview')!); await time(1000);
    expect(find('.help-preview')).not.toBeNull();
    event('pointerleave', find('.help-preview')!); await time(250);
    expect(find('.help-preview')).toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it('cancels fleeting hover, blocked states, background windows and outside interaction', async () => {
    const { props, trigger } = await mount();
    event('pointerenter', trigger); await time(200); event('pointerleave', trigger); await time(1000);
    expect(find('.help-preview')).toBeNull();
    event('pointerenter', trigger); props.blocked = true; await nextTick(); await time(1000);
    expect(find('.help-preview')).toBeNull();
    props.blocked = false; await nextTick();
    event('pointerenter', trigger); await time(500); event('blur'); await nextTick();
    expect(find('.help-preview')).toBeNull();
    event('focus'); event('pointerenter', trigger); await time(500);
    event('pointerdown', document.body); await nextTick();
    expect(find('.help-preview')).toBeNull();
  });

  it('shares automatic completion across both views and remounts without inheriting read or manual markers', async () => {
    localStorage.setItem(helpPreferenceKey, JSON.stringify({ seen: ['welcome', 'document'] }));
    localStorage.setItem('tano.preference.helpChecklist.v1', JSON.stringify(['welcome', 'document']));
    const { trigger } = await mount(); event('pointerenter', trigger); await time(500);
    expect(find('.help-preview-heading')?.textContent).toContain('0/42');
    expect(find('[role="checkbox"]')).toBeNull();
    expect(find('.help-preview-footer')).toBeNull();
    find('[aria-label="认识工作区：未完成"]')!.click(); await nextTick();
    expect(readHelpCompleted()).toEqual([]);
    recordHelpCompleted('welcome'); await nextTick();
    expect(find('.help-preview-heading')?.textContent).toContain('1/42 已完成');
    expect(find('.help-timeline p')?.textContent).toContain('一句话');
    trigger.click(); await nextTick();
    const menu = find('.help-popover')!;
    expect(menu.querySelectorAll('.help-timeline li')).toHaveLength(4);
    expect(menu.lastElementChild?.classList.contains('help-menu-checklist')).toBe(true);
    expect(menu.querySelector('.help-preview-heading')?.textContent).toContain('1/42');
    recordHelpCompleted('empty-document'); await nextTick();
    expect(find('.help-popover')).toBe(menu);
    trigger.click(); await nextTick(); event('pointerenter', trigger); await time(500);
    expect(find('.help-preview-heading')?.textContent).toContain('2/42');
    app?.unmount(); root.remove();
    const second = await mount(); event('pointerenter', second.trigger); await time(500);
    expect(readHelpCompleted()).toEqual(['welcome', 'empty-document']);
    expect(find('[aria-label="当前阶段：开始记录"]')).not.toBeNull();
    expect(find('.help-preview-heading')?.textContent).toContain('2/42');
  });

  it('opens the existing documentation only on request and does not mark it understood', async () => {
    const { props, trigger, documentation } = await mount('graph'); props.native = true;
    event('pointerenter', trigger); await time(500);
    expect(documentation).not.toHaveBeenCalled();
    await click('连接相关文档');
    expect(documentation).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:43941/zh-cn/docs/organize');
    expect(find('.help-preview')).toBeNull();
    expect(readHelpCompleted()).toEqual([]);
  });

  it('allows keyboard entry and Escape without trapping focus or reopening the card', async () => {
    const { trigger } = await mount(); trigger.focus(); await time(500);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(find('.help-step-content a'));
    await time(500); expect(find('.help-preview')).not.toBeNull();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await time(1000);
    expect(find('.help-preview')).toBeNull(); expect(document.activeElement).toBe(trigger);
    event('pointerenter', trigger); await time(500);
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    await nextTick(); expect(find('.help-preview')).toBeNull(); expect(document.activeElement).toBe(outside);
  });

  it('replaces a proactive bubble while hovering and never stacks it with the checklist', async () => {
    const { trigger } = await mount(); await time(helpTiming.warmup);
    expect(find('.help-bubble')).not.toBeNull();
    event('pointerenter', trigger); await time(500);
    expect(find('.help-bubble')).toBeNull(); expect(find('.help-preview')).not.toBeNull();
    await time(helpTiming.cooldown);
    expect(find('.help-bubble')).toBeNull(); expect(find('.help-preview')).not.toBeNull();
  });

  it('keeps session progress when storage is unavailable and merges another window without losing steps', async () => {
    const { trigger } = await mount(); event('pointerenter', trigger); await time(500);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    recordHelpCompleted('welcome'); await nextTick();
    recordHelpCompleted('empty-document'); await nextTick();
    expect(find('.help-preview-heading')?.textContent).toContain('2/42');
    vi.mocked(Storage.prototype.setItem).mockRestore();
    localStorage.setItem(helpChecklistKey + '.plan', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: helpChecklistKey + '.plan' })); await nextTick();
    expect(find('.help-preview-heading')?.textContent).toContain('3/42');
    recordHelpCompleted(...helpChecklist.map(step => step.id)); await nextTick();
    expect(find('.help-preview-heading')?.textContent).toContain('42/42');
    expect(find('.help-timeline p')).toBeNull();
    expect(find('.help-preview-footer')).toBeNull();
  });

  it('chooses one stage without category controls and advances only on reopening', async () => {
    const { trigger } = await mount(); trigger.click(); await nextTick();
    expect(find('.help-group-toggle')).toBeNull();
    expect(document.querySelectorAll('.help-current-stage')).toHaveLength(1);
    expect(find('[aria-label="当前阶段：开始记录"]')).not.toBeNull();
    expect(document.querySelectorAll('.help-timeline li')).toHaveLength(4);
    const links = [...document.querySelectorAll('.help-timeline a')];
    recordHelpCompleted('welcome', 'empty-document'); await nextTick();
    expect(find('[aria-label="当前阶段：开始记录"]')).not.toBeNull();
    expect([...document.querySelectorAll('.help-timeline a')]).toEqual(links);
    expect(find('.help-preview-heading')?.textContent).toContain('上手 · 开始记录');
    expect(find('.help-stage-heading')).toBeNull();
    trigger.click(); await nextTick(); trigger.click(); await nextTick();
    expect(find('[aria-label="当前阶段：开始记录"]')).not.toBeNull();
    expect(find('.help-timeline .is-next a')?.textContent).toBe('新建一篇文档');
    recordHelpCompleted('create-document', 'rename-document'); await nextTick();
    expect(find('[aria-label="当前阶段：开始记录"]')).not.toBeNull();
    trigger.click(); await nextTick(); trigger.click(); await nextTick();
    expect(find('[aria-label="当前阶段：写作基础"]')).not.toBeNull();
    expect(find('.help-timeline p')?.textContent).toContain('#');
    expect(find('.help-current-stage button')).toBeNull();
  });

  it('rolls recommendations on reopening and preserves the next step across modes and remounts', async () => {
    recordHelpCompleted('welcome', 'empty-document');
    const { trigger, props } = await mount(); event('pointerenter', trigger); await time(500);
    const labels = () => [...document.querySelectorAll('.help-timeline a')].map(link => link.textContent);
    const original = labels();
    expect(original).toEqual(['用标题分清层次', '强调重点文字', '列一份清单', '按顺序写步骤']);
    recordHelpCompleted('heading'); await nextTick();
    expect(labels()).toEqual(original);
    expect(find('.help-timeline .is-next a')?.textContent).toBe('强调重点文字');
    trigger.click(); await nextTick();
    expect(labels()).toEqual(original);
    recordHelpCompleted('bold'); await nextTick();
    trigger.click(); props.context = 'source'; await nextTick(); trigger.click(); await nextTick();
    const afterBold = ['强调重点文字', '列一份清单', '按顺序写步骤', '在正文记下待办'];
    expect(labels()).toEqual(afterBold);
    expect(find('.help-timeline .is-next a')?.textContent).toBe('列一份清单');
    expect(find('[aria-label="强调重点文字：已完成"]')).not.toBeNull();
    app?.unmount(); root.remove();
    const second = await mount(); second.trigger.click(); await nextTick();
    expect(labels()).toEqual(afterBold);
    recordHelpCompleted('bullet-list'); await nextTick();
    second.trigger.click(); await nextTick(); second.trigger.click(); await nextTick();
    const afterList = ['列一份清单', '按顺序写步骤', '在正文记下待办', '用斜体补充语气'];
    expect(labels()).toEqual(afterList);
    expect(find('.help-timeline .is-next a')?.textContent).toBe('按顺序写步骤');
    recordHelpCompleted('ordered-list'); await nextTick();
    expect(labels()).toEqual(afterList);
    second.trigger.click(); await nextTick(); second.trigger.click(); await nextTick();
    expect(labels()).toEqual(['按顺序写步骤', '在正文记下待办', '用斜体补充语气']);
  });

  it('selects lessons from the current page and uses the same policy in both surfaces', async () => {
    recordHelpCompleted('welcome', 'empty-document', 'create-document', 'rename-document');
    const { trigger, props } = await mount('plan'); event('pointerenter', trigger); await time(500);
    expect(find('[aria-label="当前阶段：把想法变成计划"]')).not.toBeNull();
    expect(find('.help-preview-heading')?.textContent).toContain('4/42');
    trigger.click(); await nextTick();
    expect(find('[aria-label="当前阶段：把想法变成计划"]')).not.toBeNull();
    trigger.click(); props.context = 'plugins'; await nextTick(); trigger.click(); await nextTick();
    expect(find('[aria-label="当前阶段：了解扩展能力"]')).not.toBeNull();
    expect(document.querySelectorAll('.help-timeline li')).toHaveLength(2);
  });
});

describe('restrained contextual hints', () => {
  it('shares its activity clock with the butterfly and retains the egg when tips are disabled', async () => {
    const listeners = vi.spyOn(window, 'addEventListener');
    const { preferenceControl } = await mount();
    const onIdle = vi.fn(); const documentIdentity = {};
    const butterfly = createButterflyIdleTrigger({
      selection: () => ({ scope: 'workspace:doc', from: 1, to: 6, document: documentIdentity }),
      enabled: () => true, onIdle,
    });
    try {
      expect(listeners.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
      await time(25_000); event('pointermove');
      await time(5000); expect(onIdle).not.toHaveBeenCalled();
      preferenceControl.setEnabled(false); await nextTick();
      await time(25_000); expect(onIdle).toHaveBeenCalledOnce(); expect(find('.help-bubble')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { butterfly.dispose(); }
  });

  it('skips obstruction layout queries while typing or tips are disabled', async () => {
    const { preferenceControl } = await mount();
    const queries = vi.spyOn(document, 'querySelectorAll');
    for (let index = 0; index < 60; index++) { event('input'); await time(1000); }
    expect(queries).not.toHaveBeenCalled();
    preferenceControl.setEnabled(false); await nextTick();
    await time(helpTiming.idle); expect(queries).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for a quiet moment, never takes editor focus, hides on timeout and does not repeat a topic', async () => {
    const { props } = await mount('source');
    const input = document.createElement('textarea'); document.body.append(input); input.focus();
    await time(helpTiming.warmup - 1000); event('input', input);
    await time(helpTiming.quiet - 1000); expect(find('.help-bubble')).toBeNull();
    await time(1000);
    expect(find('.help-bubble')?.textContent).toContain('Markdown');
    expect(document.activeElement).toBe(input);
    expect(find('[role="dialog"]')).toBeNull();
    await time(helpTiming.duration); expect(find('.help-bubble')).toBeNull();
    props.context = 'graph'; await nextTick(); await time(helpTiming.dwell);
    expect(find('.help-bubble')).toBeNull();
    await time(helpTiming.cooldown - helpTiming.duration - helpTiming.dwell);
    expect(find('.help-bubble')?.textContent).toContain('节点');
    props.context = 'source'; await nextTick(); await time(helpTiming.cooldown);
    expect(find('.help-bubble')).toBeNull();
    expect(readHelpPreferences().seen).toEqual(['source', 'graph']);
  });

  it('offers an idle hint only after the contextual guide has been read', async () => {
    localStorage.setItem(helpPreferenceKey, JSON.stringify({ seen: ['document'] }));
    await mount(); await time(helpTiming.idle - 1000);
    expect(find('.help-bubble')).toBeNull(); await time(1000);
    expect(find('.help-bubble')?.textContent).toContain('查找文档');
  });

  it.each(['blocked', 'hidden-sidebar', 'background', 'dialog', 'drag', 'composition'])(
    'defers while %s and cancels obsolete context', async (condition) => {
      const { props } = await mount('graph');
      let dialog: HTMLElement | undefined;
      if (condition === 'blocked') props.blocked = true;
      if (condition === 'hidden-sidebar') props.available = false;
      if (condition === 'background') event('blur');
      if (condition === 'dialog') {
        dialog = document.createElement('div'); dialog.role = 'dialog'; document.body.append(dialog);
        vi.spyOn(dialog, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
      }
      if (condition === 'drag') event('pointerdown');
      if (condition === 'composition') event('compositionstart');
      await nextTick(); await time(helpTiming.idle * 2);
      expect(find('.help-bubble')).toBeNull();
      props.context = 'plan'; props.blocked = false; props.available = true;
      dialog?.remove(); event('pointerup'); event('compositionend'); event('focus');
      await nextTick(); await time(helpTiming.dwell);
      expect(find('.help-bubble')?.textContent).toContain('日、周或月');
    },
  );

  it('ignores hidden editor menus and pre-mounted dialogs', async () => {
    const hiddenMenu = document.createElement('div'); hiddenMenu.className = 'tano-editor-panel'; hiddenMenu.hidden = true;
    const closedDialog = document.createElement('section'); closedDialog.role = 'dialog'; closedDialog.style.display = 'none';
    document.body.append(hiddenMenu, closedDialog);
    await mount('document'); await time(helpTiming.warmup);
    expect(find('.help-bubble')).not.toBeNull();
  });

  it('detects pointer release even when an editor stops bubbling', async () => {
    await mount('graph');
    const editor = document.createElement('div'); document.body.append(editor);
    editor.addEventListener('pointerup', event => event.stopPropagation());
    event('pointerdown', editor); await time(helpTiming.warmup);
    expect(find('.help-bubble')).toBeNull();
    event('pointerup', editor); await time(helpTiming.quiet);
    expect(find('.help-bubble')).not.toBeNull();
  });

  it('dismisses on typing without consuming Escape in the editor', async () => {
    await mount(); await time(helpTiming.warmup);
    expect(find('.help-bubble')).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape); await nextTick();
    expect(escape.defaultPrevented).toBe(false); expect(find('.help-bubble')).toBeNull();
  });

  it('snoozes dismissed tips, persists opt-out across mounts and keeps manual help available', async () => {
    const { props, preferenceControl } = await mount(); await time(helpTiming.warmup);
    find('[aria-label="暂时不提示"]')?.click(); await nextTick();
    expect(readHelpPreferences().snoozedUntil).toBe(Date.now() + helpTiming.snooze);
    props.context = 'graph'; await nextTick(); await time(helpTiming.cooldown);
    expect(find('.help-bubble')).toBeNull();
    preferenceControl.setEnabled(false); await nextTick();
    expect(readHelpPreferences().enabled).toBe(false);
    app?.unmount(); root.remove();
    const second = await mount('plan'); await time(helpTiming.snooze * 2);
    expect(find('.help-bubble')).toBeNull();
    second.trigger.click(); await nextTick();
    expect(second.preferenceControl.preferences.value.enabled).toBe(false);
    expect(find('[role="switch"]')).toBeNull();
    expect(find('[role="dialog"]')).not.toBeNull();
  });

  it('immediately applies same-page settings changes and lets settings re-enable tips', async () => {
    const { props, preferenceControl } = await mount('document'); await time(helpTiming.warmup);
    expect(find('.help-bubble')).not.toBeNull();
    preferenceControl.setEnabled(false); await nextTick();
    expect(find('.help-bubble')).toBeNull();
    props.context = 'graph'; await nextTick(); await time(helpTiming.cooldown);
    expect(find('.help-bubble')).toBeNull();
    preferenceControl.setEnabled(true); await nextTick();
    expect(find('.help-bubble')).toBeNull();
    await time(helpTiming.quiet);
    expect(find('.help-bubble')?.textContent).toContain('节点');
    await click('不再提示');
    expect(preferenceControl.preferences.value.enabled).toBe(false);
  });

  it('honors the persisted daily cap and changes to preferences in another window', async () => {
    const now = Date.now();
    localStorage.setItem(helpPreferenceKey, JSON.stringify({ day: '2026-10-8', count: 2, lastShown: now - helpTiming.cooldown }));
    await mount('graph'); await time(helpTiming.idle); expect(find('.help-bubble')).toBeNull();
    vi.setSystemTime(new Date(2026, 9, 9, 10)); await time(1000);
    expect(find('.help-bubble')).not.toBeNull();
    localStorage.setItem(helpPreferenceKey, JSON.stringify({ ...readHelpPreferences(), enabled: false }));
    window.dispatchEvent(new StorageEvent('storage', { key: helpPreferenceKey })); await nextTick();
    expect(find('.help-bubble')).toBeNull();
  });

  it('pauses expiry while reading the bubble and opens its matching guide only on request', async () => {
    const { props, documentation } = await mount('graph'); props.native = true;
    await time(helpTiming.warmup);
    event('pointerenter', find('.help-bubble')!); await time(helpTiming.duration * 2);
    expect(find('.help-bubble')).not.toBeNull();
    expect(documentation).not.toHaveBeenCalled();
    expect(find('.help-bubble a')?.getAttribute('href')).toBe('http://127.0.0.1:43941/zh-cn/docs/organize');
    await click('了解用法');
    expect(find('.help-bubble')).toBeNull(); expect(find('.help-article')).toBeNull();
    expect(documentation).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:43941/zh-cn/docs/organize');
  });

  it('survives malformed or unavailable device preferences and cleans up timers', async () => {
    localStorage.setItem(helpPreferenceKey, '{bad');
    expect(readHelpPreferences().enabled).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    const { trigger, preferenceControl } = await mount(); await time(helpTiming.warmup);
    expect(find('.help-bubble')).not.toBeNull(); await click('不再提示');
    expect(preferenceControl.preferences.value.enabled).toBe(false);
    trigger.click(); await nextTick(); expect(find('[role="dialog"]')).not.toBeNull();
    app?.unmount(); app = undefined;
    await time(1000);
    expect(vi.getTimerCount()).toBe(0); expect(find('.help-popover')).toBeNull();
  });
});
