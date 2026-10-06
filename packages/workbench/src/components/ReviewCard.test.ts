// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { animate } from 'motion/mini';
import ReviewCard from './ReviewCard.vue';

vi.mock('motion/mini', () => ({ animate: vi.fn(() => ({ stop: vi.fn(), finished: Promise.resolve() })) }));
let app: ReturnType<typeof createApp>;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.mocked(animate).mockClear(); });

it('animates selection and deselection horizontally without replacing the rail transform', async () => {
  const originalStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = originalStyle(element);
    Object.defineProperty(style, 'translate', { value: element.classList.contains('is-expanded') ? '-12px 0px' : '0px 0px' });
    return style;
  });
  const expanded = ref(false);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(ReviewCard, { expanded: expanded.value }, () => '批注'));
  app.mount(root);
  const card = root.firstElementChild as HTMLElement;
  card.animate = vi.fn(() => ({} as Animation));
  card.style.transform = 'translateY(8px)';
  expanded.value = true;
  await nextTick(); await nextTick();
  expect(animate).toHaveBeenLastCalledWith(card, { translate: ['0px 0px', '-12px 0px'] },
    { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
  expanded.value = false;
  await nextTick(); await nextTick();
  expect(animate).toHaveBeenLastCalledWith(card, { translate: ['-12px 0px', '0px 0px'] },
    { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
  expect(card.style.transform).toBe('translateY(8px)');
});
