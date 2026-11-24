import { nextTick, ref, shallowRef } from 'vue';
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Mark } from '@milkdown/kit/prose/model';
import { floatingPanelPosition, type PanelSide } from '../core/panel-position';
import { activateEditorPanel, announceEditorPanel, onOtherEditorPanel } from '../core/editor-panel';

export type LinkPanel =
  | {
      kind: 'wiki';
      pos: number;
      target: string;
      label: string;
      explicitLabel: boolean;
      x: number;
      y: number;
    }
  | {
      kind: 'link';
      from: number;
      to: number;
      text: string;
      href: string;
      title: string;
      x: number;
      y: number;
    };

export type LinkPanelField = 'text' | 'href' | 'title' | 'target' | 'label';

export function linkMarkRange(view: EditorView, link: Element) {
  const pos = view.posAtDOM(link, 0);
  for (const candidate of [pos, pos - 1]) {
    if (candidate < 0) continue;
    const $pos = view.state.doc.resolve(candidate);
    const parent = $pos.parent;
    if (!parent.inlineContent) continue;
    const start = $pos.start();
    let offset = 0;
    const runs: { from: number; to: number; mark: Mark }[] = [];
    parent.forEach((node) => {
      const mark = node.marks.find((item) => item.type.name === 'link');
      if (mark) runs.push({ from: start + offset, to: start + offset + node.nodeSize, mark });
      offset += node.nodeSize;
    });
    const hit = runs.find((run) => run.from <= candidate && candidate < run.to);
    if (!hit) continue;
    let from = hit.from;
    let to = hit.to;
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index]!;
      if (run.to === from && run.mark.eq(hit.mark)) from = run.from;
    }
    for (const run of runs) {
      if (run.from === to && run.mark.eq(hit.mark)) to = run.to;
    }
    return { from, to, mark: hit.mark };
  }
  return null;
}

export interface LinkPanelControllerOptions {
  window: Window;
  getEditor: () => Editor | undefined;
  getView: () => EditorView | undefined;
  readonly: () => boolean;
  revealMarkdown: () => boolean;
}

export function createLinkPanelController(options: LinkPanelControllerOptions) {
  const { window, getEditor, getView, readonly, revealMarkdown } = options;

  const linkModifier = ref(false);
  const linkPanel = shallowRef<LinkPanel | null>(null);
  const linkPanelElement = ref<HTMLElement>();
  const linkPanelFirstInput = ref<HTMLInputElement>();
  let linkPanelAnchor: Element | null = null;
  let linkPanelSide: PanelSide | undefined;
  let linkPanelWriting = false;
  let stopLinkPanel: (() => void) | undefined;
  let stopOtherLinkPanel: (() => void) | undefined;

  function closeLinkPanel() {
    stopLinkPanel?.();
    stopLinkPanel = undefined;
    linkPanel.value = null;
    linkPanelAnchor?.classList.remove('tano-editor-active');
    linkPanelAnchor = null;
    linkPanelSide = undefined;
  }

  function positionLinkPanel() {
    let anchor = linkPanelAnchor;
    const panel = linkPanel.value;
    if (!anchor || !panel || !linkPanelElement.value) return;
    const view = getView();
    if (view && !view.dom.contains(anchor)) {
      anchor =
        [...view.dom.querySelectorAll<HTMLAnchorElement>('a[href]')].find((candidate) => {
          if (panel.kind === 'wiki') {
            return (
              candidate.hasAttribute('data-tano-wiki-target') &&
              view.posAtDOM(candidate, 0) === panel.pos
            );
          }
          const range = linkMarkRange(view, candidate);
          return range?.from === panel.from && range.to === panel.to;
        }) ?? null;
      if (!anchor) return closeLinkPanel();
      linkPanelAnchor?.classList.remove('tano-editor-active');
      linkPanelAnchor = anchor;
      anchor.classList.add('tano-editor-active');
    }
    const position = floatingPanelPosition(anchor, linkPanelElement.value, 0, false, linkPanelSide);
    linkPanelSide = position.side;
    linkPanel.value = { ...panel, x: position.x, y: position.y };
  }

  function openLinkPanel(view: EditorView, link: Element) {
    if (readonly() || revealMarkdown()) return false;
    linkPanelSide = undefined;
    const bounds = link.getBoundingClientRect();
    const wikiTarget = link.getAttribute('data-tano-wiki-target');
    if (wikiTarget !== null) {
      const pos = view.posAtDOM(link, 0);
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== 'tano_wiki_link') return false;
      linkPanel.value = {
        kind: 'wiki',
        pos,
        target: String(node.attrs.target),
        label: node.attrs.explicitLabel ? String(node.attrs.label) : '',
        explicitLabel: !!node.attrs.explicitLabel,
        x: bounds.left,
        y: bounds.bottom + 6,
      };
    } else {
      const range = linkMarkRange(view, link);
      if (!range) return false;
      linkPanel.value = {
        kind: 'link',
        from: range.from,
        to: range.to,
        text: view.state.doc.textBetween(range.from, range.to),
        href: String(range.mark.attrs.href ?? ''),
        title: String(range.mark.attrs.title ?? ''),
        x: bounds.left,
        y: bounds.bottom + 6,
      };
    }
    linkPanelAnchor?.classList.remove('tano-editor-active');
    linkPanelAnchor = link;
    link.classList.add('tano-editor-active');
    announceEditorPanel(view.dom, link);
    void nextTick(() => {
      if (linkPanelAnchor !== link || !linkPanelElement.value) return;
      positionLinkPanel();
      stopLinkPanel?.();
      stopLinkPanel = activateEditorPanel({
        panel: linkPanelElement.value,
        anchor: link,
        position: positionLinkPanel,
        close: closeLinkPanel,
      });
      linkPanelFirstInput.value?.focus();
    });
    return true;
  }

  function editLinkPanel(field: LinkPanelField, event: Event) {
    const panel = linkPanel.value;
    const value = (event.target as HTMLInputElement).value;
    const editor = getEditor();
    if (!panel || !editor || readonly()) return;
    linkPanel.value = { ...panel, [field]: value } as LinkPanel;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (panel.kind === 'wiki') {
        const node = view.state.doc.nodeAt(panel.pos);
        if (node?.type.name !== 'tano_wiki_link') return closeLinkPanel();
        const target = field === 'target' ? value : panel.target;
        const label = field === 'label' ? value : panel.label;
        if (!target.trim() || /[\[\]\r\n|]/.test(target) || /[\[\]\r\n|]/.test(label)) return;
        const explicitLabel = !!label.trim();
        view.dispatch(
          view.state.tr.setNodeMarkup(panel.pos, undefined, {
            target,
            label: explicitLabel ? label : target,
            explicitLabel,
          }),
        );
        return;
      }
      const text = field === 'text' ? value : panel.text;
      const href = field === 'href' ? value : panel.href;
      const title = field === 'title' ? value : panel.title;
      const first = view.state.doc.nodeAt(panel.from);
      if (!first?.isText) return closeLinkPanel();
      const oldMark = first.marks.find((mark) => mark.type.name === 'link');
      if (!oldMark) return closeLinkPanel();
      const nextMark = oldMark.type.create({ href, title: title || null });
      let tr = view.state.tr;
      if (field === 'text') {
        if (!text) return;
        const marks = first.marks.map((mark) => (mark === oldMark ? nextMark : mark));
        tr = tr.replaceWith(panel.from, panel.to, view.state.schema.text(text, marks));
        linkPanel.value = { ...linkPanel.value!, to: panel.from + text.length } as LinkPanel;
      } else {
        tr = tr.removeMark(panel.from, panel.to, oldMark).addMark(panel.from, panel.to, nextMark);
      }
      linkPanelWriting = true;
      try {
        view.dispatch(tr);
      } finally {
        linkPanelWriting = false;
      }
    });
    void nextTick(positionLinkPanel);
  }

  function syncLinkModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) {
    linkModifier.value = event.ctrlKey || event.metaKey;
  }

  function clearLinkModifier() {
    linkModifier.value = false;
  }

  function bindOtherPanelListener(dom: HTMLElement) {
    stopOtherLinkPanel?.();
    stopOtherLinkPanel = onOtherEditorPanel(dom, () => linkPanelAnchor, closeLinkPanel);
  }

  window.addEventListener('keydown', syncLinkModifier, true);
  window.addEventListener('keyup', syncLinkModifier, true);
  window.addEventListener('blur', clearLinkModifier);

  function dispose() {
    closeLinkPanel();
    stopOtherLinkPanel?.();
    stopOtherLinkPanel = undefined;
    window.removeEventListener('keydown', syncLinkModifier, true);
    window.removeEventListener('keyup', syncLinkModifier, true);
    window.removeEventListener('blur', clearLinkModifier);
  }

  return {
    linkModifier,
    linkPanel,
    linkPanelElement,
    linkPanelFirstInput,
    isWriting: () => linkPanelWriting,
    openLinkPanel,
    closeLinkPanel,
    editLinkPanel,
    syncLinkModifier,
    clearLinkModifier,
    bindOtherPanelListener,
    dispose,
  };
}
