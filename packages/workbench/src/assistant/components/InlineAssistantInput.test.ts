// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import InlineAssistantInput from './InlineAssistantInput.vue';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });

function mount(message: string, initialState: 'response' | 'loading' = 'response', rects = [new DOMRect(100, 100, 200, 20)]) {
  root = document.createElement('div'); document.body.append(root);
  const state = ref<'response' | 'loading'>(initialState);
  const close = vi.fn(), stop = vi.fn(), conversation = vi.fn();
  const anchor = { element: root, getRects: () => rects, dispose: vi.fn() };
  app = createApp(() => h(InlineAssistantInput, { anchor, state: state.value, message, value: '',
    onClose: close, onStop: stop, onConversation: conversation }));
  app.mount(root);
  return { state, close, stop, conversation };
}
it('expands multiline Markdown, preserves paragraphs and bold text, and can collapse and reopen', async () => {
  const { conversation, close } = mount('第一段说明。\n\n意思是：**清楚地传达更多信息**。');
  await vi.waitFor(() => expect(document.querySelector('.inline-assistant-response strong')?.textContent).toBe('清楚地传达更多信息'));
  expect(document.querySelectorAll('.inline-assistant-response p')).toHaveLength(2);
  const collapse = document.querySelector<HTMLButtonElement>('[aria-label="收起回复"]')!;
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  collapse.click(); await nextTick();
  expect(document.querySelector('.inline-assistant-response')).toBeNull();
  document.querySelector<HTMLButtonElement>('[aria-label="展开回复"]')!.click(); await nextTick();
  expect(document.querySelector('.inline-assistant-response')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('.inline-assistant-conversation')!.click();
  expect(conversation).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
});
it('keeps short replies compact and preserves outside-dismiss and stop behavior while loading', async () => {
  const { state, close, stop } = mount('收到，测试正常。');
  await nextTick();
  expect(document.querySelector('.inline-assistant-message')?.textContent).toBe('收到，测试正常。');
  expect(document.querySelector('[aria-label="展开回复"]')).not.toBeNull();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(close).toHaveBeenCalledOnce(); close.mockClear();
  state.value = 'loading'; await nextTick();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(close).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[aria-label="停止助手生成"]')!.click();
  expect(stop).toHaveBeenCalledOnce();
});
it('expands a long single-paragraph reply after loading without relying on anchor geometry or layout measurements', async () => {
  const text = '收到处理要求“test”，但这不是一个明确的处理指令。请说明要怎样修改选中的文字，我才能继续处理。';
  const { state } = mount(text, 'loading', []);
  expect(document.querySelector('.inline-assistant-response')).toBeNull();
  state.value = 'response'; await nextTick();
  await vi.waitFor(() => expect(document.querySelector('.inline-assistant-response .ProseMirror')?.textContent).toBe(text));
  document.querySelector<HTMLButtonElement>('[aria-label="收起回复"]')!.click(); await nextTick();
  expect(document.querySelector('.inline-assistant-message')?.textContent).toBe(text);
  expect(document.querySelector('[aria-label="展开回复"]')).not.toBeNull();
});

it('fades only content beyond the scroll edges and keeps the first and last lines clear', async () => {
  mount('第一段说明。\n\n最后一段说明。');
  await vi.waitFor(() => expect(document.querySelector('.inline-assistant-response .ProseMirror')).not.toBeNull());
  const response = document.querySelector<HTMLElement>('.inline-assistant-response')!;
  let contentHeight = 600;
  Object.defineProperties(response, {
    scrollHeight: { get: () => contentHeight },
    clientHeight: { get: () => 240 },
  });
  const scrollTo = (top: number) => {
    response.scrollTop = top;
    response.dispatchEvent(new Event('scroll'));
    return [response.style.getPropertyValue('--response-top-fade-strength'),
      response.style.getPropertyValue('--response-bottom-fade-strength')];
  };
  expect(scrollTo(0)).toEqual(['0', '1']);
  expect(scrollTo(14)).toEqual(['0.5', '1']);
  expect(scrollTo(100)).toEqual(['1', '1']);
  expect(scrollTo(360)).toEqual(['1', '0']);
  contentHeight = 240;
  expect(scrollTo(0)).toEqual(['0', '0']);
});
