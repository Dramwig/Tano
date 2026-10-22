import { h, render as renderIcon, watch, type Component } from 'vue';
import { ArrowUpRight, Box, CalendarDays, Circle, CircleCheck, FileText, Folder, Link2Off, Paperclip, UserRound } from 'lucide-vue-next';
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import { parseReferenceUrl, resolveReference, referenceTypeLabel } from '@tano/protocol';
import type { ReferenceTarget, ReferenceIdentity } from '@tano/protocol';

const referenceIcons: Record<string, Component> = {
  person: UserRound, event: CalendarDays, task: CircleCheck,
  project: Folder, document: FileText, asset: Paperclip,
};

function eventDetail(target: ReferenceTarget) {
  const values = [target.properties?.start, target.properties?.end]
    .filter((value): value is string => typeof value === 'string' && !!value.trim());
  if (!values.length) return '';
  const dates = values.map(value => new Date(value));
  if (dates.some(date => !Number.isFinite(date.getTime()))) return values.join(' — ');
  const formatter = new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return dates.length === 2 && dates[0]! <= dates[1]!
    ? formatter.formatRange(dates[0]!, dates[1]!)
    : dates.map(date => formatter.format(date)).join(' — ');
}

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
        label.className = 'tano-reference-label';
        badge.className = 'tano-reference-badge';
        const icon = document.createElement('span');
        icon.className = 'tano-reference-icon';
        icon.setAttribute('aria-hidden', 'true');
        const detail = document.createElement('small');
        detail.className = 'tano-reference-detail';
        const arrow = document.createElement('span');
        arrow.className = 'tano-reference-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        if (block) {
          const body = document.createElement('span');
          body.className = 'tano-reference-body';
          const heading = document.createElement('span');
          heading.className = 'tano-reference-heading';
          heading.append(label, badge);
          body.append(heading, detail);
          renderIcon(h(ArrowUpRight, { size: 16, strokeWidth: 1.7 }), arrow);
          button.append(icon, body, arrow);
        } else button.append(icon, label);
        dom.append(button);
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
          dom.classList.toggle('is-disabled', !enabled());
          label.textContent = enabled()
            ? `${target?.name ?? current.attrs.label}`
            : `[${block ? '' : '@'}${current.attrs.label}](${current.attrs.url}${block ? ' "tano:object-card"' : ''})`;
          if (enabled() && !block) {
            const prefix = document.createElement('span');
            prefix.className = 'tano-reference-prefix';
            prefix.textContent = '@';
            label.prepend(prefix);
          }
          button.disabled = (!enabled() || missing) && !canEditSource();
          const task = target && (target.type === 'task' || (target.type === 'event' && target.properties?.checkable === true));
          const completed = target?.properties?.completed === true || ['done', 'completed'].includes(String(target?.properties?.status));
          dom.dataset.referenceType = task ? 'task' : identity?.type ?? '';
          dom.classList.toggle('is-completed', !!task && completed);
          renderIcon(h(missing ? Link2Off : task ? completed ? CircleCheck : Circle : referenceIcons[target.type] ?? Box, {
            size: block ? 21 : 14, strokeWidth: 1.7,
          }), icon);
          badge.textContent = !enabled()
            ? 'Level 2 已关闭'
            : missing
              ? '引用不可用'
              : `${task ? `任务 · ${completed ? '已完成' : '未完成'}` : referenceTypeLabel(target.type)}${target.archived ? ' · 已归档' : ''}`;
          detail.textContent =
            (target?.type === 'event' ? eventDetail(target) : '') ||
            (target?.type === 'asset'
              ? `${target.mime} · ${target.size} 字节 · ${target.path}`
              : '') ||
            target?.description ||
            target?.path ||
            (missing ? '目标已移除、ID 重复或类型插件未启用；原始 ID 已保留' : '');
          detail.hidden = !detail.textContent;
          detail.dataset.tooltip = target?.type === 'event'
            ? [target.properties?.start, target.properties?.end].filter(Boolean).join(' — ')
            : detail.textContent ?? '';
          if (block) {
            button.dataset.tooltip = `${referenceTypeLabel(identity?.type ?? '')} · ${current.attrs.url}`;
          } else {
            button.dataset.tooltip = badge.textContent ?? '';
          }
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
            renderIcon(null, icon);
            if (block) renderIcon(null, arrow);
            button.onmousedown = null;
            button.onclick = null;
          },
        };
      }) satisfies NodeViewConstructor,
    ]),
  );
}
