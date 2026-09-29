import { describe, expect, it } from 'vitest';
import {
  relativeWorkspaceReference,
  resolveWorkspaceReference,
  safeRemoteImage,
} from './references';
describe('portable resource references', () => {
  it('round-trips nested paths, Chinese, spaces and literal URL delimiters', () => {
    for (const path of ['assets/图 片.png', 'assets/100%#figure.png', 'notes/images/a.jpg']) {
      const reference = relativeWorkspaceReference('notes/paper/draft.md', path);
      expect(resolveWorkspaceReference('notes/paper/draft.md', reference)).toBe(path);
    }
    expect(resolveWorkspaceReference('notes/a.md', '../assets/a.png?version=1')).toBe(
      'assets/a.png',
    );
  });
  it('rejects workspace escapes and executable or absolute URL forms', () => {
    for (const ref of [
      '../../secret.png',
      '%2e%2e/%2e%2e/secret.png',
      '/absolute.png',
      'C:/secret.png',
      '//host/image',
      'file:///secret',
      'javascript:alert(1)',
      '../.tano/config.json',
      '..%5csecret.png',
      '%ZZ',
    ]) {
      expect(resolveWorkspaceReference('notes/a.md', ref), ref).toBeNull();
    }
    expect(safeRemoteImage('https://example.com/a.png')).toBe('https://example.com/a.png');
    for (const ref of [
      'http://example.com/a',
      'data:image/svg+xml,<svg/>',
      'https://token@example.com/a',
      'javascript:x',
    ])
      expect(safeRemoteImage(ref)).toBeNull();
  });
});
