import { expect, it } from 'vitest';
import { documentLinks } from '@tano/editor/document-links';
import type { FileEntry, WorkspaceRelation } from '@tano/protocol';
import { buildDocumentGraph } from './document-graph';

const file = (id: string, path: string): FileEntry => ({
  id,
  path,
  name: path,
  kind: 'file',
  size: 0,
  modified: 0,
});
it('joins all link types by stable file ID and deduplicates reciprocal and explicit relations', () => {
  const files = [
    file('aaaaaaaa', 'folder/Start.md'),
    file('bbbbbbbb', '目标.md'),
    file('cccccccc', 'Isolated.md'),
    file('dddddddd', 'asset.png'),
    file('eeeeeeee', '.tano/rules.md'),
  ];
  const relation: WorkspaceRelation = {
    id: 'rrrrrrrr',
    type: 'related',
    source: { type: 'document', id: 'aaaaaaaa' },
    target: { type: 'document', id: 'bbbbbbbb' },
  };
  const graph = buildDocumentGraph(
    files,
    new Map([
      [
        'aaaaaaaa',
        documentLinks(
          '[目标](../%E7%9B%AE%E6%A0%87.md#heading) [[目标|别名]] [引用](tano://document/bbbbbbbb) [[Start]] [图片](../asset.png) [[Missing]] [外部](https://example.com/目标.md)',
        ),
      ],
      ['bbbbbbbb', documentLinks('[[folder/Start]]')],
    ]),
    [relation],
  );
  expect(graph.nodes.map((node) => [node.id, node.degree])).toEqual([
    ['aaaaaaaa', 1],
    ['bbbbbbbb', 1],
    ['cccccccc', 0],
  ]);
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0]).toMatchObject({ source: 'aaaaaaaa', target: 'bbbbbbbb' });
  files[1].path = 'renamed.md';
  expect(buildDocumentGraph(files, new Map(), [relation]).edges).toEqual(graph.edges);
});

it('does not guess ambiguous wiki links or create nodes for missing, non-document or unsafe targets', () => {
  const files = [file('a', 'Start.md'), file('b', 'one/Page.md'), file('c', 'two/Page.md')];
  const links = documentLinks(
    '[[Page]] [escape](../outside.md) [remote](file:///Page.md) [object](tano://person/aaaaaaaa) [[.tano/rules]]',
  );
  const graph = buildDocumentGraph(files, new Map([['a', links]]), []);
  expect(graph.edges).toEqual([]);
  expect(graph.nodes).toHaveLength(3);
});

it('resolves object document references even after the target is renamed', () => {
  const files = [file('aaaaaa', 'Start.md'), file('bbbbbb', 'Renamed.md')];
  const graph = buildDocumentGraph(
    files,
    new Map([
      [
        'aaaaaa',
        documentLinks('[@Old name](object://document/bbbbbb) [Person](object://person/aaaaaa)'),
      ],
    ]),
    [],
  );
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0]).toMatchObject({ source: 'aaaaaa', target: 'bbbbbb' });
});
