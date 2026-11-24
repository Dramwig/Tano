import { describe, expect, it } from 'vitest';
import { pageRoutePath, pageRouteUrl, parsePageRoute } from './web-navigation';

describe('web page navigation', () => {
  it('parses workspace and file identities', () => {
    expect(parsePageRoute('/p/workspace/file')).toEqual({ workspaceId: 'workspace', fileId: 'file' });
  });

  it('encodes and decodes each URL segment', () => {
    const path = pageRoutePath('workspace/id', 'file?name');
    expect(path).toBe('/p/workspace%2Fid/file%3Fname');
    expect(parsePageRoute(path)).toEqual({ workspaceId: 'workspace/id', fileId: 'file?name' });
  });

  it('builds a shareable URL while preserving the current origin and query', () => {
    expect(pageRouteUrl('https://tano.example/app?session=abc#heading', 'workspace/id', 'file?name'))
      .toBe('https://tano.example/p/workspace%2Fid/file%3Fname?session=abc');
  });

  it('preserves the namespace of plugin tabs in browser history and reload links', () => {
    const path = pageRoutePath('workspace', 'plugin:test:board');
    expect(path).toBe('/p/workspace/plugin%3Atest%3Aboard');
    expect(parsePageRoute(path)).toEqual({ workspaceId: 'workspace', fileId: 'plugin:test:board' });
  });

  it('accepts one trailing slash and rejects malformed paths', () => {
    expect(parsePageRoute('/p/workspace/file/')).toEqual({ workspaceId: 'workspace', fileId: 'file' });
    expect(parsePageRoute('/p/workspace/file/extra')).toBeNull();
    expect(parsePageRoute('/p/workspace/%')).toBeNull();
    expect(parsePageRoute('/workspace/file')).toBeNull();
  });
});
