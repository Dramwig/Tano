// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import { createPinia } from 'pinia';
import * as headless from '@tano/editor/headless';
import { makeCommentAnchor } from '@tano/editor/comment-anchors';
import type { CommentAnchor } from '@tano/protocol';
import { DemoAdapter, sha256 } from '../adapter';
import { configureWorkbench } from '../runtime';
import { loadCommentFile, saveCommentChange } from '../workspace-comments';
import type { OpenDocument } from '../stores/workspace';
import DocumentComments from './DocumentComments.vue';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement;
afterEach(() => {
  app?.unmount(); app = undefined;
  root?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mountComments(basis?: CommentAnchor['basis']) {
  const create = headless.createHeadlessMarkdown;
  const parsed = vi.fn();
  const parser = vi.spyOn(headless, 'createHeadlessMarkdown').mockImplementation(async () => {
    const instance = await create();
    const project = instance.projectComments;
    vi.spyOn(instance, 'projectComments').mockImplementation(content => { parsed(content); return project(content); });
    return instance;
  });
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  const author = { id: 'reviewer', name: '审阅者' };
  const content = '正文';
  const hash = await sha256(content);
  const doc = reactive<OpenDocument>({ id: 'a0b1c2', path: '文章.md', content,
    base: { content, hash, modified: Date.now() }, saving: false, missing: false });
  await saveCommentChange(adapter, basis ? 'annotation' : 'discussion', doc.id, {
    type: 'start', id: 'thread-1', body: '核对正文', author,
    ...(basis ? { anchor: makeCommentAnchor(basis, content, [{ from: 0, to: 2, text: content }], hash) } : {}),
  });
  const annotations = vi.fn<(marks: { id: string; anchor: CommentAnchor }[]) => void>();
  const focusAnchor = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(DocumentComments, { workspaceId: 'demo', document: doc, readonly: false, author,
    captureSelection: () => {
      const from = doc.content.indexOf('正文');
      return { basis: basis ?? 'prose', text: doc.content, spans: [{ from, to: from + 2, text: '正文' }] };
    }, focusAnchor, geometry: () => null, onAnnotations: annotations });
  const component = app.use(pinia).mount(root) as unknown as InstanceType<typeof DocumentComments>;
  await expect.poll(() => root.querySelector('.discussion-loading')).toBeNull();
  return { adapter, doc, component, annotations, focusAnchor, parser, parsed,
    marks: () => annotations.mock.calls.at(-1)![0] };
}

it('does not initialize a parser or resend empty decorations for discussions, editing or switching documents', async () => {
  const { doc, parser, annotations } = await mountComments();
  expect(annotations).toHaveBeenCalledExactlyOnceWith([]);
  for (const content of ['正文一', '正文二', '# 正文三']) { doc.content = content; await nextTick(); }
  doc.base = { content: doc.content, hash: await sha256(doc.content), modified: Date.now() };
  doc.id = 'd0e1f2';
  await nextTick();
  await expect.poll(() => root.querySelector('.discussion-loading')).toBeNull();
  expect(parser).not.toHaveBeenCalled();
  expect(annotations).toHaveBeenCalledExactlyOnceWith([]);
});

it.each(['source', 'prose'] as const)('reuses %s projections, preserving every edit when deleting and retyping a quote', async basis => {
  const { adapter, doc, parser, parsed, marks, focusAnchor } = await mountComments(basis);
  await expect.poll(() => marks().length).toBe(1);
  expect(parsed).toHaveBeenCalledTimes(basis === 'prose' ? 1 : 0);
  window.dispatchEvent(new CustomEvent('tano:open-comment', {
    detail: { fileId: doc.id, threadId: 'thread-1', kind: 'annotation' },
  }));
  await expect.poll(() => focusAnchor.mock.calls.length).toBe(1);
  expect(parsed).toHaveBeenCalledTimes(basis === 'prose' ? 1 : 0);
  doc.content = '新增 正文';
  await expect.poll(() => marks()[0]?.anchor.spans[0]?.from).toBe(3);
  doc.content += ' 结尾';
  await expect.poll(() => marks()[0]?.anchor.suffix).toBe(' 结尾');
  expect(parsed).toHaveBeenCalledTimes(basis === 'prose' ? 3 : 0);
  // A net-zero edit must still detach: these are new characters, not survivors.
  doc.content = '';
  doc.content = '正文';
  await expect.poll(() => marks()).toEqual([]);
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', doc.id)).file.threads[0]?.detached).toBe(true);
  if (basis === 'source') expect(parser).not.toHaveBeenCalled();
});

it('starts tracking a new draft against the current text after unannotated edits', async () => {
  const { doc, component, parser, parsed, marks } = await mountComments();
  doc.content = '新增 正文';
  await nextTick();
  expect(parser).not.toHaveBeenCalled();
  await component.beginAnnotation();
  expect(marks()[0]?.anchor.spans[0]?.from).toBe(3);
  doc.content = '前言 新增 正文';
  await expect.poll(() => marks()[0]?.anchor.spans[0]?.from).toBe(6);
  expect(parsed).toHaveBeenCalledTimes(2);
  doc.content = '';
  doc.content = '前言 新增 正文';
  await expect.poll(() => marks()).toEqual([]);
  expect(root.textContent).toContain('选中的内容已删除');
});
