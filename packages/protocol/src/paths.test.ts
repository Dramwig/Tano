import { describe, expect, it } from 'vitest';
import { pathKey, validatePath } from './index';

describe('workspace path identity', () => {
  it('folds case and Unicode compatibility aliases consistently', () => {
    expect(pathKey('Research/Straße/K.md')).toBe(pathKey('research/STRASSE/k.md'));
    expect(pathKey('notes/ﬃ.md')).toBe(pathKey('NOTES/FFI.md'));
  });

  it('still requires user supplied paths to be NFC and relative', () => {
    expect(validatePath('e\u0301.md')).toContain('NFC');
    expect(validatePath('notes/ok.md')).toBeNull();
  });
});
