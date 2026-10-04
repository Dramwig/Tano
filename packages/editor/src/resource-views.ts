import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { Ellipsis, ExternalLink, FileUp, Image as ImageIcon } from 'lucide-vue-next';
import { h, render as renderIcon, watch, type Component } from 'vue';
import { safeResourceUrl } from './enhanced-markdown';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, onOtherEditorPanel } from './editor-panel';
import { positionAnchoredPanel, type PanelSide } from './panel-position';

function resourceName(reference: string) {
  const name = reference.split(/[?#]/)[0]!.split('/').pop() || reference;
  try { return decodeURIComponent(name); } catch { return name; }
}

/** Resource contents stay in Markdown; the edit panel and media state stay in the view. */
export function resourceView(
  kind: 'file' | 'embed',
  readonly: () => boolean,
  open: (url: string) => void,
  resolve: (url: string) => string | null,
  revision: () => string | undefined,
): NodeViewConstructor {
  return (node, view, getPos) => {
    let current = node;
    let editing = false;
    let mediaKey = '';
    let failed = false;
    let panelSide: PanelSide | undefined;
    let stopPositioning: (() => void) | undefined;
    const dom = document.createElement('section');
    dom.className = `tano-enhanced tano-${kind} tano-resource`;
    dom.contentEditable = 'false';
    dom.dataset.tanoEnhanced = kind;
    dom.dataset.featureLevel = '1';
    const icons: HTMLElement[] = [];
    const icon = (component: Component) => {
      const holder = document.createElement('span');
      holder.className = 'tano-resource-icon';
      holder.setAttribute('aria-hidden', 'true');
      renderIcon(h(component, { size: 20, strokeWidth: 1.7 }), holder);
      icons.push(holder);
      return holder;
    };
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tano-resource-row';
    const name = document.createElement('span');
    name.className = 'tano-resource-name';
    const meta = document.createElement('small');
    meta.className = 'tano-resource-meta';
    row.append(icon(kind === 'embed' ? ImageIcon : FileUp), name, meta);
    const preview = document.createElement('div');
    preview.className = 'tano-embed-preview';
    const actions = document.createElement('div');
    actions.className = 'tano-resource-actions';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.setAttribute('aria-label', '打开附件');
    openButton.title = '打开附件';
    openButton.append(icon(ExternalLink));
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.setAttribute('aria-label', '编辑附件');
    editButton.title = '编辑附件';
    editButton.append(icon(Ellipsis));
    actions.append(openButton, editButton);
    const panel = createEditorPanel('div', 'tano-resource-editor-panel', '编辑附件');
    const field = (labelText: string) => {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', labelText);
      label.append(caption, input);
      panel.append(label);
      return input;
    };
    const title = field('附件名称');
    const url = field('附件地址');
    url.placeholder = 'HTTPS 地址或工作空间内的相对路径';
    const error = document.createElement('p');
    error.className = 'tano-resource-error';
    error.setAttribute('role', 'status');
    error.hidden = true;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'tano-resource-done';
    done.textContent = '完成';
    panel.append(error, done);
    dom.append(row, preview, actions, panel);

    function setAttrs(attrs: Record<string, string>) {
      const pos = getPos();
      if (pos !== undefined && !readonly())
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
    }
    function positionPanel() {
      panelSide = positionAnchoredPanel(dom, panel, 0, panelSide);
    }
    function closePanel(refocus = false) {
      editing = false;
      panelSide = undefined;
      stopPositioning?.();
      stopPositioning = undefined;
      panel.hidden = true;
      dom.classList.remove('tano-editor-active');
      error.hidden = true;
      url.setCustomValidity('');
      if (refocus) editButton.focus();
    }
    function openPanel() {
      if (readonly() || editing) return;
      announceEditorPanel(view.dom, dom);
      editing = true;
      panel.hidden = false;
      dom.classList.add('tano-editor-active');
      title.value = String(current.attrs.title ?? '');
      url.value = String(current.attrs.url ?? '');
      stopPositioning = activateEditorPanel({ panel, anchor: dom, position: positionPanel, close: () => closePanel() });
      url.focus();
    }
    function openResource() {
      const reference = String(current.attrs.url ?? '');
      if (safeResourceUrl(reference)) open(reference);
    }
    function commitUrl() {
      if (readonly()) return false;
      const reference = url.value.trim();
      if (!safeResourceUrl(reference)) {
        error.textContent = '请使用 HTTP(S) 地址或工作空间内的相对路径';
        error.hidden = false;
        url.setCustomValidity(error.textContent);
        positionPanel();
        return false;
      }
      error.hidden = true;
      url.setCustomValidity('');
      if (reference !== current.attrs.url) setAttrs({ url: reference });
      return true;
    }
    title.oninput = () => setAttrs({ title: title.value.replace(/[\r\n]/g, ' ') });
    url.onchange = commitUrl;
    url.oninput = () => { error.hidden = true; url.setCustomValidity(''); };
    done.onclick = () => { if (commitUrl()) closePanel(true); };
    panel.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (commitUrl()) closePanel(true);
      }
    };
    row.onclick = () => safeResourceUrl(String(current.attrs.url ?? '')) ? openResource() : openPanel();
    editButton.onclick = openPanel;
    openButton.onclick = openResource;
    preview.onclick = (event) => {
      if ((event.target as HTMLElement).tagName !== 'IMG') return;
      if (readonly()) openResource(); else openPanel();
    };
    preview.onkeydown = (event) => {
      if ((event.target as HTMLElement).tagName !== 'IMG' || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (readonly()) openResource(); else openPanel();
    };

    function render() {
      if (readonly() && editing) closePanel();
      const reference = String(current.attrs.url ?? '');
      const label = String(current.attrs.title ?? '') || resourceName(reference);
      const safe = safeResourceUrl(reference);
      const resolved = kind === 'embed' && safe ? resolve(reference) : null;
      const type = kind === 'embed' && /\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(reference) ? 'image'
        : kind === 'embed' && /\.(?:mp4|webm)(?:[?#]|$)/i.test(reference) ? 'video'
        : kind === 'embed' && /\.(?:mp3|wav|ogg)(?:[?#]|$)/i.test(reference) ? 'audio' : 'file';
      // Title edits and selection changes must not reload a playing media element.
      const nextKey = `${reference}\0${resolved ?? ''}\0${revision() ?? ''}`;
      if (mediaKey !== nextKey) {
        mediaKey = nextKey;
        failed = false;
        preview.replaceChildren();
        if (resolved && type !== 'file') {
          const key = mediaKey;
          const media = document.createElement(type === 'image' ? 'img' : type);
          media.src = resolved;
          if (media instanceof HTMLImageElement) {
            media.loading = 'lazy';
            media.referrerPolicy = 'no-referrer';
          } else {
            media.controls = true;
            media.preload = 'metadata';
          }
          media.onerror = () => {
            if (key !== mediaKey) return;
            failed = true;
            render();
          };
          media.onload = () => dom.dispatchEvent(new Event('tano-block-layout', { bubbles: true }));
          if (media instanceof HTMLMediaElement)
            media.onloadedmetadata = () => dom.dispatchEvent(new Event('tano-block-layout', { bubbles: true }));
          preview.append(media);
        }
      }
      const hasPreview = !!resolved && type !== 'file' && !failed;
      const unavailable = type !== 'file' && !hasPreview;
      dom.dataset.title = String(current.attrs.title ?? '');
      dom.dataset.url = reference;
      dom.dataset.resourceState = hasPreview ? 'preview' : !safe || unavailable ? 'placeholder' : 'file';
      name.textContent = !safe ? (kind === 'embed' ? '添加图片或嵌入链接' : '添加文件或嵌入链接')
        : unavailable ? `${type === 'image' ? '图片' : '音视频'}暂不可用 · ${label}` : label;
      const extension = /\.([a-z0-9]{1,8})(?:[?#]|$)/i.exec(reference)?.[1]?.toUpperCase() ?? '';
      meta.textContent = safe && !unavailable && !label.toUpperCase().endsWith(`.${extension}`) ? extension : '';
      meta.hidden = !meta.textContent;
      row.title = reference;
      row.setAttribute('aria-label', !safe ? name.textContent : `打开附件：${label}`);
      row.disabled = !safe && readonly();
      row.hidden = hasPreview;
      preview.hidden = !hasPreview;
      openButton.hidden = !hasPreview;
      openButton.disabled = !safe;
      editButton.hidden = readonly();
      actions.hidden = !hasPreview && readonly();
      const image = preview.querySelector('img');
      if (image) {
        image.alt = label;
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', readonly() ? `打开附件：${label}` : `编辑图片：${label}`);
      }
      title.readOnly = url.readOnly = readonly();
      if (document.activeElement !== title) title.value = String(current.attrs.title ?? '');
      if (document.activeElement !== url) url.value = reference;
      if (editing) positionPanel();
      if (dom.isConnected) dom.dispatchEvent(new Event('tano-block-layout', { bubbles: true }));
    }
    const stopOther = onOtherEditorPanel(view.dom, dom, () => closePanel());
    const stopWatch = watch(() => [readonly(), revision()], render);
    render();
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      stopEvent: () => true,
      ignoreMutation: (mutation) => mutation.type !== 'selection',
      destroy() {
        closePanel();
        stopOther();
        stopWatch();
        for (const holder of icons) renderIcon(null, holder);
        preview.querySelectorAll<HTMLImageElement | HTMLMediaElement>('img, audio, video').forEach(media => {
          media.onerror = media.onload = null;
          if (media instanceof HTMLMediaElement) media.onloadedmetadata = null;
        });
      },
    };
  };
}
