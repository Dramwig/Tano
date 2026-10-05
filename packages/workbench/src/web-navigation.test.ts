import { describe, expect, it } from 'vitest';
import { pageRoutePath, parsePageRoute } from './web-navigation';

describe('web page navigation', () => {
  it('parses workspace and file identities', () => {
    expect(parsePageRoute('/p/workspace/file')).toEqual({ workspaceId: 'workspace', fileId: 'file' });
  });

  it('encodes and decodes each URL segment', () => {
    const path = pageRoutePath('workspace/id', 'file?name');
    expect(path).toBe('/p/workspace%2Fid/file%3Fname');
    expect(parsePageRoute(path)).toEqual({ workspaceId: 'workspace/id', fileId: 'file?name' });
  });

  it('accepts one trailing slash and rejects malformed paths', () => {
    expect(parsePageRoute('/p/workspace/file/')).toEqual({ workspaceId: 'workspace', fileId: 'file' });
    expect(parsePageRoute('/p/workspace/file/extra')).toBeNull();
    expect(parsePageRoute('/p/workspace/%')).toBeNull();
    expect(parsePageRoute('/workspace/file')).toBeNull();
  });
});
