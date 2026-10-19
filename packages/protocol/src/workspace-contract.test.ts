import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileIdentity,
  fileRef,
  objectIdentity,
  parseWorkspaceView,
  viewIdentity,
  viewSources,
  workspaceViewPath,
} from './workspace-contract';
import { parseDataTable } from './data-tables';
import { parseObject } from './objects';
import { parseRelations } from './relations';

const file = { id: 'a1b2c3', path: 'papers/notes.md', name: 'notes.md', kind: 'file' as const, size: 10, modified: 42 };

describe('workspace contract v1', () => {
  it('uses stable IDs for files, objects and views', () => {
    expect(fileIdentity('workspace', file.id)).toBe('file://workspace/a1b2c3');
    expect(objectIdentity('workspace', 'event', 'd4e5f6')).toBe('object://workspace/event/d4e5f6');
    expect(viewIdentity('workspace', 'research')).toBe('view://workspace/research');
    expect(workspaceViewPath('research')).toBe('.tano/views/research.tano.json');
  });

  it('keeps a file revision and rejects path-based view sources', () => {
    const ref = fileRef('workspace', file, 'abc123');
    expect(ref).toMatchObject({ layer: 'file', fileId: 'a1b2c3', path: 'papers/notes.md', revision: { hash: 'abc123' } });
    const view = parseWorkspaceView(JSON.stringify({
      version: 1,
      layer: 'view',
      workspaceId: 'workspace',
      id: 'research',
      name: '研究工作台',
      kind: 'graph',
      sources: [
        { layer: 'file', fileId: 'a1b2c3' },
        { layer: 'object', type: 'event', id: 'd4e5f6' },
      ],
    }));
    expect(viewSources(view, [ref], [{ version: 1, layer: 'object', workspaceId: 'workspace', type: 'event', id: 'd4e5f6', path: '.tano/objects/d4e5f6.tano.json', revision: { hash: 'def456' } }])).toHaveLength(2);
    expect(viewSources(view, [ref, { ...ref, workspaceId: 'other', fileId: 'f6e5d4' }], [])).toHaveLength(1);
    expect(() => parseWorkspaceView(JSON.stringify({ ...view, sources: [{ layer: 'file', path: 'papers/notes.md' }] }))).toThrow();
  });

  it('ships a cross-format workspace whose manifest and view sources are consistent', () => {
    const root = join(process.cwd(), 'examples', 'workspaces', 'ai-research');
    const manifest = JSON.parse(readFileSync(join(root, '.tano', 'identities.json'), 'utf8')) as {
      workspaceId: string;
      files: { path: string; id: string; hash: string; deleted: boolean }[];
    };
    const entries = new Map(manifest.files.filter((entry) => !entry.deleted).map((entry) => [entry.path, entry]));
    for (const path of ['papers/research-note.md', 'papers/methods.pdf', 'assets/architecture.png', 'data/experiments.csv', 'data/metadata.json', 'code/train.py', 'data/experiments.table.json']) {
      const entry = entries.get(path);
      expect(entry, path).toBeTruthy();
      const bytes = readFileSync(join(root, path));
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(entry!.hash);
    }
    const view = parseWorkspaceView(readFileSync(join(root, '.tano', 'views', 'ai-research.tano.json'), 'utf8'));
    const object = parseObject(readFileSync(join(root, '.tano', 'objects', 'd4e5f6.tano.json'), 'utf8'));
    expect(parseDataTable(readFileSync(join(root, 'data', 'experiments.table.json'), 'utf8')).rows).toHaveLength(3);
    const relations = parseRelations(readFileSync(join(root, '.tano', 'relations.tano-relations.json'), 'utf8'));
    const fileRefs = [...entries.values()].map((entry) => ({ version: 1 as const, layer: 'file' as const, workspaceId: manifest.workspaceId, fileId: entry.id, path: entry.path, revision: { hash: entry.hash } }));
    const objectRef = { version: 1 as const, layer: 'object' as const, workspaceId: manifest.workspaceId, type: object.type, id: object.id, path: '.tano/objects/d4e5f6.tano.json', revision: { hash: entries.get('.tano/objects/d4e5f6.tano.json')!.hash } };
    expect(viewSources(view, fileRefs, [objectRef])).toHaveLength(view.sources.length);
    expect(relations.relations).toHaveLength(6);
  });
});
