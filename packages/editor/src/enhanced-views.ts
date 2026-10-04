import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { watch } from 'vue';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { resourceView } from './resource-views';
import { columnsView } from './columns-view';

let tabsId = 0;

/** Presentation state (expanded toggle / active tab) stays out of Markdown and Yjs. */
export function enhancedViews(
  readonly: () => boolean,
  open: (url: string) => void,
  resolve: (url: string) => string | null,
  revision: () => string | undefined = () => undefined,
): Record<string, NodeViewConstructor> {
  const views: Record<string, NodeViewConstructor> = {};
  views.tano_file = resourceView('file', readonly, open, resolve, revision);
  views.tano_embed = resourceView('embed', readonly, open, resolve, revision);
  views.tano_columns = columnsView(readonly);
  for (const kind of ['toggle', 'panel', 'tabs']) {
    views[`tano_${kind}`] = (node, view, getPos) => {
      let current = node,
        expanded = true,
        active = 0;
      const dom = document.createElement('section');
      dom.className = `tano-enhanced tano-${kind}`;
      dom.dataset.tanoEnhanced = kind;
      dom.dataset.featureLevel = '1';
      const header = document.createElement('div');
      header.className = 'tano-enhanced-header';
      header.contentEditable = 'false';
      const content = document.createElement('div');
      content.className = 'tano-enhanced-content';
      const title = document.createElement('input');
      const panelMenu = document.createElement('details');
      panelMenu.className = 'tano-panel-menu';
      const panelMenuTrigger = document.createElement('summary');
      panelMenuTrigger.textContent = '⋯';
      panelMenuTrigger.setAttribute('aria-label', '标签页操作');
      panelMenuTrigger.title = '标签页操作';
      const panelActions = document.createElement('div');
      panelActions.className = 'tano-panel-actions';
      panelActions.setAttribute('role', 'group');
      panelActions.setAttribute('aria-label', '管理标签页');
      title.setAttribute(
        'aria-label',
        kind === 'toggle' ? '折叠块标题' : kind === 'panel' ? '分区标题' : '附件名称',
      );
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tano-toggle-trigger';
      toggle.setAttribute('aria-label', '展开或收起折叠块');
      const setAttrs = (attrs: Record<string, string>) => {
        const pos = getPos();
        if (pos !== undefined && !readonly())
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }),
          );
      };
      title.oninput = () => setAttrs({ title: title.value.replace(/[\r\n]/g, ' ') });
      toggle.onclick = () => {
        expanded = !expanded;
        const pos = getPos();
        if (!expanded && pos !== undefined && view.state.selection.from > pos && view.state.selection.to < pos + current.nodeSize)
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta('addToHistory', false));
        render();
      };
      if (kind === 'toggle') header.append(toggle);
      if (['toggle', 'panel'].includes(kind)) header.append(title);
      if (kind === 'toggle' || kind === 'panel') {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'tano-add-child';
        add.textContent = kind === 'toggle' ? '+' : '＋ 子块';
        add.setAttribute('aria-label', '添加子块');
        add.title = '添加子块，输入 / 选择类型';
        add.onclick = () => {
          const pos = getPos();
          if (pos === undefined || readonly()) return;
          expanded = true;
          const at = pos + current.nodeSize - 1;
          const last = current.lastChild;
          const reuse = last?.type.name === 'paragraph' && last.content.size === 0;
          const tr = view.state.tr;
          if (!reuse) tr.insert(at, view.state.schema.nodes.paragraph!.create());
          tr.setSelection(TextSelection.create(tr.doc, reuse ? at - last!.nodeSize + 1 : at + 1));
          if (dom.dataset.tabPanel === 'true') panelMenu.open = false;
          view.dispatch(tr.scrollIntoView());
          render();
          view.focus();
        };
        header.append(add);
        title.onkeydown = (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add.click();
        };
      }
      if (kind === 'panel') {
        for (const [action, label] of [
          ['up', '前移分区'],
          ['down', '后移分区'],
          ['remove', '删除分区'],
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = action === 'up' ? '←' : action === 'down' ? '→' : '×';
          button.setAttribute('aria-label', label);
          button.title = label;
          button.onclick = () => {
            const pos = getPos();
            if (pos === undefined || readonly()) return;
            const $pos = view.state.doc.resolve(pos),
              parent = $pos.parent,
              index = $pos.index();
            if (!['tano_tabs', 'tano_columns'].includes(parent.type.name) || parent.childCount <= 1)
              return;
            const tr = view.state.tr;
            if (action === 'remove') tr.delete(pos, pos + current.nodeSize);
            else {
              const target = action === 'up' ? index - 1 : index + 1;
              if (target < 0 || target >= parent.childCount) return;
              const insertion =
                action === 'up'
                  ? pos - parent.child(target).nodeSize
                  : pos + parent.child(target).nodeSize;
              tr.delete(pos, pos + current.nodeSize).insert(insertion, current);
            }
            view.dispatch(tr.scrollIntoView());
          };
          header.append(button);
        }
        panelActions.append(...Array.from(header.children));
        panelMenu.append(panelMenuTrigger, panelActions);
        header.append(panelMenu);
        panelMenu.onkeydown = (event) => {
          if (event.key !== 'Escape' || !panelMenu.open) return;
          event.preventDefault();
          panelMenu.open = false;
          panelMenuTrigger.focus();
        };
      }
      const tabs = document.createElement('div');
      tabs.className = 'tano-tab-list';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '内容标签页');
      if (kind === 'tabs') {
        dom.id = `tano-tabs-${++tabsId}`;
        header.append(tabs);
      }
      if (kind === 'tabs') {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'tano-add-panel';
        add.textContent = '+';
        add.setAttribute('aria-label', '添加标签页');
        add.title = '添加标签页';
        add.onclick = () => {
          const pos = getPos();
          if (pos === undefined || readonly()) return;
          const panel = view.state.schema.nodes.tano_panel!.create(
            { title: `分区 ${current.childCount + 1}` },
            view.state.schema.nodes.paragraph!.create(),
          );
          active = current.childCount;
          view.dispatch(view.state.tr.insert(pos + current.nodeSize - 1, panel));
        };
        header.append(add);
      }
      dom.append(header, content);
      function closePanelMenu(event: Event) {
        if (dom.dataset.tabPanel === 'true' && !panelMenu.contains(event.target as globalThis.Node))
          panelMenu.open = false;
      }
      if (kind === 'panel') document.addEventListener('pointerdown', closePanelMenu);
      function refreshPanel() { render(); }
      if (kind === 'panel') dom.addEventListener('tano-panel-layout', refreshPanel);
      function render() {
        dom.dataset.title = current.attrs.title;
        dom.dataset.url = current.attrs.url;
        title.value = current.attrs.title;
        title.readOnly = readonly();
        header.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
          if (button !== toggle) button.disabled = readonly();
        });
        if (kind === 'panel') {
          const pos = getPos();
          const tabPanel = pos !== undefined && view.state.doc.resolve(pos).parent.type.name === 'tano_tabs';
          const columnPanel = pos !== undefined && view.state.doc.resolve(pos).parent.type.name === 'tano_columns';
          header.hidden = columnPanel;
          if (dom.dataset.tabPanel !== String(tabPanel)) panelMenu.open = !tabPanel;
          dom.dataset.tabPanel = String(tabPanel);
          panelMenu.hidden = tabPanel && readonly();
          if (tabPanel && readonly()) panelMenu.open = false;
          const $pos = pos !== undefined ? view.state.doc.resolve(pos) : null;
          const index = $pos?.index() ?? 0;
          for (const [label, disabled] of [
            ['前移分区', index === 0],
            ['后移分区', index === ($pos?.parent.childCount ?? 1) - 1],
            ['删除分区', ($pos?.parent.childCount ?? 1) <= 1],
          ] as const) {
            header.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.disabled = readonly() || disabled;
          }
        }
        if (kind === 'toggle') {
          toggle.textContent = expanded ? '▾' : '▸';
          toggle.setAttribute('aria-expanded', String(expanded));
          content.hidden = !expanded;
        }
        if (kind === 'tabs') {
          active = Math.min(active, current.childCount - 1);
          tabs.replaceChildren();
          current.forEach((panel, _offset, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.id = `${dom.id}-tab-${index}`;
            button.setAttribute('aria-controls', `${dom.id}-panel-${index}`);
            button.setAttribute('aria-selected', String(index === active));
            button.textContent = panel.attrs.title || `标签页 ${index + 1}`;
            button.onclick = () => {
              active = index;
              render();
              tabs.querySelectorAll<HTMLButtonElement>('button')[active]?.focus();
            };
            button.tabIndex = index === active ? 0 : -1;
            button.onkeydown = (event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              active =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? current.childCount - 1
                    : (active + (event.key === 'ArrowLeft' ? -1 : 1) + current.childCount) %
                      current.childCount;
              render();
              tabs.querySelectorAll<HTMLButtonElement>('button')[active]?.focus();
            };
            tabs.append(button);
          });
          // Hide panels with CSS so ProseMirror still owns every editable child DOM.
          dom.style.setProperty('--tano-active-tab', String(active));
          dom.dataset.activeTab = String(active);
          Array.from(content.children).forEach((child, index) => {
            const panel = child as HTMLElement;
            panel.id = `${dom.id}-panel-${index}`;
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', `${dom.id}-tab-${index}`);
            panel.hidden = index !== active;
            if (index !== active) {
              const menu = panel.querySelector<HTMLDetailsElement>('.tano-panel-menu');
              if (menu) menu.open = false;
            }
          });
        }
        if (kind === 'tabs') {
          queueMicrotask(() => {
            if (dom.isConnected)
              for (const panel of content.children) panel.dispatchEvent(new Event('tano-panel-layout'));
          });
        }
        // Gutter handles live outside the node view and must follow collapsed/hidden children.
        if (dom.isConnected) dom.dispatchEvent(new Event('tano-block-layout', { bubbles: true }));
      }
      function revealSearch(event: Event) {
        const target = event.target as globalThis.Node;
        if (!content.contains(target)) return;
        if (kind === 'toggle') expanded = true;
        else if (kind === 'tabs') {
          const index = Array.from(content.children).findIndex(panel => panel.contains(target));
          if (index >= 0) active = index;
        } else return;
        render();
      }
      dom.addEventListener('tano-reveal-search', revealSearch);
      render();
      const stop = watch(() => [readonly(), revision()], render);
      // Child DOM is mounted by ProseMirror after construction.
      queueMicrotask(() => {
        if (dom.isConnected) render();
      });
      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type !== current.type) return false;
          if (kind === 'tabs' && active < current.childCount) {
            const selected = current.child(active);
            next.forEach((panel, _offset, index) => {
              if (panel === selected) active = index;
            });
          }
          current = next;
          render();
          queueMicrotask(() => {
            if (dom.isConnected) render();
          });
          return true;
        },
        stopEvent: (event) => header.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== 'selection' &&
          (header.contains(mutation.target) ||
            mutation.target === dom ||
            (mutation.type === 'attributes' && mutation.attributeName === 'hidden')),
        destroy() {
          stop();
          if (kind === 'panel') document.removeEventListener('pointerdown', closePanelMenu);
          dom.removeEventListener('tano-panel-layout', refreshPanel);
          dom.removeEventListener('tano-reveal-search', revealSearch);
          panelMenu.onkeydown = null;
          title.oninput = toggle.onclick = title.onkeydown = null;
        },
      };
    };
  }
  return views;
}
