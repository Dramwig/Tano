import { expect, it, vi } from 'vitest';
import { AutomationSubmissions } from './automation-submissions';
const id = '506d150f-b129-4be4-a027-96acb72f1987', version = '606d150f-b129-4be4-a027-96acb72f1987';
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
it('retains only the matching submission and isolates users, workspaces and task versions', () => {
  const disk = storage(), first = new AutomationSubmissions('owner', 'workspace', disk), key = first.begin(id, version);
  expect(new AutomationSubmissions('owner', 'workspace', disk).begin(id, version)).toBe(key);
  expect(new AutomationSubmissions('member', 'workspace', disk).pending(id, version)).toBeUndefined();
  expect(new AutomationSubmissions('owner', 'another', disk).pending(id, version)).toBeUndefined();
  const newer = first.begin(id, crypto.randomUUID()); first.clear(id, version, key);
  expect(newer).not.toBe(key); expect(first.pending(id, version)).toBeUndefined();
});
it('refuses a late retry beyond the safe receipt retention window until reviewed explicitly', () => {
  vi.useFakeTimers();
  try {
    const saved = new AutomationSubmissions('owner', 'workspace', storage()); saved.begin(id, version);
    vi.setSystemTime(Date.now() + 30 * 86400_000);
    expect(() => saved.begin(id, version)).toThrow('去重记录保留期限');
    saved.clear(id, version); expect(saved.begin(id, version)).toBeTruthy();
  } finally { vi.useRealTimers(); }
});
it('does not issue a new identity when persistent state cannot be trusted or saved', () => {
  const broken = new AutomationSubmissions('owner', 'workspace', { getItem: () => 'not-json', setItem: vi.fn() });
  expect(() => broken.begin(id, version)).toThrow();
  const full = new AutomationSubmissions('owner', 'workspace', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
  expect(() => full.begin(id, version)).toThrow('quota');
});
