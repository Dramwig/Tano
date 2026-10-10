import { describe, expect, it, vi } from 'vitest';
import { butterflyLandingPoint, createButterflyController, type ButterflyRect, type ButterflyTarget } from './butterfly';
import { createButterflyRoute, flightDuration } from './butterfly-flight';

function setup() {
  let time = 0, next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const rects = new Map<string, ButterflyRect>();
  const controller = createButterflyController({ now: () => time,
    requestFrame: callback => { frames.set(++next, callback); return next; }, cancelFrame: id => { frames.delete(id); },
    viewport: () => ({ width: 1000, height: 800 }), measure: target => target.available?.() === false ? null : rects.get(target.id) ?? null,
  });
  controller.setContext('doc-a');
  function target(id: string, options: Partial<ButterflyTarget> = {}) {
    rects.set(id, { left: 300, top: 200, right: 400, bottom: 220 });
    return controller.registerTarget({ id, scope: 'doc-a', label: id, element: () => null, ...options });
  }
  target('home', { kind: 'home', placement: { edge: 'center' } });
  rects.set('home', { left: 900, top: 700, right: 954, bottom: 754 });
  function advance(ms = 7500) {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      time += 16;
      const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(time));
    }
  }
  return { controller, target, rects, frames, advance };
}

describe('butterfly flight lifecycle', () => {
  it('flies outside the home, hovers, lands and tracks a moving component before returning', async () => {
    const { controller: c, target, rects, frames, advance } = setup(); target('breadcrumb');
    const flight = c.flyTo('breadcrumb', { duration: 1100, hoverMs: 300 });
    expect(c.state.phase).toBe('flying'); expect(c.state.homeId).toBe('home');
    advance(1150); expect(c.state.phase).toBe('hovering');
    advance(300); expect(c.state.phase).toBe('landing');
    advance(700); expect(await flight).toBe('arrived'); expect(c.state.phase).toBe('perched');
    rects.set('breadcrumb', { left: 400, top: 250, right: 500, bottom: 270 });
    advance(32); expect(c.state.x).toBe(450); expect(c.state.y).toBe(236);
    const back = c.returnHome(); advance(); expect(await back).toBe('arrived');
    expect(c.state.visible).toBe(false); expect(frames.size).toBe(0);
  });
  it('cancels an interrupted flight and only finishes the latest target', async () => {
    const { controller: c, target, advance } = setup(); target('a'); target('b');
    const first = c.flyTo('a'); advance(160); const second = c.flyTo('b');
    expect(await first).toBe('cancelled'); advance(); expect(await second).toBe('arrived');
    expect(c.state.targetId).toBe('b'); c.dispose();
  });
  it('faces the actual travel direction on both outbound and downward return flights, then rests without snapping', async () => {
    const { controller: c, target, advance } = setup(); target('a', { placement: { angle: 24 } });
    const flight = c.flyTo('a');
    function checkJourney(travelMs: number) {
      let movingFrames = 0, maxTurn = 0, previous = { x: c.state.x, y: c.state.y, angle: c.state.angle };
      for (let frame = 0; frame < 520 && c.state.visible; frame++) {
        advance(16);
        const dx = c.state.x - previous.x, dy = c.state.y - previous.y, distance = Math.hypot(dx, dy);
        const turn = ((c.state.angle - previous.angle + 540) % 360) - 180;
        maxTurn = Math.max(maxTurn, Math.abs(turn));
        if (distance > .8 && (frame + 1) * 16 < travelMs) {
          const heading = (c.state.angle - 6) * Math.PI / 180;
          expect((dx * Math.sin(heading) - dy * Math.cos(heading)) / distance, JSON.stringify({ frame, x: c.state.x, y: c.state.y, dx, dy, angle: c.state.angle })).toBeGreaterThan(.985);
          movingFrames++;
        }
        previous = { x: c.state.x, y: c.state.y, angle: c.state.angle };
      }
      expect(movingFrames).toBeGreaterThan(50); expect(maxTurn).toBeLessThan(10);
    }
    const outbound = createButterflyRoute({ x: 927, y: 727 }, { x: 350, y: 174 }, { width: 1000, height: 800 }, 36 / 2, 0, 24);
    checkJourney(flightDuration(outbound.travelLength)); expect(await flight).toBe('arrived'); expect(c.state.angle).toBe(24);
    const inbound = createButterflyRoute({ x: 350, y: 186 }, { x: 927, y: 715 }, { width: 1000, height: 800 }, 36 / 2, 24, 0);
    const back = c.returnHome(); checkJourney(flightDuration(inbound.travelLength)); expect(await back).toBe('arrived');
    expect(c.state.angle).toBe(0); c.dispose();
  });
  it('preserves position and wing pose when redirected, then closes the wings gradually before perching', async () => {
    const { controller: c, target, advance } = setup(); target('a'); target('b');
    const first = c.flyTo('a'); advance(800);
    const before = { x: c.state.x, y: c.state.y, left: c.state.wingLeft, right: c.state.wingRight };
    const second = c.flyTo('b', { duration: 1100, hoverMs: 300 });
    expect(await first).toBe('cancelled');
    expect({ x: c.state.x, y: c.state.y, left: c.state.wingLeft, right: c.state.wingRight }).toEqual(before);
    advance(16); expect(Math.hypot(c.state.x - before.x, c.state.y - before.y)).toBeLessThan(1);
    expect(Math.abs(c.state.wingLeft - before.left)).toBeLessThan(.01);
    advance(2000); expect(c.state.phase).toBe('landing');
    expect(c.state.wingLeft).toBeCloseTo(.84, 2);
    const landingY = c.state.y; advance(120); expect(await second).toBe('arrived');
    expect(Math.abs(c.state.y - landingY)).toBeLessThan(.3); c.dispose();
  });
  it('returns when a target is removed or becomes hidden', async () => {
    const { controller: c, target, rects, advance } = setup();
    const registration = target('a'); const flight = c.flyTo('a'); advance(100); registration.dispose();
    expect(await flight).toBe('unavailable'); advance(); expect(c.state.phase).toBe('docked');
    target('b'); void c.flyTo('b'); advance(); rects.delete('b'); advance();
    expect(c.state.phase).toBe('docked'); c.dispose();
  });
  it('isolates document/pane scopes and cancels on context changes', async () => {
    const { controller: c, target, frames } = setup(); target('a'); target('other', { scope: 'doc-b' });
    expect(await c.flyTo('other')).toBe('unavailable');
    const flight = c.flyTo('a'); c.setContext('doc-b');
    expect(await flight).toBe('cancelled'); expect(c.state.visible).toBe(false); expect(frames.size).toBe(0);
    expect(c.listTargets().map(t => t.id)).toEqual(['other']); c.dispose();
  });
  it('switches directly to a stationary perch under reduced motion', async () => {
    const { controller: c, target, advance } = setup(); target('a'); c.setReducedMotion(true);
    expect(await c.flyTo('a')).toBe('arrived'); expect(c.state.phase).toBe('perched');
    expect(await c.returnHome()).toBe('arrived'); expect(c.state.phase).toBe('docked');
    c.setReducedMotion(false); const flight = c.flyTo('a'); c.setReducedMotion(true); advance(16);
    expect(await flight).toBe('arrived'); c.dispose();
  });
  it('releases temporary text anchors exactly once and disposes pending work', async () => {
    const { controller: c, target, frames } = setup(); const release = vi.fn();
    const registration = target('text', { temporary: true, kind: 'text', onDispose: release });
    const flight = c.flyTo('text'); c.dispose(); registration.dispose();
    expect(await flight).toBe('cancelled'); expect(release).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
  });
  it('does not let stale registrations remove a replacement target', async () => {
    const { controller: c, target, advance } = setup(); const stale = target('button'); target('button'); stale.dispose();
    const flight = c.flyTo('button'); advance(); expect(await flight).toBe('arrived'); c.dispose();
  });
  it('releases an unavailable temporary target without interrupting the current perch', async () => {
    const { controller: c, target, rects, advance } = setup(); target('button');
    const flight = c.flyTo('button'); advance(); await flight;
    const release = vi.fn(); target('missing-text', { temporary: true, onDispose: release }); rects.delete('missing-text');
    expect(await c.flyTo('missing-text')).toBe('unavailable'); expect(release).toHaveBeenCalledOnce();
    expect(c.state.targetId).toBe('button'); expect(c.state.phase).toBe('perched'); c.dispose();
  });
  it('rejects resources registered after disposal without starting another frame', () => {
    const { controller: c, target, frames } = setup(); c.dispose();
    const release = vi.fn(); const late = target('late', { onDispose: release }); late.dispose();
    expect(release).toHaveBeenCalledOnce(); expect(c.listTargets()).toEqual([]); expect(frames.size).toBe(0);
  });
});

it('places topbar targets below their edge when there is no room above and clamps to the viewport', () => {
  expect(butterflyLandingPoint({ left: 20, top: 4, right: 60, bottom: 30 }, {}, 36, { width: 100, height: 100 }))
    .toEqual({ x: 40, y: 44, angle: 0 });
  expect(butterflyLandingPoint({ left: 96, top: 40, right: 110, bottom: 60 }, { edge: 'right' }, 36, { width: 100, height: 100 }).x).toBe(82);
});
