import { Plugin, PluginKey, TextSelection, NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { referenceCandidates, referenceTypeLabel, referenceUrl } from '@tano/protocol';
import type { ReferenceTarget } from '@tano/protocol';
import { selectedBlocks } from './document-model';

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
  const attrs = { url: referenceUrl(target), label: target.name };
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
          view.state.tr
            .insertText(text, from, to)
            .setMeta(referencePickerKey, {
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
      const title = document.createElement('strong');
      title.textContent = '选择目标 · Level 2';
      const search = document.createElement('input');
      search.setAttribute('aria-label', '搜索引用目标');
      search.placeholder = '名称，或 person:Alice / event:事件';
      const list = document.createElement('div');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', '引用候选');
      const hint = document.createElement('small');
      hint.textContent = '同名目标请核对类型与路径 · ↑↓ 选择 · Enter 绑定 ID · Esc 取消';
      menu.append(title, search, list, hint);
      view.dom.parentElement!.append(menu);
      let matches: ReferenceTarget[] = [],
        active = 0,
        query = '',
        manual = false;
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
      function render() {
        const session = referencePickerKey.getState(view.state);
        menu.hidden = !session || !options.enabled();
        if (menu.hidden || !session) return;
        if (query !== session.query || manual !== !session.typed) active = 0;
        query = session.query;
        manual = !session.typed;
        search.hidden = session.typed;
        if (search.value !== query) search.value = query;
        matches = referenceCandidates(options.targets(), query).slice(0, 30);
        active = Math.min(active, Math.max(0, matches.length - 1));
        list.replaceChildren();
        if (!matches.length) {
          const empty = document.createElement('p');
          empty.textContent = '没有匹配目标。可先在“工作区对象”中创建；未绑定的文字会保留。';
          list.append(empty);
        }
        matches.forEach((target, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'option');
          button.setAttribute('aria-selected', String(index === active));
          button.textContent = `${target.name} · ${referenceTypeLabel(target.type)}`;
          const path = document.createElement('small');
          path.textContent = `${target.path} · ${target.id.slice(0, 8)}`;
          button.append(path);
          button.onmousedown = (event) => event.preventDefault();
          button.onclick = () => choose(target);
          list.append(button);
        });
        try {
          const rect = view.coordsAtPos(Math.min(session.to, view.state.doc.content.size));
          menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 356))}px`;
          menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 340))}px`;
        } catch {
          /* Detached test views have no coordinates. */
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
          active =
            (active + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, matches.length)) %
            Math.max(1, matches.length);
          render();
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
          render();
          if (wasHidden && !menu.hidden && manual) queueMicrotask(() => search.focus());
        },
        destroy() {
          document.removeEventListener('mousedown', outside);
          menu.remove();
          handleKey = () => false;
        },
      };
    },
  });
}
