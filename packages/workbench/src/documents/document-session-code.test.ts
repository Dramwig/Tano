// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { conflictCopyPath, createDocumentSession, type OpenDocument } from './document-session';

describe('code file document session', () => {
  it('preserves file extensions when generating conflict copies', () => {
    expect(conflictCopyPath('guide.md', 'stamp')).toBe('guide.conflict-stamp.md');
    expect(conflictCopyPath('src/app.ts', 'stamp')).toBe('src/app.conflict-stamp.ts');
    expect(conflictCopyPath('config/settings.json', 'stamp')).toBe('config/settings.conflict-stamp.json');
    expect(conflictCopyPath('Makefile', 'stamp')).toBe('Makefile.conflict-stamp');
    expect(conflictCopyPath('docker/Dockerfile', 'stamp')).toBe('docker/Dockerfile.conflict-stamp');
  });

  it('cleanly three-way merges independent edits on code files', async () => {
    const created: Array<{ path: string; content: string }> = [];
    const session = createDocumentSession({
      adapter: {
        write: vi.fn(),
        create: vi.fn(async (path, content) => {
          created.push({ path, content });
        }),
        refresh: vi.fn(async () => ({ id: 'ws', name: 'ws', path: '/ws', files: [] })),
      },
      confirmCreation: vi.fn(async () => true),
      invalidate: vi.fn(),
      refreshed: vi.fn(),
      activity: vi.fn(),
      report: vi.fn(),
    });

    const base = 'line 1\nline 2\nline 3\nline 4\n';
    const doc: OpenDocument = {
      id: 'c1',
      path: 'src/server.ts',
      format: 'code',
      content: 'line 1 edited locally\nline 2\nline 3\nline 4\n',
      base: { content: base, hash: 'h0', modified: 1 },
      saving: false,
      missing: false,
    };

    await session.reconcile(doc, {
      content: 'line 1\nline 2\nline 3\nline 4 edited remotely\n',
      hash: 'h1',
      modified: 2,
    });

    expect(doc.conflict).toBeUndefined();
    expect(created).toHaveLength(0);
    expect(doc.content).toBe('line 1 edited locally\nline 2\nline 3\nline 4 edited remotely\n');
    expect(doc.base.hash).toBe('h1');
  });

  it('preserves an extension-matched conflict copy when edits overlap on a code file', async () => {
    const created: Array<{ path: string; content: string }> = [];
    const session = createDocumentSession({
      adapter: {
        write: vi.fn(),
        create: vi.fn(async (path, content) => {
          created.push({ path, content });
        }),
        refresh: vi.fn(async () => ({ id: 'ws', name: 'ws', path: '/ws', files: [] })),
      },
      confirmCreation: vi.fn(async () => true),
      invalidate: vi.fn(),
      refreshed: vi.fn(),
      activity: vi.fn(),
      report: vi.fn(),
    });

    const base = 'const port = 3000;\n';
    const doc: OpenDocument = {
      id: 'c2',
      path: 'src/config.ts',
      format: 'code',
      content: 'const port = 4000;\n',
      base: { content: base, hash: 'h0', modified: 1 },
      saving: false,
      missing: false,
    };

    await session.reconcile(doc, {
      content: 'const port = 5000;\n',
      hash: 'h1',
      modified: 2,
    });

    expect(doc.conflict).toBeDefined();
    expect(doc.conflict?.copyPath).toMatch(/^src\/config\.conflict-.+\.ts$/);
    expect(created).toHaveLength(1);
    expect(created[0].path).toBe(doc.conflict?.copyPath);
    expect(created[0].content).toBe('const port = 4000;\n');
  });
});
