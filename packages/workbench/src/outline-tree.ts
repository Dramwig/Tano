/** Keep roots visible and expand only the active heading and its ancestors. */
export function focusedOutlineIndices(headings: readonly { level: number }[], activeIndex: number): Set<number> {
  const parents: (number | undefined)[] = [];
  const stack: number[] = [];
  headings.forEach((heading, index) => {
    while (stack.length && headings[stack[stack.length - 1]].level >= heading.level) stack.pop();
    parents[index] = stack[stack.length - 1];
    stack.push(index);
  });
  const expanded = new Set<number>();
  let current: number | undefined = activeIndex >= 0 && activeIndex < headings.length ? activeIndex : undefined;
  while (current !== undefined) {
    expanded.add(current);
    current = parents[current];
  }
  return new Set(headings.flatMap((_, index) =>
    parents[index] === undefined || expanded.has(parents[index]!) ? [index] : [],
  ));
}
