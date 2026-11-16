import { afterEach, expect, it, vi } from 'vitest';
import { createFeatureGate, defineFeatures } from './features';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it('gates both statuses and rejects unknown and inherited IDs', () => {
  const definitions = defineFeatures({
    draft: { status: 'dev', note: 'Draft' },
    live: { status: 'stable', note: 'Live' },
  });
  expect(createFeatureGate(definitions, 'stable').isEnabled('draft')).toBe(false);
  expect(createFeatureGate(definitions, 'stable').isEnabled('live')).toBe(true);
  for (const id of ['draft', 'live'] as const)
    expect(createFeatureGate(definitions, 'dev').isEnabled(id)).toBe(true);
  for (const id of ['missing', 'toString'])
    expect(() => createFeatureGate(definitions, 'stable').isEnabled(id as 'draft')).toThrow(
      'Unknown feature',
    );
});
it.each([
  [true, '', 'dev'],
  [false, 'dev', 'dev'],
  [false, '', 'stable'],
  [false, 'typo', 'stable'],
] as const)('resolves DEV=%s channel=%s', async (dev, channel, expected) => {
  vi.stubEnv('DEV', dev);
  vi.stubEnv('VITE_TANO_CHANNEL', channel);
  expect((await import('./features')).featureChannel).toBe(expected);
});
