import { describe, expect, it } from 'vitest';
import {
  formatRemoteWorkspaceUri,
  isRemoteWorkspacePath,
  isValidRemoteHostId,
  normalizeRemotePosixPath,
  parseRemoteWorkspaceUri,
  remoteWorkspaceDisplayName,
} from './remote-workspace';

describe('remote-workspace URI helpers', () => {
  it('formats and parses canonical SSH workspace URIs', () => {
    const uri = formatRemoteWorkspaceUri('prod-gpu_01', '/home/ubuntu/projects/tano/');
    expect(uri).toBe('ssh://prod-gpu_01/home/ubuntu/projects/tano');
    expect(isRemoteWorkspacePath(uri)).toBe(true);
    expect(parseRemoteWorkspaceUri(uri)).toEqual({
      scheme: 'ssh',
      hostId: 'prod-gpu_01',
      remotePath: '/home/ubuntu/projects/tano',
    });
    expect(remoteWorkspaceDisplayName('/home/ubuntu/projects/tano/')).toBe('tano');
    expect(remoteWorkspaceDisplayName('/')).toBe('/');
  });

  it('rejects path traversal, relative paths, control chars, and invalid host ids', () => {
    expect(isValidRemoteHostId('..')).toBe(false);
    expect(isValidRemoteHostId('bad host')).toBe(false);
    expect(isValidRemoteHostId('dev.box-1')).toBe(true);

    for (const badPath of ['', 'relative/path', '/a/../b', '/a/./b', '/a\\b', '/a\0b', '/a\nb']) {
      expect(() => normalizeRemotePosixPath(badPath)).toThrow();
    }
    for (const badUri of [
      'C:\\Users\\demo',
      'ssh://',
      'ssh://host',
      'ssh://../home/user',
      'ssh://host/a/../b',
      'ssh://host/a\\b',
    ]) {
      expect(parseRemoteWorkspaceUri(badUri)).toBeNull();
    }
  });
});
