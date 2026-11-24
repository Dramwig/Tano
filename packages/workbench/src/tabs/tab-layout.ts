// Hit testing must ignore the animated preview, including intermediate frames.
export function tabLayoutRect(tab: HTMLElement) {
  const box = tab.getBoundingClientRect();
  const transform = getComputedStyle(tab).transform;
  const values = transform.match(/^matrix\((.+)\)$/)?.[1]?.split(',').map(Number);
  const offset = values?.[4] ?? 0;
  return { left: box.left - offset, right: box.right - offset, width: box.width };
}
