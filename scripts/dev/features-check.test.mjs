import { expect, it } from 'vitest';
import {
  parseDefinitions,
  scanReferences,
  compareReferences,
  unsafeChannel,
  formatDevFeatures,
  checkFeatures,
} from './features-check.mjs';
it('reads empty and literal registries and reports unfinished work', () => {
  expect(parseDefinitions('export const features = defineFeatures({});')).toEqual({});
  const defs = parseDefinitions(
    "export const features = defineFeatures({ draft: {status: 'dev', note: 'Draft'}, live: {status: 'stable', note: 'Live'} });",
  );
  expect(formatDevFeatures(defs)).toBe('- draft: Draft');
  expect(formatDevFeatures({})).toBe('- 无');
  expect(compareReferences(defs, ['draft', 'unknown'])).toEqual([
    'Unregistered feature: unknown',
    'Unused feature: live',
  ]);
});
it('scans literal calls and rejects release channel assignments', () => {
  expect(scanReferences(`isFeatureEnabled('one'); isFeatureEnabled("two");`)).toEqual([
    'one',
    'two',
  ]);
  for (const source of [
    'VITE_TANO_CHANNEL=dev',
    'VITE_TANO_CHANNEL: dev',
    '"VITE_TANO_CHANNEL": "dev"',
    'TANO_CHANNEL=dev',
  ])
    expect(unsafeChannel(source)).toBe(true);
  expect(unsafeChannel('VITE_TANO_CHANNEL=stable')).toBe(false);
});
it('checks the real empty registry', () => {
  expect(checkFeatures(process.cwd())).toEqual({});
});
