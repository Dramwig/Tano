import { h, render } from 'vue';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Eraser, GripHorizontal, GripVertical, PaintRoller, Trash2 } from 'lucide-vue-next';
import type { Component } from 'vue';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { TableMap } from '@milkdown/kit/prose/tables';
import { tableColors } from '@tano/protocol';
import type { TableColor } from '@tano/protocol';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, onOtherEditorPanel } from './editor-panel';
import { floatingPanelPosition, observePanelPosition } from './panel-position';
import { moveTableLine, tableLineAction, tableLineSelection } from './table-commands';
import type { TableAction, TableAxis, TableTarget } from './table-commands';
import { createTableDragPreview } from './table-drag-preview';

function icon(component: Component) {
  const element = document.createElement('span');
  render(h(component, { size: 16, 'aria-hidden': true }), element);
  return element;
}

export function tableControls(readonly: () => boolean) {
  return new Plugin({
    key: new PluginKey('tanoTableControls'),
    view(view) {
      const host = view.dom.parentElement!;
      const surface = host.closest('.editor-scroll') ?? host;
      const controls = document.createElement('div');
      controls.className = 'tano-table-controls';
      const grips = {} as Record<TableAxis, HTMLButtonElement>;
      for (const axis of ['row', 'column'] as const) {
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = `tano-table-grip is-${axis}`;
        grip.title = axis === 'row' ? '选择或拖动行' : '选择或拖动列';
        grip.setAttribute('aria-label', grip.title);
        grip.setAttribute('aria-haspopup', 'menu');
        grip.hidden = true;
        grip.append(icon(axis === 'row' ? GripVertical : GripHorizontal));
        controls.append(grip);
        grips[axis] = grip;
      }
      const outline = document.createElement('div');
      outline.className = 'tano-table-line-outline';
      outline.hidden = true;
      const marker = document.createElement('div');
      marker.className = 'tano-table-line-drop';
      marker.hidden = true;
      const menu = createEditorPanel('div', 'tano-table-menu', '表格操作');
      menu.setAttribute('role', 'menu');
      const items = document.createElement('div');
      const palette = createEditorPanel('div', 'tano-table-color-menu', '表格颜色');
      palette.setAttribute('role', 'menu');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'tano-table-menu-item tano-table-color-back';
      back.append(icon(ChevronLeft), document.createTextNode('返回'));
      palette.append(back);
      const colorGroups = document.createElement('div');
      palette.append(colorGroups);
      menu.append(items, palette);
      controls.append(outline, marker, menu);
      host.append(controls);
      let hovered: { pos: number; row: number; column: number } | null = null;
      let selected: TableTarget | null = null;
      let stopPanel: (() => void) | undefined;
      let pending: { id: number; x: number; y: number; doc: ProseNode; target: TableTarget; dragging: boolean; to: number | null } | null = null;
      let colorButton: HTMLButtonElement | null = null;
      let colorCloseTimer: number | undefined;
      let dragPreview: ReturnType<typeof createTableDragPreview> = null;

      const keepColors = () => {
        window.clearTimeout(colorCloseTimer);
        colorCloseTimer = undefined;
      };
      palette.addEventListener('pointerenter', keepColors);

      const closeColors = () => {
        keepColors();
        palette.hidden = true;
        items.style.visibility = '';
        items.removeAttribute('aria-hidden');
        colorButton?.setAttribute('aria-expanded', 'false');
      };
      back.addEventListener('click', () => { closeColors(); colorButton?.focus({ preventScroll: true }); });

      const close = () => {
        stopPanel?.(); stopPanel = undefined;
        menu.hidden = true;
        selected = null;
        outline.hidden = true;
        closeColors();
        for (const grip of Object.values(grips)) {
          grip.classList.remove('is-selected');
          grip.setAttribute('aria-expanded', 'false');
        }
      };
      const cancelDrag = () => {
        dragPreview?.destroy();
        dragPreview = null;
        pending = null;
        marker.hidden = true;
        controls.classList.remove('is-dragging');
      };
      const hide = () => {
        close(); cancelDrag(); hovered = null;
        grips.row.hidden = grips.column.hidden = true;
      };
      const cellDOM = (pos: number, row: number, column: number): HTMLElement | null => {
        const table = view.state.doc.nodeAt(pos);
        if (table?.type.name !== 'table') return null;
        const map = TableMap.get(table);
        const offset = map.map[row * map.width + column];
        if (offset === undefined) return null;
        const dom = view.nodeDOM(pos + 1 + offset);
        return dom instanceof HTMLElement ? dom : null;
      };
      const geometry = () => {
        if (!hovered) return null;
        const cell = cellDOM(hovered.pos, hovered.row, hovered.column);
        const table = cell?.closest('table');
        const wrapper = table?.closest('.tableWrapper') ?? table;
        if (!cell || !table || !wrapper) return null;
        const bounds = table.getBoundingClientRect();
        const clip = wrapper.getBoundingClientRect();
        const viewport = surface.getBoundingClientRect();
        const left = Math.max(bounds.left, clip.left, viewport.left, 0);
        const right = Math.min(bounds.right, clip.right, viewport.right, window.innerWidth);
        const top = Math.max(bounds.top, viewport.top, 0);
        const bottom = Math.min(bounds.bottom, viewport.bottom, window.innerHeight);
        return { cell: cell.getBoundingClientRect(), bounds, left, right, top, bottom, viewportLeft: Math.max(viewport.left, 0) };
      };
      const positionMenu = () => {
        if (menu.hidden || !selected) return;
        const position = floatingPanelPosition(grips[selected.axis], menu, 0, false);
        menu.style.left = `${position.x}px`;
        menu.style.top = `${position.y}px`;
        if (!palette.hidden && colorButton) {
          palette.style.setProperty('--tano-panel-available-width', `${Math.max(1, window.innerWidth - 16)}px`);
          palette.style.setProperty('--tano-panel-available-height', `${Math.max(1, window.innerHeight - 16)}px`);
          const parent = menu.getBoundingClientRect();
          const anchor = colorButton.getBoundingClientRect();
          const width = palette.getBoundingClientRect().width;
          const right = parent.right + 4;
          const left = parent.left - width - 4;
          const overlay = right + width > window.innerWidth - 8 && left < 8;
          back.hidden = !overlay;
          items.style.visibility = overlay ? 'hidden' : '';
          if (overlay) items.setAttribute('aria-hidden', 'true');
          else items.removeAttribute('aria-hidden');
          const x = overlay ? Math.max(8, Math.min(parent.left, window.innerWidth - width - 8))
            : right + width <= window.innerWidth - 8 ? right : left;
          const height = palette.getBoundingClientRect().height;
          palette.style.left = `${x}px`;
          palette.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8))}px`;
        }
      };
      const position = () => {
        if (readonly()) { hide(); return; }
        const g = geometry();
        if (!g || g.left >= g.right || g.top >= g.bottom) { hide(); return; }
        const x = (Math.max(g.left, g.cell.left) + Math.min(g.right, g.cell.right)) / 2;
        const y = (g.cell.top + g.cell.bottom) / 2;
        grips.column.hidden = g.cell.right <= g.left || g.cell.left >= g.right || g.bounds.top < g.top;
        grips.row.hidden = y < g.top || y > g.bottom;
        if (selected && grips[selected.axis].hidden) close();
        grips.column.style.left = `${x - 14}px`;
        grips.column.style.top = `${g.bounds.top - 14}px`;
        grips.row.style.left = `${Math.max(g.left - 14, g.viewportLeft)}px`;
        grips.row.style.top = `${y - 14}px`;
        if (selected) {
          const dom = cellDOM(selected.pos, selected.axis === 'row' ? selected.index : 0, selected.axis === 'column' ? selected.index : 0);
          const rect = dom?.getBoundingClientRect();
          if (rect) {
            const left = selected.axis === 'row' ? g.left : Math.max(g.left, rect.left);
            const right = selected.axis === 'row' ? g.right : Math.min(g.right, rect.right);
            const top = selected.axis === 'row' ? Math.max(g.top, rect.top) : g.top;
            const bottom = selected.axis === 'row' ? Math.min(g.bottom, rect.bottom) : g.bottom;
            outline.hidden = !!pending?.dragging || left >= right || top >= bottom;
            Object.assign(outline.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
          }
        }
        positionMenu();
      };
      const select = (target: TableTarget) => {
        const selection = tableLineSelection(view.state.doc, target);
        if (!selection) return false;
        view.dispatch(view.state.tr.setSelection(selection).setMeta('tanoBlockContextSelect', true).setMeta('addToHistory', false));
        selected = target;
        grips[target.axis].classList.add('is-selected');
        position();
        return true;
      };
      const run = (action: TableAction, color: TableColor | null = null) => {
        if (!selected || readonly()) return;
        const tr = tableLineAction(view.state, selected, action, color);
        close();
        if (tr) view.dispatch(tr);
        view.focus();
      };
      const openColors = (focus = false) => {
        keepColors();
        if (menu.hidden || !selected || readonly()) return;
        // An overlapping submenu must open on click so it cannot intercept that click.
        if (!focus && palette.hidden) {
          const parent = menu.getBoundingClientRect();
          const width = Number.parseFloat(window.getComputedStyle(palette).width) || 220;
          if (parent.right + width + 4 > window.innerWidth - 8 && parent.left - width - 4 < 8) return;
        }
        if (palette.hidden) {
          for (const child of colorGroups.querySelectorAll('span')) render(null, child);
          colorGroups.replaceChildren();
          const labels: Record<TableColor, string> = { gray: '灰色', brown: '棕色', orange: '橙色', yellow: '黄色', green: '绿色', blue: '蓝色', purple: '紫色', pink: '粉色', red: '红色' };
          for (const group of ['text', 'background'] as const) {
            const section = document.createElement('div');
            section.className = 'tano-table-color-group';
            section.setAttribute('role', 'group');
            section.setAttribute('aria-label', group === 'text' ? '文字颜色' : '背景颜色');
            const title = document.createElement('div');
            title.className = 'tano-table-color-title';
            title.textContent = group === 'text' ? '文字颜色' : '背景颜色';
            section.append(title);
            const current = new Set<TableColor | null>();
            tableLineSelection(view.state.doc, selected)?.forEachCell(cell => current.add(cell.attrs[group === 'text' ? 'foreground' : 'background'] ?? null));
            for (const color of [null, ...tableColors]) {
              const option = document.createElement('button');
              option.type = 'button';
              option.className = 'tano-table-menu-item tano-table-color-option';
              option.setAttribute('role', 'menuitemradio');
              const checked = current.size === 1 && current.has(color);
              option.setAttribute('aria-checked', String(checked));
              const swatch = document.createElement('span');
              swatch.className = 'tano-table-color-swatch';
              swatch.setAttribute('aria-hidden', 'true');
              if (group === 'text') {
                swatch.dataset.tanoTableTextColor = color ?? 'none';
                swatch.textContent = 'A';
              } else swatch.dataset.tanoTableColor = color ?? 'none';
              const label = `${color === null ? '默认' : labels[color]}${group === 'text' ? '文字' : '背景'}`;
              option.append(swatch, document.createTextNode(label));
              if (checked) {
                const check = icon(Check);
                check.className = 'tano-table-menu-trailing';
                option.append(check);
              }
              option.addEventListener('click', () => run(group === 'text' ? 'textColor' : 'color', color));
              section.append(option);
            }
            colorGroups.append(section);
          }
          palette.hidden = false;
          colorButton?.setAttribute('aria-expanded', 'true');
        }
        positionMenu();
        if (focus) {
          const firstGroup = colorGroups.firstElementChild;
          (firstGroup?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? firstGroup?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
        }
      };
      const renderItems = () => {
        for (const child of items.querySelectorAll('span')) render(null, child);
        items.replaceChildren();
        if (!selected) return;
        const column = selected.axis === 'column';
        const actions: { label: string; action: TableAction; icon: Component }[] = [
          { label: '颜色', action: 'color', icon: PaintRoller },
          { label: column ? '向左插入列' : '向上插入行', action: 'before', icon: column ? ArrowLeft : ArrowUp },
          { label: column ? '向右插入列' : '向下插入行', action: 'after', icon: column ? ArrowRight : ArrowDown },
          { label: column ? '复制列' : '复制行', action: 'duplicate', icon: Copy },
          { label: '清空内容', action: 'clear', icon: Eraser },
          { label: column ? '删除列' : '删除行', action: 'delete', icon: Trash2 },
        ];
        for (const action of actions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitem');
          button.className = 'tano-table-menu-item';
          if (action.action === 'delete') button.classList.add('is-danger');
          button.append(icon(action.icon), document.createTextNode(action.label));
          if (action.action === 'color') {
            colorButton = button;
            button.setAttribute('aria-haspopup', 'menu');
            button.setAttribute('aria-expanded', 'false');
            const arrow = icon(ChevronRight);
            arrow.className = 'tano-table-menu-trailing';
            button.append(arrow);
            button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') openColors(); });
          } else button.addEventListener('pointerenter', () => {
            keepColors();
            colorCloseTimer = window.setTimeout(closeColors, 150);
          });
          button.addEventListener('click', () => {
            if (action.action === 'color') openColors(true);
            else run(action.action);
          });
          items.append(button);
        }
      };
      const open = (target: TableTarget) => {
        close();
        if (!select(target)) return;
        const grip = grips[target.axis];
        renderItems();
        menu.hidden = false;
        grip.setAttribute('aria-expanded', 'true');
        announceEditorPanel(host, grip);
        stopPanel = activateEditorPanel({ panel: menu, anchor: grip, position: positionMenu, close });
        items.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      };
      for (const axis of ['row', 'column'] as const) {
        const grip = grips[axis];
        const target = (): TableTarget | null => hovered ? { pos: hovered.pos, axis, index: hovered[axis] } : null;
        grip.addEventListener('pointerdown', event => {
          if (event.button !== 0 || readonly()) return;
          const current = target();
          if (!current) return;
          event.preventDefault(); event.stopPropagation();
          close();
          if (!select(current)) return;
          pending = { id: event.pointerId, x: event.clientX, y: event.clientY, target: current, doc: view.state.doc, dragging: false, to: null };
        });
        grip.addEventListener('click', event => {
          event.preventDefault();
          if (event.detail === 0 && !readonly()) { const current = target(); if (current) open(current); }
        });
      }
      const onMove = (event: PointerEvent) => {
        if (readonly()) { hide(); return; }
        if (pending) {
          if (event.pointerId !== pending.id) return;
          if (pending.doc !== view.state.doc) { hide(); return; }
          if (!pending.dragging && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 5) return;
          if (!pending.dragging) {
            const visible = geometry();
            if (!visible) { hide(); return; }
            dragPreview = createTableDragPreview(view, pending.target, grips[pending.target.axis], pending, visible);
            pending.dragging = true;
            controls.classList.add('is-dragging');
            outline.hidden = true;
          }
          dragPreview?.move(event.clientX, event.clientY);
          const table = view.state.doc.nodeAt(pending.target.pos)!;
          const map = TableMap.get(table);
          const axis = pending.target.axis;
          let nearest = Infinity;
          let to = 0;
          for (let i = 0; i < (axis === 'row' ? map.height : map.width); i++) {
            const dom = cellDOM(pending.target.pos, axis === 'row' ? i : hovered!.row, axis === 'column' ? i : 0);
            if (!dom) continue;
            const rect = dom.getBoundingClientRect();
            const distance = Math.abs(axis === 'row' ? event.clientY - (rect.top + rect.bottom) / 2 : event.clientX - (rect.left + rect.right) / 2);
            if (distance < nearest) { nearest = distance; to = i; }
          }
          const g = geometry();
          const overTable = g && event.clientX >= g.left - 28 && event.clientX <= g.right + 28 && event.clientY >= g.top - 28 && event.clientY <= g.bottom + 28;
          pending.to = overTable ? to : null;
          const dom = cellDOM(pending.target.pos, axis === 'row' ? to : hovered!.row, axis === 'column' ? to : 0);
          const rect = dom?.getBoundingClientRect();
          marker.hidden = !overTable || to === pending.target.index || !rect;
          if (g && rect) Object.assign(marker.style, axis === 'row' ? {
            left: `${g.left}px`, top: `${to > pending.target.index ? rect.bottom : rect.top}px`, width: `${g.right - g.left}px`, height: '2px',
          } : {
            left: `${to > pending.target.index ? rect.right : rect.left}px`, top: `${g.top}px`, width: '2px', height: `${g.bottom - g.top}px`,
          });
          return;
        }
        if (!menu.hidden) return;
        if (!(event.target instanceof Element) || controls.contains(event.target)) return;
        const cell = event.target.closest('td, th');
        if (cell && view.dom.contains(cell)) {
          const resolved = view.state.doc.resolve(view.posAtDOM(cell, 0));
          for (let depth = resolved.depth; depth > 0; depth--) {
            if (resolved.node(depth).type.name !== 'table') continue;
            const pos = resolved.before(depth);
            const map = TableMap.get(resolved.node(depth));
            const rect = map.findCell(resolved.before(depth + 2) - pos - 1);
            hovered = { pos, row: rect.top, column: rect.left };
            position();
            return;
          }
        }
        const g = geometry();
        if (!g || event.clientX < g.left - 24 || event.clientX > g.right + 12 || event.clientY < g.top - 24 || event.clientY > g.bottom + 12) hide();
      };
      const onUp = (event: PointerEvent) => {
        if (!pending || event.pointerId !== pending.id) return;
        const gesture = pending;
        cancelDrag();
        if (readonly() || gesture.doc !== view.state.doc) { hide(); return; }
        if (!gesture.dragging) { open(gesture.target); return; }
        const tr = gesture.to !== null ? moveTableLine(view.state, gesture.target, gesture.to) : null;
        close();
        if (tr) view.dispatch(tr);
        view.focus();
      };
      const onCancel = () => { if (pending) hide(); };
      const onDragKeyDown = (event: KeyboardEvent) => {
        if (pending && event.key === 'Escape') {
          hide(); view.focus();
          event.preventDefault(); event.stopPropagation();
        }
      };
      const onLeave = () => { if (!pending && menu.hidden) hide(); };
      controls.addEventListener('keydown', event => {
        if (!palette.hidden && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
          closeColors(); colorButton?.focus({ preventScroll: true });
          event.preventDefault(); event.stopPropagation();
        } else if (event.key === 'Escape') {
          const grip = selected && grips[selected.axis];
          close(); cancelDrag(); position();
          if (!grip) view.focus();
          grip?.focus({ preventScroll: true });
          event.preventDefault(); event.stopPropagation();
        } else if (!menu.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          const buttons = [...(palette.hidden ? items : palette).querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = index < 0 ? (step === 1 ? 0 : buttons.length - 1) : (index + step + buttons.length) % buttons.length;
          buttons[next]?.focus();
          event.preventDefault();
        } else if (!menu.hidden && event.key === 'ArrowRight' && document.activeElement === colorButton) {
          openColors(true);
          event.preventDefault();
        }
      });
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onDragKeyDown, true);
      window.addEventListener('blur', onCancel);
      surface.addEventListener('pointerleave', onLeave);
      const stopPosition = observePanelPosition(() => { if (hovered) position(); });
      const stopOther = onOtherEditorPanel(host, () => selected ? grips[selected.axis] : null, close);
      return {
        update(next, previous) {
          view = next;
          if (readonly() || !previous.doc.eq(next.state.doc)) hide();
          else if (hovered) position();
        },
        destroy() {
          hide(); stopPosition(); stopOther();
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
          document.removeEventListener('keydown', onDragKeyDown, true);
          window.removeEventListener('blur', onCancel);
          surface.removeEventListener('pointerleave', onLeave);
          for (const element of controls.querySelectorAll('span')) render(null, element);
          controls.remove();
        },
      };
    },
  });
}
