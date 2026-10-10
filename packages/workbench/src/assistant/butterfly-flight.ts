export interface FlightPoint { x: number; y: number }
export interface FlightViewport { width: number; height: number }

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const soften = (value: number) => { const t = clamp(value, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const flightDuration = (distance: number) => clamp(1500 + distance * 2.8, 1800, 5600);
export const landingDuration = 680;

/** Unwrap around the current angle so crossing -180/180 never turns the long way. */
export const shortestTurn = (from: number, to: number) => ((to - from + 180) % 360 + 360) % 360 - 180;

export function butterflyHeading(velocity: FlightPoint, previous: number): number {
  if (Math.hypot(velocity.x, velocity.y) < .5) return previous;
  // The artwork faces up and its SVG has a resting -6deg tilt. Compensate in the actor.
  const heading = Math.atan2(velocity.x, -velocity.y) * 180 / Math.PI + 6;
  return previous + shortestTurn(previous, heading);
}

export function steerButterflyHeading(current: number, heading: number, dt: number): number {
  const turn = shortestTurn(current, heading) * (1 - Math.exp(-dt / 25));
  const limit = 540 * dt / 1000;
  return current + clamp(turn, -limit, limit);
}

const pulse = (t: number, start: number, end: number) => soften((t - start) / .08) * (1 - soften((t - end) / .1));
/** Two relaxed glides between bursts of flapping; shared by travel speed and wing posture. */
export const flightEffort = (t: number) => 1 - .88 * Math.max(pulse(t, .24, .43), pulse(t, .61, .75));
const pacing = [0];
for (let i = 1; i <= 240; i++) {
  const t = (i - .5) / 240;
  pacing.push(pacing[i - 1]! + soften(t / .2) * soften((1 - t) / .24) * (.68 + .32 * flightEffort(t)));
}
function travelProgress(t: number) {
  const index = clamp(t, 0, 1) * 240, low = Math.min(239, Math.floor(index));
  return (pacing[low]! + (pacing[low + 1]! - pacing[low]!) * (index - low)) / pacing[240]!;
}

type Curve = [FlightPoint, FlightPoint, FlightPoint, FlightPoint];
export interface ButterflyRoute {
  from: FlightPoint; to: FlightPoint; viewport: FlightViewport; radius: number;
  curves: Curve[]; samples: { length: number; segment: number; t: number }[]; length: number; travelLength: number;
}
function bezier([from, a, b, to]: Curve, t: number): FlightPoint {
  const v = 1 - t;
  return { x: v ** 3 * from.x + 3 * v * v * t * a.x + 3 * v * t * t * b.x + t ** 3 * to.x,
    y: v ** 3 * from.y + 3 * v * v * t * a.y + 3 * v * t * t * b.y + t ** 3 * to.y };
}
function curvature([from, a, b, to]: Curve, t: number) {
  const v = 1 - t;
  const dx = 3 * (v * v * (a.x - from.x) + 2 * v * t * (b.x - a.x) + t * t * (to.x - b.x));
  const dy = 3 * (v * v * (a.y - from.y) + 2 * v * t * (b.y - a.y) + t * t * (to.y - b.y));
  const ddx = 6 * (v * (b.x - 2 * a.x + from.x) + t * (to.x - 2 * b.x + a.x));
  const ddy = 6 * (v * (b.y - 2 * a.y + from.y) + t * (to.y - 2 * b.y + a.y));
  return Math.abs(dx * ddy - dy * ddx) / Math.max(.00001, Math.hypot(dx, dy) ** 3);
}
const forward = (angle: number) => ({ x: Math.sin((angle - 6) * Math.PI / 180), y: -Math.cos((angle - 6) * Math.PI / 180) });

/** Broad connected curves: lift away, sweep, counter-turn, then approach in the resting direction. */
export function createButterflyRoute(from: FlightPoint, to: FlightPoint, viewport: FlightViewport, radius: number,
  departureAngle = 0, arrivalAngle = 0): ButterflyRoute {
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
  const nx = distance ? -dy / distance : 0, ny = distance ? dx / distance : 0;
  const bound = (p: FlightPoint, inset = 0) => ({ x: clamp(p.x, radius + inset, viewport.width - radius - inset),
    y: clamp(p.y, radius + inset, viewport.height - radius - inset) });
  const reach = Math.min(64, distance * .16, (viewport.height - radius * 2) * .12);
  const bow = Math.min(145, distance * .2, viewport.width * .22, viewport.height * .22);
  const facing = forward(arrivalAngle);
  let departure = forward(departureAngle);
  const side = to.x > viewport.width / 2 ? -1 : 1;
  const inset = Math.min(20, distance * .035);
  const points = [from,
    bound({ x: from.x + dx * .3 + nx * bow, y: from.y + dy * .3 + ny * bow }, inset),
    bound({ x: from.x + dx * .65 - nx * bow * .65, y: from.y + dy * .65 - ny * bow * .65 }, inset),
    bound({ x: to.x - facing.x * reach + side * reach * 1.15, y: to.y - facing.y * reach }, inset), to];
  const first = { x: points[1]!.x - from.x, y: points[1]!.y - from.y };
  const firstLength = Math.hypot(first.x, first.y) || 1;
  // A destination behind the resting pose needs a takeoff turn, not a tiny U-turn in the path.
  if ((first.x * departure.x + first.y * departure.y) / firstLength < .35)
    departure = { x: first.x / firstLength, y: first.y / firstLength };
  const handles = points.map((p, i) => {
    let x: number, y: number;
    if (i === 0) { const length = Math.min(64, distance * .16); x = departure.x * length; y = departure.y * length; }
    else if (i === points.length - 1) { x = facing.x * reach * .65; y = facing.y * reach * .65; }
    else {
      const before = points[i - 1]!, after = points[i + 1]!;
      const span = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      const length = Math.min(Math.hypot(p.x - before.x, p.y - before.y), Math.hypot(after.x - p.x, after.y - p.y)) * .42;
      x = (after.x - before.x) / span * length; y = (after.y - before.y) / span * length;
    }
    // Share one tangent on either side of each knot, including near viewport edges.
    let fit = 1;
    for (const sign of i === 0 ? [1] : i === points.length - 1 ? [-1] : [-1, 1]) {
      if (x * sign > 0) fit = Math.min(fit, (viewport.width - radius - p.x) / (x * sign));
      if (x * sign < 0) fit = Math.min(fit, (radius - p.x) / (x * sign));
      if (y * sign > 0) fit = Math.min(fit, (viewport.height - radius - p.y) / (y * sign));
      if (y * sign < 0) fit = Math.min(fit, (radius - p.y) / (y * sign));
    }
    return { x: x * Math.max(0, fit), y: y * Math.max(0, fit) };
  });
  const curves: Curve[] = points.slice(0, -1).map((p, i) => [p,
    { x: p.x + handles[i]!.x, y: p.y + handles[i]!.y },
    { x: points[i + 1]!.x - handles[i + 1]!.x, y: points[i + 1]!.y - handles[i + 1]!.y }, points[i + 1]!]);
  let length = 0, previous = from;
  const raw = [{ length: 0, segment: 0, t: 0, weight: 1 }];
  curves.forEach((curve, segment) => {
    for (let step = 1; step <= 48; step++) {
      const point = bezier(curve, step / 48);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      raw.push({ length, segment, t: step / 48, weight: Math.min(4, Math.sqrt(1 + (curvature(curve, step / 48) * 70) ** 2)) }); previous = point;
    }
  });
  // Slow into bends, then carry momentum out. Blur the curvature so speed stays continuous at joins.
  const weights = raw.map((_, i) => [1, 2, 3, 2, 1].reduce((sum, weight, j) =>
    sum + raw[clamp(i + j - 2, 0, raw.length - 1)]!.weight * weight, 0) / 9);
  let travelLength = 0;
  const samples = raw.map((sample, i) => {
    if (i) travelLength += (sample.length - raw[i - 1]!.length) * (weights[i]! + weights[i - 1]!) / 2;
    return { length: travelLength, segment: sample.segment, t: sample.t };
  });
  return { from, to, viewport, radius, curves, samples, length, travelLength };
}

/** Arc-length sampling avoids accelerating simply because one curve is longer than another. */
export function sampleButterflyRoute(route: ButterflyRoute, progress: number): FlightPoint {
  if (progress <= 0 || route.length < .001) return route.from;
  if (progress >= 1) return route.to;
  const length = travelProgress(progress) * route.travelLength;
  let low = 0, high = route.samples.length - 1;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (route.samples[middle]!.length < length) low = middle; else high = middle; }
  const a = route.samples[low]!, b = route.samples[high]!;
  const fraction = (length - a.length) / Math.max(.00001, b.length - a.length);
  const start = a.segment === b.segment ? a.t : 0;
  return bezier(route.curves[b.segment]!, start + (b.t - start) * fraction);
}

export const sampleButterflyFlight = (from: FlightPoint, to: FlightPoint, progress: number, viewport: FlightViewport, radius: number) =>
  sampleButterflyRoute(createButterflyRoute(from, to, viewport, radius), progress);
