import { watch } from 'vue';
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import { parseReferenceUrl, resolveReference, referenceTypeLabel } from '@tano/protocol';
import type { ReferenceTarget, ReferenceIdentity } from '@tano/protocol';

export function referenceViews(
  targets: () => readonly ReferenceTarget[],
  enabled: () => boolean,
  open: (identity: ReferenceIdentity) => void,
  revealSource: () => boolean,
  editSource: (view: EditorView, pos: number) => void,
): Record<string, NodeViewConstructor> {
  return Object.fromEntries(
    ['tano_reference', 'tano_reference_block'].map((type) => [
      type,
      ((node, view, getPos) => {
        let current = node;
        const block = type === 'tano_reference_block';
        const canEditSource = () => !block && enabled() && revealSource();
        const dom = document.createElement(block ? 'div' : 'span');
        dom.contentEditable = 'false';
        dom.className = block ? 'tano-reference-card' : 'tano-reference';
        dom.dataset.tanoReference = block ? 'block' : 'inline';
        dom.dataset.featureLevel = '2';
        const button = document.createElement('button');
        button.type = 'button';
        const label = document.createElement('span'),
          badge = document.createElement('small');
        const detail = document.createElement('small');
        button.append(label, badge);
        dom.append(button);
        if (block) dom.append(detail);
        button.onmousedown = (event) => {
          if (canEditSource() && !event.ctrlKey && !event.metaKey && !event.altKey)
            event.preventDefault();
        };
        button.onclick = (event) => {
          if (canEditSource() && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const pos = getPos();
            if (typeof pos === 'number') editSource(view, pos);
            return;
          }
          const identity = parseReferenceUrl(current.attrs.url);
          if (identity && 'target' in resolveReference(targets(), identity)) open(identity);
        };
        function render() {
          dom.dataset.referenceUrl = current.attrs.url;
          dom.dataset.referenceLabel = current.attrs.label;
          const identity = parseReferenceUrl(current.attrs.url);
          const result = identity ? resolveReference(targets(), identity) : { error: 'missing' };
          const target = 'target' in result ? result.target : undefined;
          const missing = !target;
          dom.classList.toggle('is-missing', missing);
          label.textContent = enabled()
            ? `${block ? '' : '@'}${target?.name ?? current.attrs.label}`
            : `[${block ? '' : '@'}${current.attrs.label}](${current.attrs.url}${block ? ' "tano:object-card"' : ''})`;
          button.disabled = (!enabled() || missing) && !canEditSource();
          const task = target && (target.type === 'task' || (target.type === 'event' && target.properties?.checkable === true));
          const completed = target?.properties?.completed === true || ['done', 'completed'].includes(String(target?.properties?.status));
          badge.textContent = !enabled()
            ? 'Level 2 已关闭'
            : missing
              ? '引用不可用'
              : `${task ? `任务 · ${completed ? '已完成' : '未完成'}` : referenceTypeLabel(target.type)}${target.archived ? ' · 已归档' : ''}`;
          detail.textContent =
            (target?.type === 'event'
              ? `${String(target.properties?.start ?? '')} — ${String(target.properties?.end ?? '')}`
              : '') ||
            (target?.type === 'asset'
              ? `${target.mime} · ${target.size} 字节 · ${target.path}`
              : '') ||
            target?.description ||
            target?.path ||
            '目标已移除、ID 重复或类型插件未启用；原始 ID 已保留';
          button.title = `${referenceTypeLabel(identity?.type ?? '')} · ${current.attrs.url}${canEditSource() ? ' · 点击编辑 Markdown，Ctrl/⌘ 点击打开' : ''}`;
          button.setAttribute(
            'aria-label',
            canEditSource()
              ? `编辑引用源码 ${target?.name ?? current.attrs.label}，Ctrl 或 Command 点击打开`
              : `打开引用 ${target?.name ?? current.attrs.label}`,
          );
        }
        render();
        const stop = watch(() => [targets(), enabled(), revealSource()], render, { deep: true });
        return {
          dom,
          update(next) {
            if (next.type !== current.type) return false;
            current = next;
            render();
            return true;
          },
          ignoreMutation: () => true,
          stopEvent: (event) => button.contains(event.target as globalThis.Node),
          destroy() {
            stop();
            button.onmousedown = null;
            button.onclick = null;
          },
        };
      }) satisfies NodeViewConstructor,
    ]),
  );
}
