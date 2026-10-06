import { animate } from 'motion/mini';

type Entry = { id: string; element: HTMLElement; anchor: number; selected?: boolean };
type State = { target: string; motion?: ReturnType<typeof animate> };
const groups = new Map<object, { parent: HTMLElement; entries: Entry[] }>();
const states = new WeakMap<HTMLElement, State>();
const snapshots = new WeakMap<HTMLElement, DOMRect>();
const selections = new WeakMap<HTMLElement, number>();
let selectionOrder = 0;

export function captureReviewRail(owner: object) {
  for (const { element } of groups.get(owner)?.entries ?? []) snapshots.set(element, element.getBoundingClientRect());
}

export function reviewCardHeight(card: HTMLElement) {
  const content = card.firstElementChild as HTMLElement | null;
  if (!content) return card.offsetHeight;
  const style = getComputedStyle(card);
  return (parseFloat(getComputedStyle(content).height) || content.offsetHeight) +
    [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
      .reduce((total, value) => total + (parseFloat(value) || 0), 0);
}

function arrange(parent: HTMLElement) {
  const entries = [...groups.values()].filter(group => group.parent === parent).flatMap(group => group.entries)
    .filter(entry => entry.element.isConnected).sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id));
  const origin = parent.getBoundingClientRect().top;
  // Expanded table viewports occupy the page margins, including their scroll/control area.
  // Tables with their own annotations already reserve the gutter in the editor.
  const tables = [...parent.querySelectorAll<HTMLElement>('.tano-table-viewport:not(.has-comments)')]
    .flatMap(viewport => {
      const prose = viewport.closest('.ProseMirror');
      const bounds = viewport.getBoundingClientRect();
      return prose && bounds.height > 0 && bounds.width > prose.getBoundingClientRect().width + 1
        ? [bounds] : [];
    }).sort((a, b) => a.top - b.top);
  const measured = entries.map(entry => {
    const card = entry.element;
    const height = reviewCardHeight(card);
    const style = getComputedStyle(card);
    const outset = parseFloat(style.getPropertyValue('--annotation-card-outset')) || 0;
    const lift = parseFloat(style.getPropertyValue('--annotation-card-lift')) || 0;
    const cardBounds = card.getBoundingClientRect();
    return { ...entry, height, style, outset, lift, cardBounds, top: 0 };
  });
  const avoidTables = (item: typeof measured[number], top: number, upward = false) => {
    const { cardBounds, height, lift } = item;
    for (const table of upward ? [...tables].reverse() : tables) {
      if (cardBounds.right > table.left && cardBounds.left < table.right &&
          top + lift + height > table.top - origin - 12 && top + lift < table.bottom - origin + 12) {
        top = upward ? table.top - origin - 12 - height - lift : table.bottom - origin + 12 - lift;
      }
    }
    return top;
  };
  const stackDown = (items: typeof measured, start: number) => {
    let bottom = start;
    for (const item of items) {
      item.top = avoidTables(item, Math.max(item.anchor, bottom) - item.lift);
      bottom = item.top + item.lift + item.height + 12;
    }
  };
  const selected = measured.reduce((chosen, item, index) => item.selected &&
    (chosen < 0 || (selections.get(item.element) ?? 0) > (selections.get(measured[chosen]!.element) ?? 0)) ? index : chosen, -1);
  if (selected < 0) stackDown(measured, 0);
  else {
    // Selection pins the card to its text even over a wide table. Pack in both directions.
    const active = measured[selected]!;
    active.top = active.anchor - active.lift;
    let ceiling = active.anchor;
    let overflow = selected;
    for (let index = selected - 1; index >= 0; index--) {
      const item = measured[index]!;
      const top = avoidTables(item, Math.min(item.anchor, ceiling - 12 - item.height) - item.lift, true);
      if (top + item.lift < 0) break;
      item.top = top;
      ceiling = top + item.lift;
      overflow = index;
    }
    // Near the document start, keep displaced cards reachable below the selection.
    stackDown([...measured.slice(0, overflow), ...measured.slice(selected + 1)], active.anchor + active.height + 12);
  }
  for (const { element: card, top, height, style, outset, lift } of measured) {
    const target = JSON.stringify([top, height, outset, lift]);
    const previous = states.get(card);
    if (previous?.target === target) { snapshots.delete(card); continue; }
    const bounds = snapshots.get(card) ?? card.getBoundingClientRect();
    snapshots.delete(card);
    const padding = parseFloat(style.paddingLeft) || 12;
    const margin = parseFloat(style.marginLeft) || 0;
    previous?.motion?.stop();
    card.style.top = `${top}px`;
    const state: State = { target };
    states.set(card, state);
    if (!card.animate || !card.getClientRects().length || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
    const offset = previous ? bounds.top - card.getBoundingClientRect().top : 8;
    state.motion = animate(card, {
      transform: [`translateY(${offset + lift}px)`, `translateY(${lift}px)`],
      width: [`${bounds.width}px`, `${320 + outset * 2}px`],
      marginLeft: [`${margin}px`, `${-outset}px`],
      paddingLeft: [`${padding}px`, `${12 + outset}px`],
      paddingRight: [`${padding}px`, `${12 + outset}px`],
      height: [`${bounds.height}px`, `${height}px`],
      opacity: [previous ? 1 : 0, 1],
    }, { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
    void state.motion.finished.then(() => {
      if (states.get(card) !== state) return;
      state.motion?.stop();
      state.motion = undefined;
      for (const property of ['height', 'width', 'margin-left', 'padding-left', 'padding-right', 'transform', 'opacity']) card.style.removeProperty(property);
    });
  }
}

export function updateReviewRail(owner: object, parent: HTMLElement, entries: Entry[]) {
  const old = groups.get(owner);
  for (const entry of entries) if (entry.selected && !old?.entries.some(previous => previous.element === entry.element && previous.selected)) {
    selections.set(entry.element, ++selectionOrder);
  }
  for (const entry of old?.entries ?? []) if (!entries.some(next => next.element === entry.element)) {
    states.get(entry.element)?.motion?.stop();
    states.delete(entry.element);
    snapshots.delete(entry.element);
  }
  groups.set(owner, { parent, entries });
  arrange(parent);
}

export function removeReviewRail(owner: object) {
  const group = groups.get(owner);
  if (!group) return;
  groups.delete(owner);
  for (const { element } of group.entries) {
    states.get(element)?.motion?.stop();
    states.delete(element);
    snapshots.delete(element);
    for (const property of ['top', 'height', 'width', 'margin-left', 'padding-left', 'padding-right', 'transform', 'opacity']) element.style.removeProperty(property);
  }
  arrange(group.parent);
}
