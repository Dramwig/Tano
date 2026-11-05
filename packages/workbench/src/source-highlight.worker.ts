import { IncrementalSourceHighlighter } from '@tano/editor/source-highlight';
import type { SourceHighlightWorkerRequest } from './source-highlight-parser';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<SourceHighlightWorkerRequest>) => void;
  postMessage: (value: unknown) => void;
};
const parser = new IncrementalSourceHighlighter();
let revision = 0;
let text = '';
worker.onmessage = ({ data }) => {
  if (data.text !== undefined) {
    text = data.text;
  } else {
    if (data.baseId !== revision || !data.changes) throw new Error('Source highlight revision mismatch');
    const parts: string[] = [];
    let position = 0;
    for (const change of data.changes) {
      parts.push(text.slice(position, change.from), change.insert);
      position = change.to;
    }
    parts.push(text.slice(position));
    text = parts.join('');
  }
  const update = parser.updatePatch(text, data.features, data.baseId === revision ? data.changes : undefined,
    data.highlightBaseId !== revision);
  revision = data.id;
  worker.postMessage({ id: data.id, update });
};
