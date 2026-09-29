import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { safeResourceUrl } from './enhanced-markdown';
import { watch } from 'vue';

/** Presentation state (expanded toggle / active tab) stays out of Markdown and Yjs. */
export function enhancedViews(
  readonly: () => boolean,
  open: (url: string) => void,
  resolve: (url: string) => string | null,
  revision: () => string | undefined = () => undefined,
): Record<string, NodeViewConstructor> {
  const views: Record<string, NodeViewConstructor> = {};
  for (const kind of ['toggle', 'panel', 'tabs', 'columns', 'file', 'embed']) {
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
      title.setAttribute(
        'aria-label',
        kind === 'toggle' ? '折叠块标题' : kind === 'panel' ? '分区标题' : '附件名称',
      );
      const toggle = document.createElement('button');
      toggle.type = 'button';
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
        render();
      };
      if (kind === 'toggle') header.append(toggle);
      if (['toggle', 'panel', 'file', 'embed'].includes(kind)) header.append(title);
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
      }
      const tabs = document.createElement('div');
      tabs.className = 'tano-tab-list';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '内容标签页');
      if (kind === 'tabs') header.append(tabs);
      if (kind === 'tabs' || kind === 'columns') {
        const add = document.createElement('button');
        add.type = 'button';
        add.textContent = kind === 'tabs' ? '＋ 标签页' : '＋ 分栏';
        add.setAttribute('aria-label', kind === 'tabs' ? '添加标签页' : '添加分栏');
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
      const resource = kind === 'file' || kind === 'embed';
      const url = document.createElement('input');
      url.setAttribute('aria-label', '附件地址');
      url.onchange = () => {
        if (safeResourceUrl(url.value)) {
          url.setCustomValidity('');
          setAttrs({ url: url.value });
        } else {
          url.setCustomValidity('请使用 HTTP(S) 地址或工作空间内的相对路径');
          url.reportValidity();
        }
      };
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = '打开附件';
      link.onclick = () => {
        if (safeResourceUrl(current.attrs.url)) open(current.attrs.url);
      };
      const preview = document.createElement('div');
      preview.className = 'tano-embed-preview';
      if (resource) {
        header.append(url, link);
        dom.append(header, preview);
      } else dom.append(header, content);
      function render() {
        dom.dataset.title = current.attrs.title;
        dom.dataset.url = current.attrs.url;
        title.value = current.attrs.title;
        title.readOnly = readonly();
        url.readOnly = readonly();
        header.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
          if (button !== toggle && button !== link) button.disabled = readonly();
        });
        url.value = current.attrs.url;
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
            button.setAttribute('aria-selected', String(index === active));
            button.textContent = panel.attrs.title || `标签页 ${index + 1}`;
            button.onclick = () => {
              active = index;
              render();
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
            (child as HTMLElement).hidden = index !== active;
          });
        }
        if (resource) {
          link.disabled = !safeResourceUrl(current.attrs.url);
          preview.replaceChildren();
          if (kind === 'embed') {
            const reference = String(current.attrs.url);
            const resolved = safeResourceUrl(reference) ? resolve(reference) : null;
            if (resolved && /\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(reference)) {
              const img = document.createElement('img');
              img.src = resolved;
              img.alt = current.attrs.title;
              img.referrerPolicy = 'no-referrer';
              img.onerror = () => {
                preview.textContent = '图片暂不可用，可点击“打开附件”查看';
              };
              preview.append(img);
            } else if (resolved && /\.(?:mp4|webm|mp3|wav|ogg)(?:[?#]|$)/i.test(reference)) {
              const media = document.createElement(
                /\.(?:mp3|wav|ogg)(?:[?#]|$)/i.test(reference) ? 'audio' : 'video',
              );
              media.src = resolved;
              media.controls = true;
              media.preload = 'none';
              media.onerror = () => {
                preview.textContent = '音视频暂不可用，可点击“打开附件”查看';
              };
              preview.append(media);
            } else {
              preview.textContent = '链接预览 · 点击“打开附件”查看文件或网页';
            }
          }
        }
      }
      render();
      const stop = watch(() => [readonly(), revision()], render);
      // Child DOM is mounted by ProseMirror after construction.
      queueMicrotask(() => {
        if (dom.isConnected) render();
      });
      return {
        dom,
        ...(resource ? {} : { contentDOM: content }),
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          render();
          queueMicrotask(() => {
            if (dom.isConnected) render();
          });
          return true;
        },
        stopEvent: (event) =>
          header.contains(event.target as globalThis.Node) ||
          preview.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== 'selection' &&
          (header.contains(mutation.target) ||
            preview.contains(mutation.target) ||
            mutation.target === dom ||
            (mutation.type === 'attributes' && mutation.attributeName === 'hidden')),
        destroy() {
          stop();
          title.oninput = url.onchange = toggle.onclick = link.onclick = null;
        },
      };
    };
  }
  return views;
}
