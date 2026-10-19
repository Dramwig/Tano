import { h, render } from 'vue';
import type { Component } from 'vue';
import { Decoration } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { customCalloutIcon, customCalloutMarker } from './callout';

/** The host supplies its icon catalog; Markdown and transactions stay in the editor. */
export function customCalloutWidget(pos: number, marker: string, readonly: boolean, component?: Component,
  stopHistoryCapture?: () => void) {
  return Decoration.widget(pos + 1, (view, getPos) => {
    const title = document.createElement('div');
    title.className = 'tano-callout-title tano-custom-callout-icon';
    title.contentEditable = 'false';
    const icon = customCalloutIcon(marker);
    if (!component) {
      title.textContent = icon.startsWith('icon:') ? '💡' : icon;
      return title;
    }
    render(h(component, {
      icon, readonly,
      onSelect(value: string) {
        const next = customCalloutMarker(value);
        const currentPos = getPos();
        if (readonly || !view.editable || !next || currentPos === undefined) return;
        const paragraph = view.state.doc.nodeAt(currentPos);
        // The widget may have been removed/replaced while its picker was open.
        if (paragraph?.type.name !== 'paragraph' || paragraph.textContent !== marker || next === marker) return;
        stopHistoryCapture?.();
        view.dispatch(closeHistory(view.state.tr).insertText(next, currentPos + 1, currentPos + 1 + marker.length));
        view.dispatch(closeHistory(view.state.tr));
        stopHistoryCapture?.();
        view.focus();
      },
    }), title);
    return title;
  }, {
    key: `custom-callout:${marker}:${readonly}`,
    side: -1,
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: node => { render(null, node as HTMLElement); },
  });
}
