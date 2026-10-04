import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { watch } from 'vue';
import { columnWidths, formatColumnWidths, resizeColumnWidths } from './column-widths';

/** Editable column slots stay in contentDOM; resize controls never enter the document. */
export function columnsView(readonly: () => boolean): NodeViewConstructor {
  return (node, view, getPos) => {
    let current = node;
    let destroyed = false;
    let drag: { pointer: number; index: number; x: number; available: number; widths: number[]; preview: number[]; handle: HTMLElement } | undefined;
    const dom = document.createElement('section');
    dom.className = 'tano-enhanced tano-columns';
    dom.dataset.tanoEnhanced = 'columns';
    dom.dataset.featureLevel = '1';
    const content = document.createElement('div');
    content.className = 'tano-enhanced-content';
    const controls = document.createElement('div');
    controls.className = 'tano-column-controls';
    controls.contentEditable = 'false';
    const separators = document.createElement('div');
    separators.className = 'tano-column-separators';
    controls.append(separators);
    dom.append(content, controls);

    function layout() {
      if (destroyed) return;
      const panels = Array.from(content.children) as HTMLElement[];
      const bounds = panels.map(panel => panel.getBoundingClientRect());
      const stacked = bounds.some((rect, index) => index > 0 && rect.left <= bounds[index - 1]!.left);
      separators.hidden = readonly() || stacked || panels.length !== current.childCount;
      const root = dom.getBoundingClientRect();
      const widths = drag?.preview ?? columnWidths(current.attrs.widths, current.childCount);
      Array.from(separators.children).forEach((element, index) => {
        const handle = element as HTMLElement;
        const left = bounds[index], right = bounds[index + 1];
        if (left && right) handle.style.left = `${(left.right + right.left) / 2 - root.left}px`;
        const total = widths[index]! + widths[index + 1]!;
        const value = Math.round(widths[index]! / total * 100);
        handle.setAttribute('aria-valuenow', String(value));
        handle.setAttribute('aria-valuetext', `左栏 ${value}%，右栏 ${100 - value}%`);
      });
      if (dom.isConnected) dom.dispatchEvent(new Event('tano-block-layout', { bubbles: true }));
    }

    function preview(widths: readonly number[]) {
      content.style.setProperty('--tano-column-tracks', widths.map(width => `minmax(0, ${width}fr)`).join(' '));
      layout();
    }

    function cancel() {
      const active = drag;
      drag = undefined;
      dom.classList.remove('is-resizing');
      if (active?.handle.hasPointerCapture?.(active.pointer)) active.handle.releasePointerCapture(active.pointer);
      preview(columnWidths(current.attrs.widths, current.childCount));
    }

    function commit(widths: readonly number[]) {
      const pos = getPos();
      if (readonly() || pos === undefined) return;
      const value = formatColumnWidths(widths);
      if (value === formatColumnWidths(columnWidths(current.attrs.widths, current.childCount))) return;
      view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, widths: value })));
      view.dispatch(closeHistory(view.state.tr));
    }

    function start(event: PointerEvent, index: number, handle: HTMLElement) {
      if (readonly() || event.button !== 0 || drag) return;
      const available = Array.from(content.children).reduce((sum, panel) => sum + panel.getBoundingClientRect().width, 0);
      if (!available || separators.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      const widths = columnWidths(current.attrs.widths, current.childCount);
      drag = { pointer: event.pointerId, index, x: event.clientX, available, widths, preview: widths, handle };
      dom.classList.add('is-resizing');
      handle.focus({ preventScroll: true });
      handle.setPointerCapture?.(event.pointerId);
    }

    function move(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointer) return;
      event.preventDefault();
      drag.preview = resizeColumnWidths(drag.widths, drag.index, (event.clientX - drag.x) / drag.available * 100, 96 / drag.available * 100);
      preview(drag.preview);
    }

    function finish(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointer) return;
      move(event);
      const widths = drag.preview;
      cancel();
      commit(widths);
    }

    function abort(event: PointerEvent) {
      if (drag?.pointer === event.pointerId) cancel();
    }

    function escape(event: KeyboardEvent) {
      if (!drag || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }

    function render() {
      if (destroyed) return;
      dom.dataset.widths = current.attrs.widths;
      controls.hidden = readonly();
      if (separators.childElementCount !== current.childCount - 1) {
        separators.replaceChildren();
        for (let index = 0; index < current.childCount - 1; index++) {
          const handle = document.createElement('div');
          handle.className = 'tano-column-resizer';
          handle.tabIndex = 0;
          handle.setAttribute('role', 'separator');
          handle.setAttribute('aria-orientation', 'vertical');
          handle.setAttribute('aria-label', `调整第 ${index + 1}、${index + 2} 栏宽度`);
          handle.setAttribute('aria-valuemin', '0');
          handle.setAttribute('aria-valuemax', '100');
          handle.title = '拖动调整栏宽；方向键微调，双击等宽';
          handle.onpointerdown = event => start(event, index, handle);
          handle.onlostpointercapture = abort;
          handle.onkeydown = event => {
            if (readonly() || drag || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const available = Array.from(content.children).reduce((sum, panel) => sum + panel.getBoundingClientRect().width, 0);
            const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 1);
            commit(resizeColumnWidths(columnWidths(current.attrs.widths, current.childCount), index, delta, available ? 96 / available * 100 : 5));
          };
          handle.ondblclick = () => {
            const widths = columnWidths(current.attrs.widths, current.childCount);
            commit(resizeColumnWidths(widths, index, (widths[index + 1]! - widths[index]!) / 2, 0));
          };
          separators.append(handle);
        }
      }
      preview(columnWidths(current.attrs.widths, current.childCount));
      queueMicrotask(layout);
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', abort);
    document.addEventListener('keydown', escape, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(layout);
    observer?.observe(content);
    const stop = watch(readonly, () => { cancel(); render(); });
    render();
    return {
      dom, contentDOM: content,
      update(next) {
        if (next.type !== current.type) return false;
        if (drag && next !== current) cancel();
        current = next;
        render();
        return true;
      },
      stopEvent: event => controls.contains(event.target as globalThis.Node),
      ignoreMutation: mutation => mutation.type !== 'selection' &&
        (controls.contains(mutation.target) || mutation.target === dom ||
          (mutation.target === content && mutation.type === 'attributes' && mutation.attributeName === 'style')),
      destroy() {
        destroyed = true;
        cancel();
        stop();
        observer?.disconnect();
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', abort);
        document.removeEventListener('keydown', escape, true);
      },
    };
  };
}
