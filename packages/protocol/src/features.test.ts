import { expect, it } from 'vitest';
import { createFeatureGate, defineFeatures, resolveFeatureChannel } from './features';

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
  [{ DEV: true, VITE_TANO_CHANNEL: '' }, 'dev'],
  [{ DEV: false, VITE_TANO_CHANNEL: 'dev' }, 'dev'],
  [{ DEV: false, VITE_TANO_CHANNEL: '' }, 'stable'],
  [{ DEV: false, VITE_TANO_CHANNEL: 'typo' }, 'stable'],
  [{}, 'stable'],
] as const)('resolves %o -> %s', (env, expected) => {
  expect(resolveFeatureChannel(env)).toBe(expected);
});
