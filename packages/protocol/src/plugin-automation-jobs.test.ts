import { describe, expect, it } from 'vitest';
import { parsePluginAutomationJob } from './plugin-automations';

const input = { pluginId: 'daily-report', automationId: 'daily', integrity: 'a'.repeat(64),
  label: '工作区日报', enabled: true, intervalMinutes: 1440, payload: { folder: '日报' } };
describe('automation administration inputs', () => {
  it('accepts bounded intervals and manual-only jobs with a precise optimistic version', () => {
    expect(parsePluginAutomationJob(input)).toEqual(input);
    expect(parsePluginAutomationJob({ ...input, expectedRuleHash: 'b'.repeat(64) }).expectedRuleHash).toBe('b'.repeat(64));
    expect(parsePluginAutomationJob({ ...input, intervalMinutes: null, payload: undefined,
      version: 'de305d54-75b4-431b-adb2-eb6b9e546014' })).toMatchObject({ intervalMinutes: null, payload: null });
    for (const intervalMinutes of [15, 43200]) expect(parsePluginAutomationJob({ ...input, intervalMinutes }).intervalMinutes).toBe(intervalMinutes);
  });
  it('rejects embedded authorization, invalid versions, unbounded schedules and oversized payloads', () => {
    for (const change of [{ userId: 'owner' }, { permissions: ['documents.write'] }, { version: '-'.repeat(36) },
      { intervalMinutes: 0 }, { intervalMinutes: 14 }, { intervalMinutes: 15.5 }, { intervalMinutes: 43201 },
      { intervalMinutes: undefined }, { enabled: 1 }, { payload: 'x'.repeat(16385) }, { expectedRuleHash: 'wrong' }]) {
      expect(() => parsePluginAutomationJob({ ...input, ...change })).toThrow();
    }
  });
});
