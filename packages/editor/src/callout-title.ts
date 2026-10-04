import info from './callout-icons/phosphor/info-duotone.svg?raw';
import lightbulb from './callout-icons/phosphor/lightbulb-duotone.svg?raw';
import sparkle from './callout-icons/phosphor/sparkle-duotone.svg?raw';
import warning from './callout-icons/phosphor/warning-duotone.svg?raw';
import shieldWarning from './callout-icons/phosphor/shield-warning-duotone.svg?raw';

export type CalloutKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const callouts: Record<CalloutKind, { label: string; icon: string }> = {
  NOTE: { label: '备注', icon: info },
  TIP: { label: '提示', icon: lightbulb },
  IMPORTANT: { label: '重要', icon: sparkle },
  WARNING: { label: '警告', icon: warning },
  CAUTION: { label: '注意', icon: shieldWarning },
};

export function createCalloutTitle(kind: CalloutKind): HTMLDivElement {
  const { label, icon: source } = callouts[kind];
  const title = document.createElement('div');
  title.className = 'tano-callout-title';
  title.contentEditable = 'false';

  const icon = document.importNode(
    new DOMParser().parseFromString(source, 'image/svg+xml').documentElement,
    true,
  );
  icon.classList.add('tano-callout-icon');
  icon.setAttribute('fill', 'currentColor');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');

  const text = document.createElement('span');
  text.textContent = label;
  title.append(icon, text);
  return title;
}
