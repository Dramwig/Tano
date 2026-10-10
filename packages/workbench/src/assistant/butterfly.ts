import { readonly, shallowReactive } from 'vue';
import { butterflyHeading, createButterflyRoute, flightDuration, flightEffort, landingDuration, sampleButterflyRoute, shortestTurn, soften, steerButterflyHeading, type ButterflyRoute } from './butterfly-flight';

export type ButterflyPhase = 'docked' | 'flying' | 'hovering' | 'landing' | 'perched' | 'returning';
export interface ButterflyRect { left: number; top: number; right: number; bottom: number }
export interface ButterflyPlacement {
  edge?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  align?: number;
  gap?: number;
  angle?: number;
}
export interface ButterflyTarget {
  id: string;
  scope: string;
  label: string;
  kind?: 'home' | 'component' | 'text';
  element: () => Element | null | undefined;
  rects?: () => readonly ButterflyRect[];
  placement?: ButterflyPlacement;
  available?: () => boolean;
  temporary?: boolean;
  onDispose?: () => void;
}
export interface ButterflyRegistration { update(target: ButterflyTarget): void; dispose(): void }
export type ButterflyFlightResult = 'arrived' | 'cancelled' | 'unavailable';
export interface ButterflyFlightOptions { duration?: number; hoverMs?: number }
export interface ButterflyEnvironment {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  viewport(): { width: number; height: number };
  measure(target: ButterflyTarget): ButterflyRect | null;
}
export const butterflyScope = (workspaceId: string, paneId: string, fileId: string) => JSON.stringify([workspaceId, paneId, fileId]);

/** Fresh geometry, including scroll clipping and overlays. No workspace data is mutated. */
export function measureButterflyTarget(target: ButterflyTarget): ButterflyRect | null {
  const element = target.element();
  if (!element?.isConnected || target.available?.() === false) return null;
  const doc = element.ownerDocument, win = doc.defaultView;
  if (!win) return null;
  let clip = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
    if (node !== element && /(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
      const box = node.getBoundingClientRect();
      clip = { left: Math.max(clip.left, box.left), top: Math.max(clip.top, box.top),
        right: Math.min(clip.right, box.right), bottom: Math.min(clip.bottom, box.bottom) };
    }
  }
  for (const rect of target.rects?.() ?? Array.from(element.getClientRects())) {
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) continue;
    const visible = { left: Math.max(clip.left, rect.left), top: Math.max(clip.top, rect.top),
      right: Math.min(clip.right, rect.right), bottom: Math.min(clip.bottom, rect.bottom) };
    if (visible.right <= visible.left || visible.bottom <= visible.top) continue;
    const hit = doc.elementFromPoint?.((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
    if (hit && !element.contains(hit)) continue;
    return visible;
  }
  return null;
}

export function butterflyLandingPoint(rect: ButterflyRect, placement: ButterflyPlacement = {}, size = 36,
  viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const align = Math.max(0, Math.min(1, placement.align ?? .5));
  const reach = size / 2 + (placement.gap ?? -4);
  let x = rect.left + (rect.right - rect.left) * align;
  let y = rect.top - reach;
  if ((!placement.edge || placement.edge === 'top') && y < size / 2) y = rect.bottom + reach;
  switch (placement.edge) {
    case 'center': x = (rect.left + rect.right) / 2; y = (rect.top + rect.bottom) / 2; break;
    case 'bottom': y = rect.bottom + reach; break;
    case 'left': x = rect.left - reach; y = rect.top + (rect.bottom - rect.top) * align; break;
    case 'right': x = rect.right + reach; y = rect.top + (rect.bottom - rect.top) * align; break;
  }
  return { x: Math.max(size / 2, Math.min(viewport.width - size / 2, x)),
    y: Math.max(size / 2, Math.min(viewport.height - size / 2, y)), angle: placement.angle ?? 0 };
}

export function createButterflyController(overrides: Partial<ButterflyEnvironment> = {}) {
  const env: ButterflyEnvironment = {
    now: () => performance.now(), requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id), viewport: () => ({ width: innerWidth, height: innerHeight }),
    measure: measureButterflyTarget, ...overrides,
  };
  const state = shallowReactive({ phase: 'docked' as ButterflyPhase, visible: false, targetId: '', homeId: '',
    scope: '', enabled: false, x: 0, y: 0, angle: 0, bank: 0, pitch: 0, scale: 1,
    wingLeft: .99, wingRight: .99, size: 36, reducedMotion: false, revision: 0 });
  const targets = new Map<string, { target: ButterflyTarget; owner: symbol }>();
  let frame: number | undefined;
  let disposed = false;
  let lastMeasurement = -Infinity;
  let wingClock = 0;
  let motion: { start: number; last: number; duration: number; hoverMs: number; from: { x: number; y: number };
    end: { x: number; y: number }; wings: { left: number; right: number }; returning: boolean; arrivalAngle?: number;
    route: ButterflyRoute; departureAngle: number; restingAngle: number } | undefined;
  let settle: ((result: ButterflyFlightResult) => void) | undefined;
  function targetRect(target: ButterflyTarget) {
    if (target.scope !== state.scope) return null;
    try { return env.measure(target); } catch { return null; }
  }
  function home() { return [...targets.values()].map(entry => entry.target).find(target => target.kind === 'home' && targetRect(target)); }
  function clearFrame() { if (frame !== undefined) env.cancelFrame(frame); frame = undefined; }
  function releaseTemporary(except = '') {
    for (const [id, entry] of targets) if (entry.target.temporary && id !== except) {
      targets.delete(id); entry.target.onDispose?.(); state.revision++;
    }
  }
  function finish(result: ButterflyFlightResult) { const complete = settle; settle = undefined; complete?.(result); }
  function cancel() {
    clearFrame(); motion = undefined; finish('cancelled');
    state.visible = false; state.phase = 'docked'; state.targetId = ''; state.homeId = '';
    releaseTemporary();
  }
  function queue() { if (!disposed && frame === undefined && state.visible) frame = env.requestFrame(tick); }
  function arrive() {
    state.bank = state.pitch = 0; state.scale = 1;
    if (motion?.returning) {
      motion = undefined; state.visible = false; state.phase = 'docked'; state.targetId = ''; state.homeId = '';
      finish('arrived'); releaseTemporary();
    } else { motion = undefined; state.phase = 'perched'; finish('arrived'); }
  }
  function tick() {
    frame = undefined;
    if (disposed || !state.enabled || !state.visible) return;
    if (!motion && env.now() - lastMeasurement < 32) { queue(); return; }
    lastMeasurement = env.now();
    state.size = env.viewport().width <= 700 ? 32 : 36;
    const target = targets.get(state.targetId)?.target;
    const rect = target && targetRect(target);
    if (!target || !rect) {
      finish('unavailable');
      if (motion?.returning || !home()) cancel(); else void returnHome();
      return;
    }
    const end = butterflyLandingPoint(rect, target.placement, state.size, env.viewport());
    if (!motion) { Object.assign(state, end); queue(); return; }
    const now = env.now(), elapsed = now - motion.start;
    if (state.reducedMotion) { Object.assign(state, end); arrive(); queue(); return; }
    const dt = Math.max(1, Math.min(64, now - motion.last)); motion.last = now;
    const follow = 1 - Math.exp(-dt / 90);
    motion.end.x += (end.x - motion.end.x) * follow; motion.end.y += (end.y - motion.end.y) * follow;
    const destination = motion.end;
    const approach = { x: destination.x, y: Math.max(state.size / 2, destination.y - 12) };
    const viewport = env.viewport();
    if (Math.hypot(motion.route.to.x - approach.x, motion.route.to.y - approach.y) > .5 || motion.route.radius !== state.size / 2
      || motion.route.viewport.width !== viewport.width || motion.route.viewport.height !== viewport.height || motion.restingAngle !== end.angle) {
      motion.route = createButterflyRoute(motion.from, approach, viewport, state.size / 2, motion.departureAngle, end.angle);
      motion.restingAngle = end.angle;
    }
    const t = Math.max(0, Math.min(1, elapsed / motion.duration));
    const landing = Math.max(0, elapsed - motion.duration - motion.hoverMs);
    const settling = soften(landing / landingDuration);
    const previous = { x: state.x, y: state.y };
    if (t < 1) {
      Object.assign(state, sampleButterflyRoute(motion.route, t));
    } else if (elapsed < motion.duration + motion.hoverMs + landingDuration) {
      if (!motion.returning) state.phase = elapsed < motion.duration + motion.hoverMs ? 'hovering' : 'landing';
      const hover = motion.hoverMs ? Math.min(1, (elapsed - motion.duration) / motion.hoverMs) : 1;
      const float = Math.sin(Math.PI * hover) ** 2;
      const room = Math.max(0, Math.min(3, approach.x - state.size / 2, env.viewport().width - state.size / 2 - approach.x));
      state.x = destination.x + Math.sin(hover * Math.PI * 2) * room * float;
      state.y = approach.y + (destination.y - approach.y) * settling + 2 * float;
    } else { Object.assign(state, end); arrive(); queue(); return; }
    // One clock drives both wings through the entire flight, including the soft landing.
    const vx = (state.x - previous.x) / dt * 1000, vy = (state.y - previous.y) / dt * 1000;
    const speed = Math.hypot(vx, vy);
    const effort = flightEffort(t);
    wingClock += dt / 1000 * Math.PI * 2 * (2.25 + effort * 1.05 + Math.min(.35, speed / 900));
    const power = soften(elapsed / 380) * (1 - settling);
    const previousAngle = state.angle;
    if (t < 1) {
      let velocity = { x: vx, y: vy };
      if (speed < .5 && t < .1) {
        // Turn into the initial tangent while takeoff speed is still almost zero.
        const next = sampleButterflyRoute(motion.route, Math.min(1, t + .02));
        const length = Math.hypot(next.x - state.x, next.y - state.y) || 1;
        velocity = { x: (next.x - state.x) / length, y: (next.y - state.y) / length };
      }
      state.angle = steerButterflyHeading(state.angle, butterflyHeading(velocity, state.angle), dt);
    } else {
      // Once travel has stopped, turn from the arrival heading into the resting pose.
      // Ignore the tiny hovering drift so it cannot make the butterfly spin in place.
      motion.arrivalAngle ??= state.angle;
      const rest = soften((elapsed - motion.duration) / (motion.hoverMs + landingDuration));
      state.angle = motion.arrivalAngle + shortestTurn(motion.arrivalAngle, end.angle) * rest;
    }
    // Banking changes depth/wing span, never the heading that follows the path.
    const turnRate = shortestTurn(previousAngle, state.angle) / dt * 1000;
    const bank = t < 1 ? Math.max(-26, Math.min(26, -turnRate * .22)) * power : 0;
    state.bank += (bank - state.bank) * (1 - Math.exp(-dt / 150));
    state.pitch = (4 + effort * 9) * power;
    state.scale = 1 + .035 * power;
    const resting = motion.returning ? .99 : .84;
    const fold = (phase: number) => {
      const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
      return cycle < .36 ? soften(cycle / .36) : 1 - soften((cycle - .36) / .64);
    };
    const amplitude = (.58 + .04 * Math.sin(elapsed / 620)) * effort;
    const asymmetry = state.bank / 26 * .045;
    const left = Math.min(1, .99 - amplitude * fold(wingClock) - asymmetry);
    const right = Math.min(1, .99 - amplitude * fold(wingClock + .10 * Math.sin(wingClock / 3)) + asymmetry);
    state.wingLeft = (motion.wings.left + (resting - motion.wings.left) * settling) * (1 - power) + left * power;
    state.wingRight = (motion.wings.right + (resting - motion.wings.right) * settling) * (1 - power) + right * power;
    queue();
  }
  function start(target: ButterflyTarget, options: ButterflyFlightOptions, returning: boolean): Promise<ButterflyFlightResult> {
    const base = home();
    if (disposed || !state.enabled || !targetRect(target) || (!state.visible && !base)) {
      if (target.temporary && targets.get(target.id)?.target === target) {
        targets.delete(target.id); target.onDispose?.(); state.revision++;
      }
      return Promise.resolve('unavailable');
    }
    finish('cancelled'); clearFrame();
    if (!state.visible && base) {
      state.size = env.viewport().width <= 700 ? 32 : 36;
      Object.assign(state, butterflyLandingPoint(targetRect(base)!, { edge: 'center' }, state.size, env.viewport()));
      state.wingLeft = state.wingRight = .99;
      state.bank = state.pitch = 0; state.scale = 1;
    }
    state.homeId = base?.id ?? state.homeId;
    state.targetId = target.id; state.visible = true; state.phase = returning ? 'returning' : 'flying';
    const destination = butterflyLandingPoint(targetRect(target)!, target.placement, state.size, env.viewport());
    const route = createButterflyRoute({ x: state.x, y: state.y }, { x: destination.x, y: Math.max(state.size / 2, destination.y - 12) },
      env.viewport(), state.size / 2, state.angle, destination.angle);
    motion = { start: env.now(), last: env.now(), duration: Math.max(200, Math.min(8000, options.duration ?? flightDuration(route.travelLength))),
      hoverMs: Math.max(0, Math.min(3000, options.hoverMs ?? (returning ? 160 : 460))), from: { x: state.x, y: state.y },
      end: destination, wings: { left: state.wingLeft, right: state.wingRight }, returning,
      route, departureAngle: state.angle, restingAngle: destination.angle };
    releaseTemporary(target.id);
    const promise = new Promise<ButterflyFlightResult>(resolve => { settle = resolve; });
    if (state.reducedMotion) tick(); else queue();
    return promise;
  }
  function flyTo(id: string, options: ButterflyFlightOptions = {}) {
    const target = targets.get(id)?.target;
    return target ? start(target, options, target.kind === 'home') : Promise.resolve<ButterflyFlightResult>('unavailable');
  }
  function returnHome() {
    const target = home();
    if (!target) { cancel(); return Promise.resolve<ButterflyFlightResult>('unavailable'); }
    if (!state.visible) return Promise.resolve<ButterflyFlightResult>('arrived');
    return start(target, {}, true);
  }
  function registerTarget(target: ButterflyTarget): ButterflyRegistration {
    if (disposed) { target.onDispose?.(); return { update() {}, dispose() {} }; }
    const owner = Symbol(target.id), id = target.id;
    targets.get(id)?.target.onDispose?.();
    targets.set(id, { target, owner }); state.revision++;
    return {
      update(next) {
        if (targets.get(id)?.owner !== owner || next.id !== id) return;
        const previous = targets.get(id)!.target;
        targets.set(id, { target: next, owner });
        if (previous.scope !== next.scope || previous.label !== next.label || previous.kind !== next.kind) state.revision++;
      },
      dispose() {
        const entry = targets.get(id);
        if (entry?.owner !== owner) return;
        targets.delete(id); entry.target.onDispose?.(); state.revision++;
        if (state.targetId === id && state.visible) { finish('unavailable'); void returnHome(); }
      },
    };
  }
  function setContext(scope: string, enabled = true) {
    if (scope !== state.scope || !enabled) cancel();
    state.scope = scope; state.enabled = enabled;
  }
  function dispose() {
    cancel(); disposed = true;
    for (const entry of targets.values()) entry.target.onDispose?.();
    targets.clear();
  }
  return { state: readonly(state), registerTarget, flyTo, returnHome, cancel, setContext, dispose,
    setReducedMotion(value: boolean) { state.reducedMotion = value; },
    listTargets(scope = state.scope) { void state.revision; return [...targets.values()].map(entry => entry.target)
      .filter(target => target.scope === scope && target.kind !== 'home' && !target.temporary); },
  };
}
export type ButterflyController = ReturnType<typeof createButterflyController>;
