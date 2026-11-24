import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@tano/protocol';
import { resolveWikiLink } from './wiki-links';

function file(path: string): FileEntry {
  return { id: path, path, name: path.split('/').at(-1)!, kind: 'file', size: 0, modified: 0 };
}

describe('forward wiki link resolution', () => {
  const files = [
    file('00-Inbox/README.md'),
    file('10-Journal/Plan.md'),
    file('Projects/Plan.md'),
    file('Projects/Notes/Meeting.md'),
  ];

  it('opens a unique page by title or an explicit workspace path', () => {
    expect(resolveWikiLink(files, '00-Inbox/README.md', 'Meeting')).toEqual({
      file: files[3],
      heading: '',
    });
    expect(resolveWikiLink(files, '00-Inbox/README.md', 'Projects/Plan#下一步')).toEqual({
      file: files[2],
      heading: '下一步',
    });
  });

  it('uses a nearby page first and refuses ambiguous titles', () => {
    expect(resolveWikiLink(files, 'Projects/Notes/Meeting.md', 'Plan')).toEqual({
      file: files[2],
      heading: '',
    });
    expect(resolveWikiLink(files, '00-Inbox/README.md', 'Plan')).toEqual({ error: 'ambiguous' });
  });
});
