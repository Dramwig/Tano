import { describe, expect, it } from 'vitest';
import { butterflyHeading, createButterflyRoute, flightDuration, flightEffort, sampleButterflyFlight, sampleButterflyRoute, shortestTurn, steerButterflyHeading } from './butterfly-flight';

describe('butterfly heading', () => {
  it('aligns the visible upward-facing artwork to velocity in every direction', () => {
    for (const velocity of [{ x: 0, y: -100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 },
      { x: 160, y: 120 }, { x: -120, y: -160 }]) {
      const angle = (butterflyHeading(velocity, 0) - 6) * Math.PI / 180;
      const length = Math.hypot(velocity.x, velocity.y);
      expect(Math.sin(angle)).toBeCloseTo(velocity.x / length, 6);
      expect(-Math.cos(angle)).toBeCloseTo(velocity.y / length, 6);
    }
  });
  it('turns across the angle boundary without a full spin and keeps its heading at rest', () => {
    expect(shortestTurn(179, -179)).toBe(2);
    expect(shortestTurn(-179, 179)).toBe(-2);
    expect(steerButterflyHeading(179, -179, 16)).toBeGreaterThan(179);
    expect(steerButterflyHeading(179, -179, 16)).toBeLessThan(181);
    expect(butterflyHeading({ x: 0, y: 0 }, 240)).toBe(240);
    expect(butterflyHeading({ x: .01, y: -.01 }, 240)).toBe(240);
    expect(Math.abs(steerButterflyHeading(0, 180, 16))).toBeLessThan(9);
  });
});

describe('butterfly trajectory', () => {
  it('takes longer for longer journeys, with a gentle bounded default speed', () => {
    expect(flightDuration(900)).toBeGreaterThan(flightDuration(200) * 1.6);
    expect(flightDuration(900)).toBeGreaterThan(3500);
    expect(flightDuration(0)).toBeGreaterThanOrEqual(1500);
    expect(flightDuration(5000)).toBeLessThanOrEqual(5600);
  });
  it('rests at both endpoints, bends in both directions and never jumps between frames', () => {
    const from = { x: 1100, y: 650 }, to = { x: 350, y: 100 }, viewport = { width: 1280, height: 720 };
    const distance = Math.hypot(to.x - from.x, to.y - from.y), duration = flightDuration(distance);
    const sample = (time: number) => sampleButterflyFlight(from, to, time / duration, viewport, 18);
    expect(sample(0)).toEqual(from); expect(sample(duration)).toEqual(to);
    expect(Math.hypot(sample(16).x - from.x, sample(16).y - from.y)).toBeLessThan(.1);
    expect(Math.hypot(sample(duration - 16).x - to.x, sample(duration - 16).y - to.y)).toBeLessThan(.1);
    let previous = from;
    const deviations: number[] = [];
    for (let time = 16; time < duration; time += 16) {
      const point = sample(time);
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(8);
      deviations.push(((point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x)) / distance);
      previous = point;
    }
    expect(Math.min(...deviations)).toBeLessThan(-12);
    expect(Math.max(...deviations)).toBeGreaterThan(12);
  });
  it('keeps near-edge, vertical and short journeys inside a narrow viewport', () => {
    const viewport = { width: 390, height: 844 };
    for (const [from, to] of [
      [{ x: 365, y: 805 }, { x: 365, y: 32 }],
      [{ x: 18, y: 30 }, { x: 372, y: 30 }],
      [{ x: 100, y: 100 }, { x: 102, y: 102 }],
    ]) for (let frame = 0; frame <= 200; frame++) {
      const point = sampleButterflyFlight(from!, to!, frame / 200, viewport, 18);
      expect(point.x).toBeGreaterThanOrEqual(18); expect(point.x).toBeLessThanOrEqual(372);
      expect(point.y).toBeGreaterThanOrEqual(18); expect(point.y).toBeLessThanOrEqual(826);
    }
  });
  it('turns into the resting heading before arrival and builds in two open-wing glides', () => {
    const route = createButterflyRoute({ x: 350, y: 150 }, { x: 1220, y: 655 }, { width: 1280, height: 720 }, 18);
    const before = sampleButterflyRoute(route, .98), end = sampleButterflyRoute(route, 1);
    const direction = Math.atan2(end.x - before.x, before.y - end.y) * 180 / Math.PI;
    expect(Math.abs(shortestTurn(direction, -6))).toBeLessThan(8);
    expect(route.travelLength).toBeGreaterThan(route.length);
    expect(flightEffort(.36)).toBeLessThan(.2); expect(flightEffort(.71)).toBeLessThan(.2);
    expect(flightEffort(.15)).toBeGreaterThan(.9); expect(flightEffort(.56)).toBeGreaterThan(.9);
  });
});
