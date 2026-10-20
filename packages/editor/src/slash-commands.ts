import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { blockCommand } from './block-commands';
import { blockType, blockTypes, commandEnabled } from './document-model';
import type { DocumentFeatures } from './runtime';
import { safeResourceUrl } from './enhanced-markdown';
import { referencePickerKey } from './reference-picker';
import { isCalloutHeader } from './callout';

interface SlashItem {
  command: string;
  label: string;
  englishLabel: string;
  value?: string;
  keywords: string;
  icon: string;
}
const aliases: Record<string, [string, string, string]> = {
  'object-reference': ['object reference 对象 引用', '@', 'Object Reference'],
  paragraph: ['text plain 正文 文本', 'T', 'Paragraph'],
  quote: ['blockquote 引用', '❞', 'Quote'],
  list: ['bullet unordered 无序', '•', 'Bullet List'],
  'ordered-list': ['number numbered 有序', '1.', 'Ordered List'],
  'todo-list': ['task checkbox check 待办 任务', '☑', 'Task List'],
  'code-block': ['code 代码', '</>', 'Code Block'],
  image: ['picture photo 图片', '▧', 'Image'],
  table: ['表格', '▦', 'Table'],
  mermaid: ['diagram 流程图', '◇', 'Mermaid'],
  callout: ['note tip 提示', 'ⓘ', 'Callout'],
  toggle: ['details 折叠', '▸', 'Toggle'],
  file: ['attachment 附件', '↗', 'Attachment'],
  embed: ['嵌入', '▣', 'Embed'],
  tabs: ['标签页', '▤', 'Tabs'],
  columns: ['分栏', '◫', 'Columns'],
  'horizontal-rule': ['divider separator hr 分割线 分隔线', '—', 'Divider'],
  'math-block': ['math equation latex 公式', '∑', 'Math Block'],
};
const items: SlashItem[] = blockTypes.flatMap<SlashItem>((item) =>
  item.command === 'heading'
    ? Array.from({ length: 4 }, (_, i) => ({
        command: 'heading',
        label: `${i + 1} 级标题`,
        englishLabel: `Heading ${i + 1}`,
        value: String(i + 1),
        keywords: `heading h${i + 1} 标题${i + 1}`,
        icon: `H${i + 1}`,
      }))
    : [
        {
          command: item.command,
          label: item.label,
          englishLabel: aliases[item.command]?.[2] ?? item.command,
          keywords: `${item.command} ${aliases[item.command]?.[0] ?? ''}`,
          icon: aliases[item.command]?.[1] ?? '□',
        },
      ],
);
items.splice(items.findIndex(item => item.command === 'callout') + 1, 0, {
  command: 'callout', value: 'CUSTOM', label: '自定义块', englishLabel: 'Custom Callout',
  keywords: 'custom callout emoji icon 自定义 图标 表情 提示', icon: '💡',
});
// Keep the most common empty-block action first.
items.unshift(
  items.splice(
    items.findIndex((item) => item.command === 'paragraph'),
    1,
  )[0]!,
);

export function slashQuery(state: EditorState) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!['paragraph', 'heading'].includes($from.parent.type.name)) return null;
  const prefix = $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc');
  if (!/^\/[^/\s\ufffc]*$/.test(prefix)) return null;
  return { from: $from.start(), to: selection.from, query: prefix.slice(1) };
}

export function slashItems(query: string, levels?: readonly number[], features?: DocumentFeatures) {
  const words = query.trim().toLowerCase().split(/\s+/);
  return items.filter(
    (item) =>
      commandEnabled(item.command, levels, features) &&
      words.every((word) =>
        `${item.englishLabel} ${item.label} ${item.keywords}`.toLowerCase().includes(word),
      ),
  );
}

/** Delete the query and convert only its own text block in one undoable transaction. */
export function applySlashCommand(
  state: EditorState,
  item: SlashItem,
  value = item.value,
): Transaction | null {
  const query = slashQuery(state);
  if (!query) return null;
  const tr = state.tr.delete(query.from, query.to);
  const clean = state.apply(tr);
  let converted: Transaction | undefined;
  if (
    !blockCommand(
      item.command,
      value,
      true,
    )(clean, (next) => {
      converted = next;
    }) ||
    !converted
  )
    return null;
  for (const step of converted.steps) tr.step(step);
  tr.setSelection(Selection.fromJSON(tr.doc, converted.selection.toJSON()));
  // Start typing inside containers (lists, quotes, tables), skipping the callout marker.
  if (!(tr.selection instanceof TextSelection)) {
    const start = tr.selection.from;
    const node = tr.doc.nodeAt(start);
    let cursor: number | undefined;
    node?.descendants((child, offset) => {
      if (
        cursor === undefined &&
        child.isTextblock &&
        !isCalloutHeader(child.textContent)
      )
        cursor = start + offset + 2;
    });
    if (cursor !== undefined) tr.setSelection(TextSelection.create(tr.doc, cursor));
  }
  return closeHistory(tr).scrollIntoView();
}

export function slashCommands(options: {
  readonly: () => boolean;
  levels: () => readonly number[] | undefined;
  features?: () => DocumentFeatures;
  aiShortcut?: () => boolean;
}) {
  const session = new PluginKey<ReturnType<typeof slashQuery>>('tano-slash-session');
  let refresh = () => {};
  let blur = (_event: FocusEvent) => {};
  let keydown = (_event: KeyboardEvent) => false;
  return new Plugin<ReturnType<typeof slashQuery>>({
    key: session,
    state: {
      init: () => null,
      apply(tr, current, previous, next) {
        const action = tr.getMeta(session);
        if (action === 'close' || options.readonly()) return null;
        const query = slashQuery(next);
        if (
          !query ||
          next.selection.$from.parentOffset !== next.selection.$from.parent.content.size
        )
          return null;
        if (action === 'start') return query;
        if (
          !current ||
          (tr.selectionSet && !tr.docChanged && !next.selection.eq(previous.selection))
        )
          return null;
        if (!tr.docChanged) return current;
        // Heading IDs and other derived attributes can be updated by appended
        // transactions without changing the input or moving its caret.
        if (
          query.from === current.from &&
          query.to === current.to &&
          query.query === current.query &&
          next.selection.eq(previous.selection) &&
          next.doc.textContent === previous.doc.textContent
        )
          return query;
        // Only edits inside this live query may continue the session. Moving the
        // caret, replacing the block, undoing, or editing elsewhere cannot reopen it.
        let from = current.from;
        let to = current.to;
        for (const map of tr.mapping.maps) {
          let outside = false;
          map.forEach((start, end) => {
            if (start < from + 1 || end > to) outside = true;
          });
          if (outside) return null;
          from = map.map(from, -1);
          to = map.map(to, 1);
        }
        return query.from === from && query.to === to ? query : null;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const { selection } = view.state;
        if (
          text !== '/' ||
          options.readonly() ||
          !view.editable ||
          !view.hasFocus() ||
          !(selection instanceof TextSelection) ||
          !selection.empty ||
          from !== to ||
          from !== selection.from ||
          selection.$from.parent.content.size ||
          !['paragraph', 'heading'].includes(selection.$from.parent.type.name)
        )
          return false;
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta(session, 'start'));
        return true;
      },
      decorations(state) {
        if (options.readonly()) return null;
        const decorations: Decoration[] = [];
        // Typed empty blocks keep their labels independently of selection/focus.
        // Only the plain paragraph's slash hint follows the caret.
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock ||
              (node.content.size && !(node.type.name === 'code_block' && !node.textContent.trim())))
            return;
          let placeholder = '';
          let persistent = true;
          if (node.type.name === 'heading') placeholder = `Heading ${node.attrs.level}`;
          else if (node.type.name === 'code_block' && blockType(node) === 'MermaidBlock')
            placeholder = 'Mermaid';
          else if (node.type.name === 'paragraph') {
            const $pos = state.doc.resolve(pos);
            // Choose the nearest enclosing block, so nested lists/quotes do not
            // inherit an unrelated outer container's label.
            for (let depth = $pos.depth; depth > 0; depth--) {
              const parent = $pos.node(depth);
              if (parent.type.name === 'table_header' || parent.type.name === 'table_cell') {
                placeholder = parent.type.name === 'table_header' ? 'Empty header' : 'Empty cell';
                break;
              }
              const command = blockTypes.find((item) => item.type === blockType(parent))?.command;
              if (command && aliases[command]) {
                placeholder = command === 'list' || command === 'ordered-list' ? 'List'
                  : command === 'quote' ? 'Empty quote' : aliases[command]![2];
                break;
              }
            }
            if (!placeholder) {
              const { selection } = state;
              if (!(selection instanceof TextSelection) || !selection.empty ||
                  selection.$from.depth === 0 || selection.$from.before() !== pos) return;
              placeholder = options.aiShortcut?.()
                ? "输入 '/' 搜索并切换块类型，或按 space（空格）启用 AI"
                : "输入 '/' 搜索并切换块类型";
              persistent = false;
            }
          }
          if (!placeholder) return;
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: `tano-empty-block${persistent ? ' tano-empty-block-persistent' : ''}${node.type.name === 'heading' ? ' tano-empty-heading' : ''}`,
              'data-placeholder': placeholder,
            }),
          );
        });
        return DecorationSet.create(state.doc, decorations);
      },
      handleDOMEvents: {
        focus() {
          refresh();
          return false;
        },
        blur(_view, event) {
          blur(event);
          return false;
        },
        keydown(_view, event) {
          if (!keydown(event)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
    view(view) {
      const menu = document.createElement('div');
      menu.className = 'tano-slash-menu';
      menu.hidden = true;
      menu.setAttribute('aria-label', '切换块类型');
      const title = document.createElement('div');
      title.className = 'tano-slash-title';
      const list = document.createElement('div');
      list.className = 'tano-slash-results';
      list.id = `tano-slash-${crypto.randomUUID()}`;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', '块类型搜索结果');
      menu.append(title, list);
      view.dom.ownerDocument.body.append(menu);
      let matches: SlashItem[] = [];
      let active = 0;
      let signature = '';
      let unmatchedLength: number | undefined;
      let formItem: SlashItem | undefined;
      let formState: EditorState | undefined;
      let destroyed = false;

      function hide() {
        menu.hidden = true;
        view.dom.removeAttribute('aria-controls');
        view.dom.removeAttribute('aria-activedescendant');
      }
      function close() {
        unmatchedLength = undefined;
        formItem = undefined;
        formState = undefined;
        hide();
        if (session.getState(view.state))
          view.dispatch(view.state.tr.setMeta(session, 'close').setMeta('addToHistory', false));
      }
      blur = (event) => {
        if (!(event.relatedTarget instanceof Node) || !menu.contains(event.relatedTarget)) close();
      };
      function position() {
        if (menu.hidden) return;
        const query = session.getState(view.state);
        if (!query) return;
        const caret = view.coordsAtPos(query.from);
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        const below = top + height - caret.bottom - 12;
        const above = caret.top - top - 12;
        const upwards = below < 220 && above > below;
        menu.style.maxHeight = `${Math.max(60, upwards ? above : below)}px`;
        menu.style.left = `${Math.max(left + 8, Math.min(caret.left, left + width - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(top + 8, upwards ? caret.top - menu.offsetHeight - 6 : caret.bottom + 6)}px`;
      }
      function select(index: number, scroll = false) {
        active = index;
        Array.from(list.querySelectorAll('[role="option"]')).forEach((child, i) =>
          child.setAttribute('aria-selected', String(i === active)),
        );
        const selected = matches.length
          ? (list.children[active] as HTMLElement | undefined)
          : undefined;
        if (selected) {
          view.dom.setAttribute('aria-activedescendant', selected.id);
          if (scroll) selected.scrollIntoView?.({ block: 'nearest' });
        } else view.dom.removeAttribute('aria-activedescendant');
      }
      function execute(item: SlashItem, value?: string) {
        if (!session.getState(view.state)) return;
        if (options.readonly() || !commandEnabled(item.command, options.levels())) {
          close();
          return;
        }
        if (item.command === 'object-reference') {
          const query = slashQuery(view.state);
          if (!query) return;
          const tr = view.state.tr.delete(query.from, query.to).setMeta(referencePickerKey, { from: query.from, to: query.from, query: '', block: true, typed: false, trigger: '@' });
          close(); view.dispatch(tr); return;
        }
        const tr = applySlashCommand(view.state, item, value);
        if (!tr) {
          title.textContent = '当前容器不支持此块类型，请选择其他类型';
          return;
        }
        close();
        view.dispatch(tr);
        view.focus();
      }
      function choose(item: SlashItem) {
        if (!session.getState(view.state)) return;
        if (!['image', 'file', 'embed'].includes(item.command)) {
          execute(item);
          return;
        }
        formItem = item;
        formState = view.state;
        title.textContent = `插入${item.label}`;
        list.replaceChildren();
        list.removeAttribute('role');
        view.dom.removeAttribute('aria-activedescendant');
        const form = document.createElement('form');
        form.className = 'tano-slash-form';
        const input = document.createElement('input');
        input.placeholder = 'HTTPS 地址或工作空间内的相对路径';
        input.setAttribute('aria-label', `${item.label}地址`);
        const error = document.createElement('small');
        error.setAttribute('role', 'alert');
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = '插入';
        form.append(input, error, submit);
        form.onsubmit = (event) => {
          event.preventDefault();
          const value = input.value.trim();
          if (!safeResourceUrl(value)) {
            error.textContent = '请填写有效的网页地址或相对路径';
            return;
          }
          execute(item, value);
        };
        list.append(form);
        input.focus();
        position();
      }
      refresh = () => {
        if (destroyed) return;
        const query = session.getState(view.state);
        if (options.readonly() || !view.editable || !query) {
          close();
          signature = '';
          return;
        }
        if (formItem) {
          if (
            formState?.doc !== view.state.doc ||
            !formState.selection.eq(view.state.selection) ||
            !commandEnabled(formItem.command, options.levels())
          )
            close();
          return;
        }
        const next = `${query.from}:${query.to}:${query.query}`;
        if (next !== signature) {
          active = 0;
        }
        signature = next;
        if (!view.hasFocus()) {
          close();
          return;
        }
        matches = slashItems(query.query, options.levels(), options.features?.());
        const queryLength = Array.from(query.query).length;
        if (matches.length) unmatchedLength = undefined;
        else if (unmatchedLength === undefined || queryLength < unmatchedLength)
          unmatchedLength = queryLength;
        else if (queryLength - unmatchedLength >= 2) {
          close();
          return;
        }
        active = Math.min(active, Math.max(0, matches.length - 1));
        title.textContent = '';
        list.setAttribute('role', 'listbox');
        list.replaceChildren();
        matches.forEach((item, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'tano-slash-option';
          button.id = `${list.id}-${index}`;
          button.setAttribute('role', 'option');
          const icon = document.createElement('span');
          icon.className = 'tano-slash-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = item.icon;
          const label = document.createElement('span');
          label.className = 'tano-slash-label-zh';
          label.textContent = item.label;
          const english = document.createElement('span');
          english.className = 'tano-slash-label-en';
          english.textContent = item.englishLabel;
          button.append(icon, english, label);
          button.onmouseenter = () => select(index);
          button.onclick = () => choose(item);
          list.append(button);
        });
        if (!matches.length) {
          const empty = document.createElement('div');
          empty.className = 'tano-slash-empty';
          empty.setAttribute('role', 'status');
          empty.textContent = '没有匹配的块类型';
          list.append(empty);
        }
        menu.hidden = false;
        view.dom.setAttribute('aria-controls', list.id);
        select(active);
        position();
      };
      keydown = (event) => {
        if (
          !menu.hidden &&
          !formItem &&
          !event.isComposing &&
          !view.composing &&
          [' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(
            event.key,
          )
        ) {
          close();
          return false;
        }
        if (
          menu.hidden ||
          formItem ||
          event.isComposing ||
          view.composing ||
          event.keyCode === 229 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        )
          return false;
        if (event.key === 'Escape') {
          close();
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (matches.length)
            select(
              (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
              true,
            );
          return true;
        }
        if (event.key === 'Enter' && matches[active]) {
          choose(matches[active]!);
          return true;
        }
        return false;
      };
      menu.onmousedown = (event) => {
        if (!formItem) event.preventDefault();
      };
      menu.onkeydown = (event) => {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          close();
          view.focus();
        }
      };
      const outside = (event: PointerEvent) => {
        if (!menu.contains(event.target as Node)) close();
      };
      document.addEventListener('pointerdown', outside);
      document.addEventListener('scroll', position, true);
      window.addEventListener('resize', position);
      window.addEventListener('blur', close);
      window.visualViewport?.addEventListener('resize', position);
      window.visualViewport?.addEventListener('scroll', position);
      refresh();
      return {
        update: refresh,
        destroy() {
          destroyed = true;
          hide();
          menu.remove();
          document.removeEventListener('pointerdown', outside);
          document.removeEventListener('scroll', position, true);
          window.removeEventListener('resize', position);
          window.removeEventListener('blur', close);
          window.visualViewport?.removeEventListener('resize', position);
          window.visualViewport?.removeEventListener('scroll', position);
        },
      };
    },
  });
}
