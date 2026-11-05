import { setSurfaceVisible } from './surface-motion';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import {
  referenceCandidates,
  referenceTypeLabel,
  referenceUrl,
  isAgentPerson,
} from '@tano/protocol';
import { h, render as renderIcon, type Component } from 'vue';
import { animate } from 'motion/mini';
import { Bot, Box, CalendarDays, FileText, Paperclip, UserRound } from 'lucide-vue-next';
import type { ReferenceTarget } from '@tano/protocol';
import { selectedBlocks } from './document-model';

const pickerCategories = [
  { key: 'all', label: '全部' },
  { key: 'person', label: '人物' },
  { key: 'document', label: '文档' },
  { key: 'asset', label: '附件' },
  { key: 'event', label: '事件' },
  { key: 'other', label: '其他' },
];
const pickerIcons: Record<string, Component> = {
  person: UserRound,
  document: FileText,
  asset: Paperclip,
  event: CalendarDays,
};
function targetCategory(target: ReferenceTarget) {
  return Object.hasOwn(pickerIcons, target.type) ? target.type : 'other';
}

interface PickerSession {
  from: number;
  to: number;
  query: string;
  block: boolean;
  typed: boolean;
  trigger: '@' | '[[';
}
export const referencePickerKey = new PluginKey<PickerSession | null>('tano-reference-picker');
export function openReferencePicker(state: EditorState, block = false, query = '') {
  return state.tr.setMeta(referencePickerKey, {
    from: state.selection.from,
    to: state.selection.to,
    query,
    block,
    typed: false,
    trigger: '@',
  });
}
export function applyReference(state: EditorState, target: ReferenceTarget): Transaction | null {
  const session = referencePickerKey.getState(state);
  if (!session) return null;
  const tr = closeHistory(state.tr);
  const attrs = {
    url: referenceUrl(target),
    label: target.name,
    mentionId: target.type === 'person' && !session.block ? crypto.randomUUID() : '',
  };
  if (!session.block) {
    tr.replaceWith(session.from, session.to, state.schema.nodes.tano_reference!.create(attrs));
    tr.setSelection(TextSelection.near(tr.doc.resolve(session.from + 1)));
  } else {
    if (session.typed) tr.delete(session.from, session.to);
    const clean = state.apply(tr);
    const blocks = selectedBlocks(clean),
      last = blocks.at(-1);
    if (!last) return null;
    const empty =
      blocks.length === 1 && last.node.type.name === 'paragraph' && !last.node.content.size;
    const from = empty ? last.pos : last.pos + last.node.nodeSize;
    tr.replaceWith(
      from,
      empty ? from + last.node.nodeSize : from,
      state.schema.nodes.tano_reference_block!.create(attrs),
    );
    tr.setSelection(NodeSelection.create(tr.doc, from));
  }
  return tr.setMeta(referencePickerKey, 'close').scrollIntoView();
}

export function referencePicker(options: {
  enabled: () => boolean;
  targets: () => readonly ReferenceTarget[];
}) {
  let handleKey = (_event: KeyboardEvent) => false;
  return new Plugin<PickerSession | null>({
    key: referencePickerKey,
    state: {
      init: () => null,
      apply(tr, current, _previous, next) {
        const action = tr.getMeta(referencePickerKey);
        if (!options.enabled() || action === 'close') return null;
        if (action) return action;
        if (!current) return null;
        if (tr.selectionSet && !tr.docChanged && !next.selection.eq(_previous.selection))
          return null;
        if (!tr.docChanged) return current;
        const from = tr.mapping.mapResult(current.from, -1),
          to = tr.mapping.mapResult(current.to, 1);
        if (from.deletedAcross || to.deletedAcross) return null;
        if (!current.typed) return { ...current, from: from.pos, to: to.pos };
        if (
          !(next.selection instanceof TextSelection) ||
          !next.selection.empty ||
          next.selection.from !== to.pos
        )
          return null;
        const text = next.doc.textBetween(from.pos, to.pos, '\n', '\ufffc');
        if (
          !text.startsWith(current.trigger) ||
          /[\n\ufffc\]]/.test(text.slice(current.trigger.length)) ||
          text.length > 202
        )
          return null;
        return {
          ...current,
          from: from.pos,
          to: to.pos,
          query: text.slice(current.trigger.length),
        };
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (
          !options.enabled() ||
          !view.editable ||
          from !== to ||
          !['paragraph', 'heading'].includes(view.state.selection.$from.parent.type.name)
        )
          return false;
        if (
          (view.state.storedMarks ?? view.state.selection.$from.marks()).some(
            (mark) => mark.type.spec.code || mark.type.name === 'link',
          )
        )
          return false;
        const prefix = view.state.selection.$from.parent.textBetween(
          0,
          view.state.selection.$from.parentOffset,
          '',
          '\ufffc',
        );
        const at = text === '@' && (!prefix || /[\s(（]$/.test(prefix));
        const wiki = text === '[' && prefix.endsWith('[') && !prefix.endsWith('![');
        if (!at && !wiki) return false;
        const start = wiki ? from - 1 : from;
        view.dispatch(
          view.state.tr.insertText(text, from, to).setMeta(referencePickerKey, {
            from: start,
            to: from + text.length,
            query: '',
            block: false,
            typed: true,
            trigger: wiki ? '[[' : '@',
          }),
        );
        return true;
      },
      handleKeyDown: (_view, event) => handleKey(event),
    },
    view(view) {
      const menu = document.createElement('div');
      menu.className = 'tano-reference-picker';
      menu.hidden = true;
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', '选择引用对象或文档');
      const search = document.createElement('input');
      search.setAttribute('aria-label', '搜索引用目标');
      search.placeholder = '搜索名称或路径…';
      const filters = document.createElement('div');
      filters.className = 'tano-reference-picker-filters';
      filters.setAttribute('role', 'group');
      filters.setAttribute('aria-label', '引用类型');
      const list = document.createElement('div');
      list.className = 'tano-reference-picker-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', '引用候选');
      menu.append(search, list, filters);
      view.dom.parentElement!.append(menu);
      let matches: ReferenceTarget[] = [],
        active = -1,
        query = '',
        manual = false;
      let category = 'all';
      let sizeMotion: ReturnType<typeof animate> | undefined;
      function clearSizeMotion() {
        sizeMotion?.stop();
        sizeMotion = undefined;
        menu.style.height = '';
      }
      const iconHosts: HTMLElement[] = [];
      for (const item of pickerCategories) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.dataset.category = item.key;
        button.onmousedown = (event) => event.preventDefault();
        button.onclick = () => {
          if (category === item.key) return;
          category = item.key;
          active = -1;
          render(true);
          list.scrollTop = 0;
        };
        button.onkeydown = (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') handleKey(event);
        };
        filters.append(button);
      }
      const close = () => {
        if (referencePickerKey.getState(view.state))
          view.dispatch(view.state.tr.setMeta(referencePickerKey, 'close'));
      };
      const choose = (target: ReferenceTarget) => {
        if (!options.enabled()) return close();
        const fresh = options
          .targets()
          .filter((item) => referenceUrl(item) === referenceUrl(target) && !item.archived);
        if (fresh.length !== 1) {
          render();
          return;
        }
        const tr = applyReference(view.state, fresh[0]!);
        if (tr) view.dispatch(tr);
        view.focus();
      };
      function render(animateSize = false) {
        const from = !menu.hidden && (animateSize || sizeMotion)
          ? menu.getBoundingClientRect() : undefined;
        clearSizeMotion();
        const session = referencePickerKey.getState(view.state);
        setSurfaceVisible(menu, !!session && options.enabled());
        if (menu.hidden || !session) return;
        if (query !== session.query || manual !== !session.typed) active = -1;
        query = session.query;
        manual = !session.typed;
        search.hidden = session.typed;
        if (search.value !== query) search.value = query;
        const candidates = referenceCandidates(options.targets(), query);
        for (const button of filters.querySelectorAll('button')) {
          button.setAttribute('aria-pressed', String(button.dataset.category === category));
        }
        const groups = pickerCategories
          .slice(1)
          .filter((item) => category === 'all' || category === item.key)
          .map((item) => ({
            ...item,
            targets: candidates.filter((target) => targetCategory(target) === item.key),
          }))
          .filter((item) => item.targets.length);
        matches = groups.flatMap((group) => group.targets.slice(0, 30));
        active = Math.min(active, matches.length - 1);
        for (const host of iconHosts) renderIcon(null, host);
        iconHosts.length = 0;
        list.replaceChildren();
        if (!matches.length) {
          const empty = document.createElement('p');
          empty.className = 'tano-reference-picker-empty';
          empty.textContent = query
            ? '没有找到匹配结果，试试其他名称或类型。'
            : '此类型暂无可引用内容。';
          list.append(empty);
        }
        let index = 0;
        for (const group of groups) {
          const section = document.createElement('div');
          section.setAttribute('role', 'group');
          section.setAttribute('aria-label', group.label);
          const heading = document.createElement('div');
          heading.className = 'tano-reference-picker-group';
          heading.textContent = `${group.label} · ${group.targets.length}${group.targets.length > 30 ? '（显示前 30 项）' : ''}`;
          section.append(heading);
          for (const target of group.targets.slice(0, 30)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(index === active));
            button.className = 'tano-reference-picker-option';
            const icon = document.createElement('span');
            icon.className = 'tano-reference-picker-icon';
            icon.dataset.type = group.key;
            icon.setAttribute('aria-hidden', 'true');
            renderIcon(
              h(isAgentPerson(target) ? Bot : (pickerIcons[target.type] ?? Box), {
                size: 16,
                strokeWidth: 1.7,
              }),
              icon,
            );
            iconHosts.push(icon);
            const body = document.createElement('span');
            body.className = 'tano-reference-picker-body';
            const name = document.createElement('span');
            name.className = 'tano-reference-picker-name';
            name.textContent = target.name;
            const badge = document.createElement('span');
            badge.className = 'tano-reference-picker-badge';
            badge.textContent = isAgentPerson(target) ? 'Agent' : referenceTypeLabel(target.type);
            button.title = `${target.name}\n${target.path}\n${target.id}`;
            body.append(name);
            button.append(icon, body, badge);
            button.onmousedown = (event) => event.preventDefault();
            button.onclick = () => choose(target);
            section.append(button);
            index++;
          }
          list.append(section);
        }
        try {
          const rect = view.coordsAtPos(Math.min(session.to, view.state.doc.content.size));
          menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
          menu.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - menu.offsetHeight - 8))}px`;
        } catch {
          /* Detached test views have no coordinates. */
        }
        const to = menu.getBoundingClientRect();
        if (from?.height && to.height && typeof menu.animate === 'function' &&
          !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
          Math.abs(from.height - to.height) > 0.5) {
          const animation = animate(menu, {
            height: [from.height, to.height],
            top: [from.top, to.top],
          }, { duration: 0.24, ease: [0.22, 1, 0.36, 1] });
          sizeMotion = animation;
          void animation.finished.then(() => {
            if (sizeMotion !== animation) return;
            clearSizeMotion();
            menu.style.top = `${to.top}px`;
          });
        }
      }
      search.oninput = () => {
        const current = referencePickerKey.getState(view.state);
        if (current)
          view.dispatch(
            view.state.tr.setMeta(referencePickerKey, { ...current, query: search.value }),
          );
      };
      handleKey = (event) => {
        if (menu.hidden || event.isComposing) return false;
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          view.focus();
          return true;
        }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          if (!matches.length) return true;
          active =
            active === -1
              ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
              : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          render();
          list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
          return true;
        }
        if (event.key === 'Enter' && matches[active]) {
          event.preventDefault();
          choose(matches[active]!);
          return true;
        }
        return false;
      };
      search.onkeydown = handleKey;
      const outside = (event: MouseEvent) => {
        if (
          !menu.contains(event.target as globalThis.Node) &&
          !view.dom.contains(event.target as globalThis.Node)
        )
          close();
      };
      document.addEventListener('mousedown', outside);
      return {
        update() {
          const wasHidden = menu.hidden;
          if (wasHidden) {
            category = 'all';
            active = -1;
          }
          render();
          if (wasHidden && !menu.hidden && manual) queueMicrotask(() => search.focus());
        },
        destroy() {
          clearSizeMotion();
          document.removeEventListener('mousedown', outside);
          for (const host of iconHosts) renderIcon(null, host);
          menu.remove();
          handleKey = () => false;
        },
      };
    },
  });
}
