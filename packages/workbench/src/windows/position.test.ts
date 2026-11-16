import { expect, it } from 'vitest';
import { centeredSettingsPosition, detachedWindowPosition } from './position';

it('keeps the centered window inside the monitor work area near an edge', () => {
  expect(centeredSettingsPosition(
    { position: { x: 1900, y: 600 }, size: { width: 1000, height: 800 } },
    { width: 1080, height: 780 },
    { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
  )).toEqual({ x: 840, y: 300 });
});

it('places the new window under the release point on a scaled second monitor', () => {
  const position = detachedWindowPosition(
    { x: 3200, y: 540, grabX: 80, grabY: 18 },
    2,
    1100,
    760,
    { position: { x: 1920, y: 0 }, size: { width: 3840, height: 2160 } },
  );
  expect(position).toEqual({ x: 1520, y: 252 });
});

it('keeps the independent window visible when released near a monitor edge', () => {
  const position = detachedWindowPosition(
    { x: 1850, y: 1020, grabX: 80, grabY: 18 },
    1,
    1100,
    760,
    { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  );
  expect(position).toEqual({ x: 1400, y: 940 });
});
