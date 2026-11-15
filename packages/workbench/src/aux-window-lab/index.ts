import { createApp } from 'vue';
import '../styles.css';
import LabHost from './LabHost.vue';

/** Mounts the auxiliary window prototype (dev builds only, opened via the command palette). */
export async function runAuxWindowLab(root: HTMLElement) {
  document.title = '辅助窗口原型 — Tano';
  root.replaceChildren();
  createApp(LabHost).mount(root);
}

export { openAuxWindow, nativeLabelOf, AuxWindowError } from './aux-window';
export type { AuxWindow, AuxWindowOptions } from './aux-window';
