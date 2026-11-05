// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyAppearance, applyTheme, resolvedTheme } from '../theme';
import type { TanoPluginViewApi } from '../plugin-sdk';
import { createPluginUiSandbox } from './ui-sandbox';
import clientSource from './ui-client.js?raw';

afterEach(() => { applyAppearance(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('sends the initial theme before UI code, updates live without replacing business state, and releases listeners', () => {
  const port = { postMessage: vi.fn(), close: vi.fn(), onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
  const peer = { close: vi.fn() };
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = peer; });
  applyTheme('light');
  const colors = { id: 'paper', light: { paper: '#fff4da' }, dark: { paper: '#241e15' } };
  const shape = { id: 'sample:crisp', label: '直角', tokens: { 'radius-card': '0px' } };
  applyAppearance(colors, undefined, shape);
  const root = document.createElement('div'); document.body.append(root);
  const receive = vi.fn().mockResolvedValue(undefined), failed = vi.fn();
  const sandbox = createPluginUiSandbox(root, { html: '', css: '', source: 'void 0' }, { count: 7 }, receive, failed);
  const frame = root.querySelector('iframe')!;
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  frame.dispatchEvent(new Event('load'));
  const initialization = posted.mock.calls[0]![0] as { clientSource: string; state: unknown };
  expect(initialization.clientSource).toMatch(/^const initialTheme = .*"paper":"#fff4da"/);
  const initial = JSON.parse(initialization.clientSource.split('\n')[0]!.slice('const initialTheme = '.length, -1));
  expect(initial).toMatchObject({ version: 2, shape });
  expect(initialization.state).toEqual({ count: 7 });
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  port.onmessage!({ data: { type: 'ready' } });
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'state', state: { count: 7 } });
  port.postMessage.mockClear(); applyTheme('dark');
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'theme', theme: { version: 2, mode: 'dark', shape, tokens: { paper: '#241e15', 'radius-card': '0px' } } });
  port.postMessage.mockClear();
  applyAppearance(colors, undefined, { id: 'sample:rounded', label: '圆润', tokens: { 'radius-card': '18px' } });
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'theme', theme: expect.objectContaining({
    shape: { id: 'sample:rounded', label: '圆润', tokens: { 'radius-card': '18px' } },
  }) });
  port.postMessage.mockClear(); applyAppearance();
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'theme', theme: expect.objectContaining({
    shape: { id: 'builtin:tano', label: '同页默认', tokens: {} },
  }) });
  expect(root.querySelector('iframe')).toBe(frame);
  port.postMessage.mockClear(); applyAppearance({ light: { paper: '#fff' } }, undefined, undefined, 'dark');
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'theme', theme: expect.objectContaining({ mode: 'light', tokens: { paper: '#fff' } }) });
  port.postMessage.mockClear(); applyTheme('system');
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'theme', theme: expect.objectContaining({ mode: 'light' }) });
  sandbox.dispose(); sandbox.dispose();
  port.postMessage.mockClear(); applyAppearance(); applyTheme('light');
  expect(port.postMessage).not.toHaveBeenCalled(); expect(port.close).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce();
  expect(root.querySelector('iframe')).toBeNull(); expect(failed).not.toHaveBeenCalled();
});

it('installs immutable v2 shape snapshots in the real UI client without changing business state', async () => {
  const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = '<div id="app"></div>';
  const events = new EventTarget(), parent = { postMessage: vi.fn() };
  const port = { postMessage: vi.fn(), onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
  applyAppearance(undefined, { id: 'builtin:islands', label: '卡片岛', structure: 'islands', surface: 'flat' },
    { id: 'sample:crisp', label: '直角', tokens: { 'radius-card': '0px' } }, 'light');
  const initial = resolvedTheme();
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const start = new AsyncFunction('initialTheme', 'document', 'parent', 'console', 'addEventListener', 'removeEventListener', `${clientSource}\nreturn tanoView;`);
  const loading: Promise<TanoPluginViewApi> = start(initial, doc, parent, {}, events.addEventListener.bind(events), events.removeEventListener.bind(events));
  expect(parent.postMessage).toHaveBeenCalledWith({ type: 'tano-view-connect' }, '*');
  events.dispatchEvent(Object.assign(new Event('message'), { source: parent,
    data: { type: 'tano-view-channel', html: '<p>插件</p>', css: '', state: { count: 7 } }, ports: [port] }));
  const api = await loading;
  expect(api.theme()).toEqual(initial);
  for (const object of [api.theme(), api.theme().tokens, api.theme().layout, api.theme().shape, api.theme().shape.tokens]) expect(Object.isFrozen(object)).toBe(true);
  Reflect.set(initial.shape.tokens, 'radius-card', '24px'); // The client owns a copy of the sender's tokens.
  expect(api.theme().shape.tokens['radius-card']).toBe('0px');
  const state = vi.fn(), theme = vi.fn();
  const unsubscribeState = api.onState(state), unsubscribeTheme = api.onTheme(theme);
  await Promise.resolve();
  expect(state).toHaveBeenCalledExactlyOnceWith({ count: 7 });
  expect(theme).toHaveBeenCalledOnce(); theme.mockClear();
  applyAppearance(undefined, undefined, { id: 'sample:rounded', label: '圆润', tokens: { 'radius-card': '18px' } }, 'dark');
  port.onmessage!({ data: { type: 'theme', theme: resolvedTheme() } });
  expect(api.theme()).toMatchObject({ version: 2, mode: 'dark', shape: { id: 'sample:rounded' } });
  expect(doc.documentElement.dataset.shapeTheme).toBe('sample:rounded');
  expect(doc.documentElement.style.getPropertyValue('--radius-card')).toBe('18px');
  expect(state).toHaveBeenCalledOnce(); expect(theme).toHaveBeenCalledOnce();
  applyAppearance(); port.onmessage!({ data: { type: 'theme', theme: resolvedTheme() } });
  expect(api.theme().shape.id).toBe('builtin:tano');
  expect(doc.documentElement.dataset.shapeTheme).toBe('builtin:tano');
  expect(doc.documentElement.dataset.layout).toBe('continuous');
  expect(doc.documentElement.style.getPropertyValue('--radius-card')).toBe('');
  expect(state).toHaveBeenCalledOnce(); expect(theme).toHaveBeenCalledTimes(2);
  unsubscribeState(); unsubscribeTheme();
  port.onmessage!({ data: { type: 'theme', theme: resolvedTheme() } });
  expect(theme).toHaveBeenCalledTimes(2);
});
