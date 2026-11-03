import { vShow, type ObjectDirective, type VNode } from 'vue';

type Frame = { opacity: number; inset: number[]; y: number };
type Flight = {
  from: Frame; to: Frame; animation: Animation; inner?: Animation;
  done: () => void; opening: boolean;
};
type Surface = {
  root: HTMLElement; target: HTMLElement; modal: boolean; group: boolean;
  flight?: Flight; pending?: number; start?: Frame; removing?: () => void;
  props?: VNode['props']; cleanupNative?: () => void; observer?: MutationObserver;
  registry?: Map<string, Surface>; key?: string; shown: boolean;
  restoreDisplay?: () => void;
  covered?: boolean; restoreVisibility?: () => void;
};
const surfaces = new WeakMap<HTMLElement, Surface>();
const owners = new WeakMap<object, WeakMap<Node, Map<string, Surface>>>();
const active = new Set<Surface>();
const backdropSelector = '.modal-backdrop, .data-modal-backdrop, .object-panel-backdrop, .file-metadata-backdrop, .personal-plan-backdrop, .plan-connections-backdrop, .plan-detail-backdrop, .selection-todo-backdrop, .new-tab-backdrop';
let reduced: MediaQueryList | undefined;

function enabled(root: HTMLElement) {
  if (typeof root.animate !== 'function' || typeof window.matchMedia !== 'function') return false;
  if (!reduced) {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', () => {
      if (!reduced?.matches) return;
      for (const surface of [...active]) finish(surface);
    });
  }
  return !reduced.matches;
}

function getSurface(root: HTMLElement): Surface {
  let surface = surfaces.get(root);
  if (!surface) {
    surface = { root, target: root, modal: false, group: false, shown: false };
    surfaces.set(root, surface);
    root.dataset.surfaceManaged = '';
  }
  return surface;
}

function configure(surface: Surface) {
  const { root } = surface;
  surface.group = root.matches(backdropSelector + ', .field-menu-layer');
  surface.target = surface.group
    ? root.querySelector<HTMLElement>('[role="dialog"], .modal, .settings-dialog') ?? root : root;
  surface.modal = root.tagName === 'DIALOG' || root.matches(backdropSelector) ||
    (root.getAttribute('aria-modal') === 'true' && !root.classList.contains('sidebar'));
}

function closed(surface: Surface): Frame {
  const rect = surface.target.getBoundingClientRect();
  const values = getComputedStyle(surface.target).getPropertyValue('--tano-surface-inset').trim().split(/\s+/);
  const fallback = [-48, -48, rect.height * 0.4, -48];
  const inset = values.length === 4 ? values.map((value, i) =>
    parseFloat(value) * (value.endsWith('%') ? (i % 2 ? rect.width : rect.height) / 100 : 1)) : fallback;
  return { opacity: 0, inset, y: surface.modal ? 8 : 0 };
}
const opened = (): Frame => ({ opacity: 1, inset: [-48, -48, -48, -48], y: 0 });
const clip = (frame: Frame) => `inset(${frame.inset.map(value => `${value}px`).join(' ')} round 8px)`;

function current(surface: Surface): Frame {
  const flight = surface.flight;
  if (!flight) return surface.start ?? (surface.shown ? opened() : closed(surface));
  // Read the compositor's eased progress, including when Vue has detached a
  // replaced vnode. A closing surface can therefore hand its exact visual
  // progress to a newly mounted instance of the same menu.
  const p = Number(flight.animation.effect?.getComputedTiming().progress ?? 0);
  const mix = (a: number, b: number) => a + (b - a) * p;
  return {
    opacity: mix(flight.from.opacity, flight.to.opacity),
    inset: flight.from.inset.map((value, i) => mix(value, flight.to.inset[i]!)),
    y: mix(flight.from.y, flight.to.y),
  };
}

function stop(surface: Surface) {
  if (surface.pending !== undefined) cancelAnimationFrame(surface.pending);
  surface.pending = undefined;
  if (surface.flight) {
    surface.flight.animation.onfinish = null;
    surface.flight.animation.cancel();
    surface.flight.inner?.cancel();
    surface.flight = undefined;
  }
  active.delete(surface);
}

function restoreInteraction(surface: Surface) {
  const { root, props } = surface;
  root.removeAttribute('data-surface-leaving');
  root.inert = props?.inert === true || props?.inert === '';
  root.toggleAttribute('inert', root.inert);
  if (props?.['aria-hidden'] != null) root.setAttribute('aria-hidden', String(props['aria-hidden']));
  else root.removeAttribute('aria-hidden');
}

function finish(surface: Surface) {
  const flight = surface.flight;
  const opening = flight?.opening ?? surface.shown;
  const done = flight?.done;
  stop(surface);
  surface.start = undefined;
  surface.cleanupNative?.();
  surface.cleanupNative = undefined;
  surface.restoreDisplay?.();
  surface.restoreDisplay = undefined;
  surface.restoreVisibility?.(); surface.restoreVisibility = undefined;
  if (opening) restoreInteraction(surface);
  else if (surface.registry?.get(surface.key!) === surface) surface.registry.delete(surface.key!);
  done?.();
}

function run(surface: Surface, opening: boolean, done: () => void = () => {}) {
  configure(surface);
  if (!opening && surface.flight && !surface.flight.opening) {
    // close() may run before Vue removes the node. Keep the same flight and
    // replace its completion with Vue's actual removal callback.
    surface.flight.done = done;
    return;
  }
  let from = surface.flight || surface.start || surface.pending !== undefined ? current(surface) : opening ? closed(surface) : opened();
  stop(surface);
  surface.start = undefined;
  surface.shown = opening;
  if (opening) {
    const previous = surface.registry?.get(surface.key!);
    if (previous && previous !== surface && previous.flight && !previous.flight.opening) {
      from = current(previous);
      finish(previous);
    }
    surface.registry?.set(surface.key!, surface);
    surface.cleanupNative?.(); surface.cleanupNative = undefined;
    surface.restoreDisplay?.(); surface.restoreDisplay = undefined;
    surface.restoreVisibility?.(); surface.restoreVisibility = undefined;
    restoreInteraction(surface);
  } else {
    surface.root.dataset.surfaceLeaving = '';
    surface.root.inert = true;
    surface.root.setAttribute('inert', '');
    surface.root.setAttribute('aria-hidden', 'true');
    // The state/ARIA transition is immediate; only the paint survives closing.
    if (surface.root.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur?.();
  }
  if (!enabled(surface.root) || !surface.root.isConnected || Math.abs(from.opacity - Number(opening)) < 0.001) {
    surface.cleanupNative?.(); surface.cleanupNative = undefined;
    surface.restoreDisplay?.(); surface.restoreDisplay = undefined;
    surface.restoreVisibility?.(); surface.restoreVisibility = undefined;
    if (!opening && surface.registry?.get(surface.key!) === surface) surface.registry.delete(surface.key!);
    done();
    return;
  }
  const to = opening ? opened() : closed(surface);
  const duration = (opening ? 180 : 130) * Math.abs(to.opacity - from.opacity);
  const frames: Keyframe[] = [from, to].map(frame => ({
    opacity: frame.opacity,
    ...(!surface.group && !surface.modal ? { clipPath: clip(frame) } : {}),
  }));
  const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' };
  const animation = surface.root.animate(frames, options);
  const inner = surface.modal ? surface.target.animate([{ translate: `0 ${from.y}px` }, { translate: `0 ${to.y}px` }], options) : undefined;
  surface.flight = { from, to, animation, inner, done, opening };
  active.add(surface);
  animation.onfinish = () => { if (surface.flight?.animation === animation) finish(surface); };
}

function visible(root: HTMLElement) {
  if (root.hidden || root.style.display === 'none' || root.classList.contains('field-menu-covered')) return false;
  if (root.tagName === 'DIALOG' && !(root as HTMLDialogElement).open) return false;
  if (root.hasAttribute('popover') && !root.matches(':popover-open')) return false;
  return getComputedStyle(root).visibility !== 'hidden';
}

function enter(surface: Surface) {
  if (surface.pending !== undefined) return;
  if (!enabled(surface.root)) { surface.shown = true; restoreInteraction(surface); return; }
  const from = surface.flight ? current(surface) : undefined;
  stop(surface);
  surface.start = from;
  // Positioning code runs in nextTick. Wait until it has chosen the side and
  // measured the final border box; never animate an unpositioned popup.
  surface.pending = requestAnimationFrame(() => {
    surface.pending = undefined;
    if (visible(surface.root)) run(surface, true);
  });
}

function observe(surface: Surface) {
  if (surface.observer) return;
  surface.observer = new MutationObserver(() => {
    const covered = surface.root.classList.contains('field-menu-covered');
    if (covered !== !!surface.covered) {
      surface.covered = covered;
      if (covered) {
        const saved = surface.root.style.getPropertyValue('visibility');
        const priority = surface.root.style.getPropertyPriority('visibility');
        surface.root.style.setProperty('visibility', 'visible', 'important');
        surface.restoreVisibility = () => saved ? surface.root.style.setProperty('visibility', saved, priority) : surface.root.style.removeProperty('visibility');
        run(surface, false);
      } else {
        surface.restoreVisibility?.(); surface.restoreVisibility = undefined;
        enter(surface);
      }
      return;
    }
    if (surface.root.hasAttribute('data-surface-leaving')) {
      // showModal() can reopen the same dialog before its exit paint ends.
      if (surface.root.tagName === 'DIALOG' && (surface.root as HTMLDialogElement).open) enter(surface);
      return;
    }
    if (visible(surface.root) && !surface.shown) enter(surface);
  });
  surface.observer.observe(surface.root, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'] });
}

/** Keep the closing native surface painted, but release its modal/top-layer
 * behavior immediately. No cloned interactive menu or delayed logical close. */
function prepareNativeClose(surface: Surface) {
  if (!enabled(surface.root) || surface.cleanupNative) return;
  const { root } = surface;
  const rect = root.getBoundingClientRect();
  const props = ['display', 'position', 'inset', 'left', 'top', 'width', 'height', 'margin', 'z-index'] as const;
  const saved = props.map(prop => [prop, root.style.getPropertyValue(prop), root.style.getPropertyPriority(prop)] as const);
  let backdrop: HTMLDivElement | undefined;
  if (root.matches('dialog:modal')) {
    const style = getComputedStyle(root, '::backdrop');
    backdrop = document.createElement('div');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.inert = true;
    Object.assign(backdrop.style, { position: 'fixed', inset: '0', background: style.background, backdropFilter: style.backdropFilter, pointerEvents: 'none', zIndex: '9998' });
    document.body.append(backdrop);
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, fill: 'both' });
  }
  for (const [prop, value] of Object.entries({ display: 'block', position: 'fixed', inset: 'auto', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', 'z-index': '9999' })) root.style.setProperty(prop, value, 'important');
  surface.cleanupNative = () => {
    for (const [prop, value, priority] of saved) value ? root.style.setProperty(prop, value, priority) : root.style.removeProperty(prop);
    backdrop?.remove();
  };
}

export function closeSurfaceDialog(dialog: HTMLDialogElement | undefined) {
  if (!dialog?.open) return;
  const surface = getSurface(dialog);
  prepareNativeClose(surface);
  run(surface, false);
  dialog.close();
}

/** The directive supplies renderer removal hooks on the surface itself, so
 * exits also work when an owning component/Teleport is unmounted. v-show uses
 * the same hooks in persisted mode. Existing specialised Transitions keep
 * their own hooks (sidebar and assistant layout). */
export const vSurfaceMotion: ObjectDirective<HTMLElement, string | false> = {
  created(root, binding, vnode) {
    if (binding.value === false || vnode.transition) return;
    const surface = getSurface(root);
    surface.props = vnode.props;
    const persisted = vnode.dirs?.some(item => item.dir === vShow) ?? false;
    vnode.transition = {
      mode: undefined,
      persisted,
      beforeEnter: () => {},
      enter: () => enter(surface),
      leave: (_, remove) => {
        surface.removing = remove;
        run(surface, false, remove);
      },
      clone: () => vnode.transition!,
    };
  },
  mounted(root, binding, vnode) {
    const surface = surfaces.get(root);
    if (!surface) return;
    const owner = binding.instance?.$parent ?? root.ownerDocument;
    let parents = owners.get(owner);
    if (!parents) owners.set(owner, parents = new WeakMap());
    const parent = root.parentNode!;
    let registry = parents.get(parent);
    if (!registry) parents.set(parent, registry = new Map());
    surface.registry = registry;
    surface.key = `${binding.value}:${String(vnode.key ?? '')}`;
    observe(surface);
    if (root.hasAttribute('popover')) {
      root.addEventListener('beforetoggle', event => {
        if ((event as ToggleEvent).newState === 'closed') { prepareNativeClose(surface); run(surface, false); }
        else {
          surface.cleanupNative?.(); surface.cleanupNative = undefined;
          surface.shown = false; enter(surface);
        }
      });
    }
    if (visible(root)) enter(surface);
  },
  beforeUpdate(root, _binding, vnode, previous) {
    const surface = surfaces.get(root);
    if (!surface) return;
    surface.props = vnode.props;
    vnode.transition ??= previous.transition;
  },
  updated(root) {
    const surface = surfaces.get(root);
    if (surface && !surface.shown && visible(root) && !surface.flight) enter(surface);
  },
  beforeUnmount(root) {
    const surface = surfaces.get(root);
    surface?.observer?.disconnect();
  },
  unmounted(root) {
    const surface = surfaces.get(root);
    // Vue's unmounted hook runs before an asynchronous DOM leave completes.
    if (surface && !surface.removing) {
      finish(surface);
      if (surface.registry?.get(surface.key!) === surface) surface.registry.delete(surface.key!);
    }
  },
};

/** Imperative editor views keep the semantic hidden flag synchronous while
 * retaining only the closing paint. Calling this again reverses the flight. */
export function setSurfaceVisible(root: HTMLElement, show: boolean) {
  const surface = getSurface(root);
  if (show === !root.hidden && (surface.flight || surface.shown === show)) return;
  if (show) {
    root.hidden = false;
    surface.restoreDisplay?.(); surface.restoreDisplay = undefined;
    enter(surface);
  } else {
    const display = getComputedStyle(root).display;
    const saved = root.style.getPropertyValue('display'), priority = root.style.getPropertyPriority('display');
    if (display !== 'none' && enabled(root)) {
      root.style.setProperty('display', display, 'important');
      surface.restoreDisplay = () => saved ? root.style.setProperty('display', saved, priority) : root.style.removeProperty('display');
    }
    run(surface, false);
    root.hidden = true;
  }
}

export function removeSurface(root: HTMLElement) {
  const surface = getSurface(root);
  run(surface, false, () => root.remove());
}

export function showSurface(root: HTMLElement) { enter(getSurface(root)); }
