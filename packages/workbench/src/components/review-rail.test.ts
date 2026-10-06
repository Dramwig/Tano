// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { animate } from 'motion/mini';
import { removeReviewRail, updateReviewRail } from './review-rail';

vi.mock('motion/mini', () => ({ animate: vi.fn(() => ({ stop: vi.fn(), finished: Promise.resolve() })) }));
afterEach(() => { vi.mocked(animate).mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('orders both kinds by anchor and pushes every later card down when either kind expands', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const make = (height: number) => {
    const element = document.createElement('div');
    const content = document.createElement('div');
    content.style.height = `${height}px`;
    element.append(content); parent.append(element);
    return element;
  };
  const first = make(50), middle = make(50), last = make(50);
  const comments = {}, suggestions = {};
  try {
    const commentEntries = [{ id: 'comment:a', element: first, anchor: 100 }, { id: 'comment:b', element: last, anchor: 150 }];
    const suggestionEntries = [{ id: 'suggestion:a', element: middle, anchor: 120 }];
    updateReviewRail(comments, parent, commentEntries);
    updateReviewRail(suggestions, parent, suggestionEntries);
    expect([first.style.top, middle.style.top, last.style.top]).toEqual(['100px', '162px', '224px']);
    (middle.firstElementChild as HTMLElement).style.height = '300px';
    updateReviewRail(suggestions, parent, suggestionEntries);
    expect(last.style.top).toBe('474px');
    (first.firstElementChild as HTMLElement).style.height = '200px';
    updateReviewRail(comments, parent, commentEntries);
    expect([middle.style.top, last.style.top]).toEqual(['312px', '624px']);
    (middle.firstElementChild as HTMLElement).style.height = '50px';
    updateReviewRail(suggestions, parent, suggestionEntries);
    expect(last.style.top).toBe('374px');
    removeReviewRail(suggestions);
    expect(last.style.top).toBe('312px');
  } finally { removeReviewRail(comments); removeReviewRail(suggestions); parent.remove(); }
});

it('moves comments, drafts and suggestions below wide tables without shrinking the tables', () => {
  const parent = document.createElement('div');
  parent.innerHTML = '<div class="ProseMirror"><div class="tano-table-viewport"></div><div class="tano-table-viewport"></div></div>';
  document.body.append(parent);
  // Coordinates remain relative to the document even when its top is outside the viewport.
  parent.getBoundingClientRect = () => new DOMRect(0, -200, 1600, 1200);
  parent.firstElementChild!.getBoundingClientRect = () => new DOMRect(250, -200, 780, 1200);
  const tables = [...parent.querySelectorAll<HTMLElement>('.tano-table-viewport')];
  let tableWidth = 1600;
  tables[0]!.getBoundingClientRect = () => new DOMRect(0, 0, tableWidth, 100);
  tables[1]!.getBoundingClientRect = () => new DOMRect(0, 170, tableWidth, 100);
  const make = (height: number) => {
    const element = document.createElement('div');
    element.innerHTML = `<div style="height: ${height}px"></div>`;
    element.getBoundingClientRect = () => new DOMRect(1054, 0, 320, height);
    parent.append(element);
    return element;
  };
  const first = make(50), draft = make(80), suggestion = make(50);
  const comments = {}, suggestions = {};
  const commentEntries = [{ id: 'comment:a', element: first, anchor: 100 }, { id: 'comment:@draft', element: draft, anchor: 180 }];
  const suggestionEntries = [{ id: 'suggestion:a', element: suggestion, anchor: 190 }];
  try {
    updateReviewRail(comments, parent, commentEntries);
    updateReviewRail(suggestions, parent, suggestionEntries);
    // The first card fits above the table. The draft cannot fit between the two tables.
    expect([first.style.top, draft.style.top, suggestion.style.top]).toEqual(['100px', '482px', '574px']);
    expect(tables.every(table => table.style.width === '' && !table.classList.contains('has-comments'))).toBe(true);

    // A taller card now reaches the first table and pushes the later cards down in order.
    (first.firstElementChild as HTMLElement).style.height = '100px';
    updateReviewRail(comments, parent, commentEntries);
    expect([first.style.top, draft.style.top, suggestion.style.top]).toEqual(['482px', '594px', '686px']);

    // When the tables return to the prose width, all cards return to their anchors/stack.
    tableWidth = 780;
    updateReviewRail(suggestions, parent, suggestionEntries);
    expect([first.style.top, draft.style.top, suggestion.style.top]).toEqual(['100px', '212px', '304px']);

    // Annotated tables reserve their own gutter, including while their width is animating.
    tableWidth = 1600;
    tables.forEach(table => table.classList.add('has-comments'));
    updateReviewRail(comments, parent, commentEntries);
    expect([first.style.top, draft.style.top, suggestion.style.top]).toEqual(['100px', '212px', '304px']);

    tables.forEach(table => table.remove());
    updateReviewRail(suggestions, parent, suggestionEntries);
    expect(first.style.top).toBe('100px');
  } finally { removeReviewRail(comments); removeReviewRail(suggestions); parent.remove(); }
});

it('ignores tables outside the card lane or in another document', () => {
  const parent = document.createElement('div');
  parent.innerHTML = '<div class="ProseMirror"><div class="tano-table-viewport"></div></div><div class="review-card"><div style="height: 80px"></div></div>';
  const other = parent.cloneNode(true) as HTMLElement;
  document.body.append(parent, other);
  const owner = {};
  const card = parent.querySelector<HTMLElement>('.review-card')!;
  card.getBoundingClientRect = () => new DOMRect(1054, 100, 320, 80);
  parent.querySelector('.ProseMirror')!.getBoundingClientRect = () => new DOMRect(250, 0, 780, 900);
  parent.querySelector('.tano-table-viewport')!.getBoundingClientRect = () => new DOMRect(0, 100, 1000, 200);
  other.querySelector('.ProseMirror')!.getBoundingClientRect = () => new DOMRect(250, 0, 780, 900);
  other.querySelector('.tano-table-viewport')!.getBoundingClientRect = () => new DOMRect(0, 100, 1600, 200);
  try {
    updateReviewRail(owner, parent, [{ id: 'comment:a', element: card, anchor: 100 }]);
    expect(card.style.top).toBe('100px');
  } finally { removeReviewRail(owner); parent.remove(); other.remove(); }
});

it('pins the selected card and animates cards above and below it, then restores normal stacking', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const make = (height: number) => {
    const card = document.createElement('div');
    card.innerHTML = `<div style="height: ${height}px"></div>`;
    card.getBoundingClientRect = () => new DOMRect(1054, parseFloat(card.style.top) || 0, 320, height);
    parent.append(card);
    return card;
  };
  const first = make(80), middle = make(100), last = make(80);
  const comments = {}, suggestions = {};
  const commentEntries = [{ id: 'comment:a', element: first, anchor: 300 }, { id: 'comment:b', element: last, anchor: 330 }];
  const entry = { id: 'suggestion:a', element: middle, anchor: 320, selected: false };
  try {
    updateReviewRail(comments, parent, commentEntries);
    updateReviewRail(suggestions, parent, [{ ...entry }]);
    expect([first.style.top, middle.style.top, last.style.top]).toEqual(['300px', '392px', '504px']);
    for (const card of [first, middle, last]) {
      card.animate = vi.fn();
      card.getClientRects = () => [card.getBoundingClientRect()] as unknown as DOMRectList;
    }
    entry.selected = true;
    updateReviewRail(suggestions, parent, [{ ...entry }]);
    expect([first.style.top, middle.style.top, last.style.top]).toEqual(['228px', '320px', '432px']);
    for (const card of [first, middle, last]) expect(animate).toHaveBeenCalledWith(card,
      expect.objectContaining({ transform: ['translateY(72px)', 'translateY(0px)'] }),
      { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
    await Promise.resolve();
    // Replies can grow without moving the selected card away from its line.
    (middle.firstElementChild as HTMLElement).style.height = '200px';
    updateReviewRail(suggestions, parent, [{ ...entry }]);
    expect(middle.style.top).toBe('320px');
    expect(last.style.top).toBe('532px');
    entry.selected = false;
    updateReviewRail(suggestions, parent, [{ ...entry }]);
    expect([first.style.top, middle.style.top, last.style.top]).toEqual(['300px', '392px', '604px']);
    await Promise.resolve();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.mocked(animate).mockClear();
    entry.selected = true;
    updateReviewRail(suggestions, parent, [{ ...entry }]);
    expect(middle.style.top).toBe('320px');
    expect(animate).not.toHaveBeenCalled();
  } finally { removeReviewRail(comments); removeReviewRail(suggestions); parent.remove(); }
});

it('keeps the most recently selected kind pinned across independent rail updates', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const make = () => {
    const element = document.createElement('div');
    element.innerHTML = '<div style="height: 80px"></div>';
    parent.append(element);
    return element;
  };
  const comment = make(), suggestion = make();
  const comments = {}, suggestions = {};
  const commentEntry = { id: 'comment:a', element: comment, anchor: 300, selected: true };
  const suggestionEntry = { id: 'suggestion:a', element: suggestion, anchor: 320, selected: true };
  try {
    updateReviewRail(comments, parent, [{ ...commentEntry }]);
    updateReviewRail(suggestions, parent, [{ ...suggestionEntry }]);
    expect([comment.style.top, suggestion.style.top]).toEqual(['228px', '320px']);
    updateReviewRail(comments, parent, [{ ...commentEntry }]);
    expect(suggestion.style.top).toBe('320px');
    updateReviewRail(comments, parent, [{ ...commentEntry, selected: false }]);
    updateReviewRail(comments, parent, [{ ...commentEntry }]);
    expect([comment.style.top, suggestion.style.top]).toEqual(['300px', '392px']);
  } finally { removeReviewRail(comments); removeReviewRail(suggestions); parent.remove(); }
});

it.each(['comment:a', 'suggestion:a'])('lets a selected card overlap a wide table and moves displaced cards into reachable space (%s)', id => {
  const parent = document.createElement('div');
  parent.innerHTML = '<div class="ProseMirror"><div class="tano-table-viewport"></div></div>';
  document.body.append(parent);
  parent.querySelector('.ProseMirror')!.getBoundingClientRect = () => new DOMRect(250, 0, 780, 900);
  const table = parent.querySelector<HTMLElement>('.tano-table-viewport')!;
  table.getBoundingClientRect = () => new DOMRect(0, 120, 1600, 200);
  const make = () => {
    const element = document.createElement('div');
    element.innerHTML = '<div style="height: 80px"></div>';
    element.getBoundingClientRect = () => new DOMRect(1054, 0, 320, 80);
    parent.append(element);
    return element;
  };
  const first = make(), active = make(), last = make();
  const owner = {};
  const entries = [{ id: 'comment:before', element: first, anchor: 90 },
    { id, element: active, anchor: 100, selected: false }, { id: 'suggestion:after', element: last, anchor: 110 }];
  try {
    updateReviewRail(owner, parent, entries);
    expect([first.style.top, active.style.top, last.style.top]).toEqual(['332px', '424px', '516px']);
    updateReviewRail(owner, parent, entries.map(entry => ({ ...entry, selected: entry.element === active })));
    expect([first.style.top, active.style.top, last.style.top]).toEqual(['8px', '100px', '332px']);
    expect(table.style.width).toBe('');
    // Too little room above: keep the earlier card reachable below, without moving the active one.
    (first.firstElementChild as HTMLElement).style.height = '200px';
    updateReviewRail(owner, parent, entries.map(entry => ({ ...entry, selected: entry.element === active })));
    expect([first.style.top, active.style.top, last.style.top]).toEqual(['332px', '100px', '544px']);
    updateReviewRail(owner, parent, entries);
    expect([first.style.top, active.style.top, last.style.top]).toEqual(['332px', '544px', '636px']);
  } finally { removeReviewRail(owner); parent.remove(); }
});
