// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { DemoAdapter, sha256 } from '../adapter';
import { configureWorkbench } from '../runtime';
import { loadCommentFile, saveCommentChange } from '../workspace-comments';
import type { OpenDocument } from '../stores/workspace';
import DocumentComments from './DocumentComments.vue';
import { makeCommentAnchor } from '@tano/editor/comment-anchors';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement | undefined;
afterEach(async () => {
  app?.unmount();
  root?.remove();
  app = undefined;
  root = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
  await nextTick();
});

it('uses the space beside centered prose for annotations and keeps the reply draft when switching to a popup', async () => {
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  const author = { id: 'reviewer', name: '审阅者' };
  const content = '正文';
  const hash = await sha256(content);
  const openDocument = reactive<OpenDocument>({
    id: 'a0b1c2', path: '文章.md', content,
    base: { content, hash, modified: Date.now() }, saving: false, missing: false,
  });
  const anchor = makeCommentAnchor('prose', content, [{ from: 0, to: 2, text: content }], hash);
  for (const id of ['thread-1', 'thread-2']) {
    await saveCommentChange(adapter, 'annotation', openDocument.id, { type: 'start', id, body: `${id} 首条评论`, author, anchor });
  }
  for (let index = 1; index <= 4; index++) {
    await saveCommentChange(adapter, 'annotation', openDocument.id, {
      type: 'reply', threadId: 'thread-1', id: `reply-000${index}`, body: `回复 ${index}`, author,
    });
  }
  let paneWidth = 1600;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.closest('.is-expanded') ? 280 : 120;
  });
  root = document.createElement('div');
  document.body.append(root);
  const focusAnchor = vi.fn();
  app = createApp(defineComponent(() => () => h('main', { class: 'document-main' }, h(DocumentComments, {
    workspaceId: 'demo', document: openDocument, readonly: false, author,
    captureSelection: () => null, focusAnchor,
    geometry: () => ({ left: (paneWidth - 780) / 2, right: (paneWidth + 780) / 2, blocks: [
      { key: 'first', ids: ['thread-1'], top: 100, bottom: 140 },
      { key: 'second', ids: ['thread-2'], top: 130, bottom: 170 },
      { key: 'third', ids: ['thread-1'], top: 200, bottom: 240 },
    ] }),
  }))));
  app.use(pinia).mount(root);
  root.querySelector('main')!.getBoundingClientRect = () => new DOMRect(0, 0, paneWidth, 900);
  await expect.poll(() => root!.querySelectorAll('.annotation-card').length).toBe(2);
  expect(root.querySelector('.annotation-count')).toBeNull();
  expect(root.querySelector('.annotation-popup')).toBeNull();
  const first = root.querySelector<HTMLElement>('.annotation-card')!;
  const second = root.querySelectorAll<HTMLElement>('.annotation-card')[1]!;
  const messages = first.querySelectorAll<HTMLElement>('.comment-message');
  expect([...messages].filter(message => message.style.display !== 'none').map(message => message.querySelector('p')?.textContent))
    .toEqual(['thread-1 首条评论', '回复 4']);
  expect(first.querySelector('.comment-expand-replies')?.textContent).toBe('查看 3 条回复');
  await expect.poll(() => parseFloat(second.style.top)).toBeGreaterThanOrEqual(parseFloat(first.style.top) + first.offsetHeight);
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await nextTick();
  window.dispatchEvent(new Event('resize'));
  await expect.poll(() => parseFloat(second.style.top)).toBeGreaterThanOrEqual(parseFloat(first.style.top) + first.offsetHeight);
  expect([...messages].every(message => message.style.display !== 'none')).toBe(true);
  expect(focusAnchor).toHaveBeenCalledWith(anchor);
  const reply = first.querySelector<HTMLTextAreaElement>('[aria-label="添加回复"]')!;
  reply.value = '切换布局仍保留的草稿';
  reply.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  paneWidth = 1400;
  window.dispatchEvent(new Event('resize'));
  await expect.poll(() => root!.querySelector('.annotation-popup')).toBeTruthy();
  expect(root.querySelectorAll('.annotation-count')).toHaveLength(3);
  expect(root.querySelector<HTMLTextAreaElement>('.annotation-popup [aria-label="添加回复"]')).toBe(reply);
  expect(reply.value).toBe('切换布局仍保留的草稿');
  paneWidth = 1600;
  window.dispatchEvent(new Event('resize'));
  await expect.poll(() => root!.querySelectorAll('.annotation-card').length).toBe(2);
  expect(root.querySelector<HTMLTextAreaElement>('.annotation-card [aria-label="添加回复"]')).toBe(reply);
  root.querySelector('main')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  expect(root.querySelectorAll('.annotation-card')).toHaveLength(2);
  expect(first.querySelector<HTMLElement>('.comment-reply-composer')?.style.display).toBe('none');
  first.click();
  await nextTick();
  expect(reply.value).toBe('切换布局仍保留的草稿');
});

it('groups annotations on the same row after creation and opens the clicked thread without toggling or losing replies', async () => {
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  const author = { id: 'reviewer', name: '审阅者' };
  const content = '列表、引用、表格，分隔线、行内样式\n其他段落';
  const hash = await sha256(content);
  const openDocument = reactive<OpenDocument>({
    id: 'a0b1c2', path: '文章.md', content,
    base: { content, hash, modified: Date.now() }, saving: false, missing: false,
  });
  const span = (text: string) => ({ from: content.indexOf(text), to: content.indexOf(text) + text.length, text });
  await saveCommentChange(adapter, 'annotation', openDocument.id, {
    type: 'start', id: 'thread-1', body: '第一部分的批注', author,
    anchor: makeCommentAnchor('prose', content, [span('列表、引用、表格')], hash),
  });
  await saveCommentChange(adapter, 'annotation', openDocument.id, {
    type: 'start', id: 'other-row', body: '其他段落的批注', author,
    anchor: makeCommentAnchor('prose', content, [span('其他段落')], hash),
  });
  root = document.createElement('div');
  document.body.append(root);
  const editorElement = document.createElement('div');
  const comments = ref<InstanceType<typeof DocumentComments>>();
  app = createApp(defineComponent(() => () => h('main', { class: 'document-main' }, h(DocumentComments, {
    ref: comments, workspaceId: 'demo', document: openDocument, readonly: false, author, editorElement,
    captureSelection: () => ({ basis: 'prose' as const, text: content, spans: [span('分隔线、行内样式')] }),
    focusAnchor: () => {},
    geometry: (anchors = []) => ({ left: 100, right: 700, blocks: [
      { key: 'first', ids: anchors.filter(anchor => anchor.id !== 'other-row').map(anchor => anchor.id), top: 100, bottom: 140 },
      { key: 'other', ids: ['other-row'], top: 200, bottom: 240 },
    ] }),
  }))));
  app.use(pinia).mount(root);
  const main = root.querySelector('main')!;
  main.append(editorElement);
  main.getBoundingClientRect = () => new DOMRect(0, 0, 800, 900);
  await expect.poll(() => root!.querySelectorAll('.annotation-count').length).toBe(2);
  await comments.value!.beginAnnotation();
  const draft = root.querySelector<HTMLTextAreaElement>('[aria-label="添加批注"]')!;
  draft.value = '第二部分的批注';
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="发表添加批注"]')!.click();
  await expect.poll(() => root!.querySelectorAll('.annotation-popup .annotation-thread').length).toBe(2);
  const threads = [...root.querySelectorAll<HTMLElement>('.annotation-popup .annotation-thread')];
  expect(threads.map(thread => thread.querySelector('.comment-quote')?.textContent)).toEqual(['列表、引用、表格', '分隔线、行内样式']);
  expect(root.querySelector('.annotation-popup')?.textContent).not.toContain('其他段落的批注');
  const reply = threads[0]!.querySelector<HTMLTextAreaElement>('[aria-label="添加回复"]')!;
  reply.value = '保留第一部分的回复草稿';
  reply.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const popup = root.querySelector<HTMLElement>('.annotation-popup')!;
  const scroll = popup.querySelector<HTMLElement>('.annotation-popup-content')!;
  scroll.getBoundingClientRect = () => new DOMRect(0, 100, 520, 320);
  threads.forEach((thread, index) => {
    thread.getBoundingClientRect = () => new DOMRect(0, 100 + index * 260 - scroll.scrollTop, 520, 260);
  });
  const clickMark = async (index: number) => {
    const mark = document.createElement('span');
    mark.dataset.commentId = threads[index]!.querySelector<HTMLElement>('[data-comment-thread]')!.dataset.commentThread;
    editorElement.replaceChildren(mark);
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 120 }));
    await nextTick();
    await nextTick();
  };
  await clickMark(1);
  expect(scroll.scrollTop).toBe(260);
  expect(popup.style.display).not.toBe('none');
  await clickMark(0);
  expect(scroll.scrollTop).toBe(0);
  expect(popup.style.display).not.toBe('none');
  expect(root.querySelectorAll('.annotation-popup .annotation-thread')).toHaveLength(2);
  expect(threads[0]!.querySelector('textarea')).toBe(reply);
  expect(reply.value).toBe('保留第一部分的回复草稿');
  root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
  await nextTick();
  expect(popup.style.display).toBe('none');
  await clickMark(0);
  expect(popup.style.display).not.toBe('none');
  expect(reply.value).toBe('保留第一部分的回复草稿');
  threads[0]!.querySelector<HTMLButtonElement>('[aria-label="完成批注"]')!.click();
  await expect.poll(() => root!.querySelectorAll('.annotation-popup .annotation-thread').length).toBe(1);
  expect(popup.textContent).toContain('第二部分的批注');
});

it('uses one bottom composer for discussions and replies, preserving drafts on cancellation and failed saves', async () => {
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  const author = { id: 'reviewer', name: '审阅者' };
  const content = '正文';
  const openDocument = reactive<OpenDocument>({
    id: 'a0b1c2', path: '文章.md', content,
    base: { content, hash: await sha256(content), modified: Date.now() },
    saving: false, missing: false,
  });
  for (const [id, body] of [['thread-1', '第一个讨论'], ['thread-2', '第二个讨论']]) {
    await saveCommentChange(adapter, 'discussion', openDocument.id, { type: 'start', id: id!, body: body!, author });
  }
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(DocumentComments, {
    workspaceId: 'demo', document: openDocument, readonly: false, author,
    captureSelection: () => null, focusAnchor: () => {}, geometry: () => null,
  });
  app.use(pinia).mount(root);
  await expect.poll(() => root!.querySelectorAll('.comment-conversation').length).toBe(2);
  const field = root.querySelector<HTMLTextAreaElement>('.document-discussion-compose textarea')!;
  const write = async (value: string) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  const replyTo = async (index: number) => {
    root!.querySelectorAll<HTMLButtonElement>('.document-discussion-messages [aria-label="回复评论"]')[index]!.click();
    await nextTick();
    await nextTick();
  };
  const submit = () => root!.querySelector<HTMLButtonElement>('.document-discussion-compose .comment-send')!.click();

  await write('保留草稿');
  await replyTo(0);
  expect(root.querySelectorAll('textarea')).toHaveLength(1);
  expect(root.querySelector('textarea')).toBe(field);
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('保留草稿');
  expect(field.getAttribute('aria-label')).toBe('回复评论');
  expect(root.querySelector('.discussion-reply-target')?.textContent).toContain('第一个讨论');
  root.querySelector<HTMLButtonElement>('[aria-label="取消回复"]')!.click();
  await nextTick();
  expect(field.getAttribute('aria-label')).toBe('添加评论');
  expect(field.value).toBe('保留草稿');

  await replyTo(0);
  await replyTo(1);
  expect(root.querySelector('.discussion-reply-target')?.textContent).toContain('第二个讨论');
  const writeFile = vi.spyOn(adapter, 'write').mockRejectedValueOnce(new Error('保存失败'));
  submit();
  await expect.poll(() => root!.querySelector('[role="alert"]')?.textContent).toBe('保存失败');
  expect(field.value).toBe('保留草稿');
  expect(field.getAttribute('aria-label')).toBe('回复评论');
  writeFile.mockRestore();
  submit();
  await expect.poll(() => field.getAttribute('aria-label')).toBe('添加评论');
  expect(field.value).toBe('');
  expect(root.querySelectorAll('textarea')).toHaveLength(1);
  let file = (await loadCommentFile(adapter, 'discussion', openDocument.id)).file;
  expect(file.threads.map(thread => thread.messages.length)).toEqual([1, 2]);
  expect(file.threads[1]?.messages[1]?.body).toBe('保留草稿');
  expect(file.threads[1]?.messages[1]?.replyTo).toBe(file.threads[1]?.messages[0]?.id);
  expect(root.querySelector('.comment-reply-reference')?.textContent).toContain('回复 审阅者：');
  expect(root.querySelector('.comment-reply-reference')?.textContent).toContain('第二个讨论');

  await write('新的讨论');
  submit();
  await expect.poll(async () => (await loadCommentFile(adapter, 'discussion', openDocument.id)).file.threads.length).toBe(3);
  await expect.poll(() => field.value).toBe('');
  await replyTo(0);
  await write('目标被删除时保留');
  file = (await loadCommentFile(adapter, 'discussion', openDocument.id)).file;
  const target = file.threads[0]!;
  await saveCommentChange(adapter, 'discussion', openDocument.id, {
    type: 'delete', threadId: target.id, messageId: target.messages[0]!.id,
    expectedBody: target.messages[0]!.body, authorId: author.id,
    expectedMessages: target.messages.map(message => ({ id: message.id, body: message.body })),
  });
  submit();
  await expect.poll(() => root!.querySelector('[role="alert"]')?.textContent).toContain('评论已被移除');
  expect(field.value).toBe('目标被删除时保留');
  expect(field.getAttribute('aria-label')).toBe('回复评论');
  expect((await loadCommentFile(adapter, 'discussion', openDocument.id)).file.threads).toHaveLength(2);

  openDocument.id = 'd0e1f2';
  await nextTick();
  expect(field.value).toBe('');
  expect(field.getAttribute('aria-label')).toBe('添加评论');
  expect(root.querySelector('.discussion-reply-target')).toBeNull();
});

it('creates, replies to, resolves and detaches local annotations independently of document discussions', async () => {
  localStorage.clear();
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  const content = '正文';
  const openDocument = reactive<OpenDocument>({
    id: 'a0b1c2', path: '文章.md', content,
    base: { content, hash: await sha256(content), modified: Date.now() },
    saving: false, missing: false,
  });
  root = document.createElement('div');
  document.body.append(root);
  const marks: string[][] = [];
  const readonly = ref(false);
  const comments = ref<InstanceType<typeof DocumentComments>>();
  app = createApp(defineComponent(() => () => h('main', { class: 'document-main' }, [
    h('button', { class: 'annotation-create-button', onClick: () => comments.value?.beginAnnotation() }, '添加批注'),
    h(DocumentComments, {
    ref: comments,
    workspaceId: 'demo', document: openDocument, readonly: readonly.value,
    author: { id: 'reviewer', name: '审阅者' },
    captureSelection: () => ({ basis: 'prose' as const, text: content,
      spans: [{ from: 0, to: 2, text: content }] }),
    focusAnchor: () => {},
    geometry: (anchors = []) => ({ left: 100, right: 700,
      blocks: anchors.length ? [{ key: 'first', ids: anchors.map(anchor => anchor.id), top: 100, bottom: 140 }] : [] }),
    onAnnotations: value => marks.push(value.map(item => item.id)),
  })])));
  app.use(pinia);
  app.mount(root);
  root.querySelector('main')!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 900);
  await expect.poll(() => root!.textContent?.includes('文档讨论')).toBe(true);
  const click = (label: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
    expect(button, label).toBeTruthy();
    button!.click();
  };
  const write = (label: string, value: string) => {
    const field = root!.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  click('添加批注');
  await expect.poll(() => root!.querySelector('[aria-label="添加批注"]')).toBeTruthy();
  expect(marks.at(-1)).toEqual(['@draft']);
  write('添加批注', '这里需要核对');
  await nextTick();
  root.querySelector('main')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  expect(root.querySelector<HTMLElement>('.annotation-popup')?.style.display).toBe('none');
  expect(marks.at(-1)).toEqual(['@draft']);
  click('添加批注');
  await expect.poll(() => root!.querySelector<HTMLTextAreaElement>('[aria-label="添加批注"]')?.value).toBe('这里需要核对');
  root.querySelector<HTMLButtonElement>('[aria-label="发表添加批注"]')!.click();
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', openDocument.id)).file.threads.length).toBe(1);
  expect(marks.at(-1)).toHaveLength(1);
  expect(marks.at(-1)).not.toContain('@draft');
  await expect.poll(() => root!.querySelector('.annotation-count')?.textContent?.trim()).toBe('1');
  const popup = root.querySelector<HTMLElement>('.annotation-popup')!;
  expect(popup.style.left).toBe('140px');
  expect(popup.style.top).toBe('148px');
  expect(root.querySelector('.document-comments')).toBeNull();
  expect(root.querySelector('[aria-label="关闭批注"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
  await nextTick();
  expect(root.querySelector<HTMLElement>('.annotation-popup')?.style.display).toBe('none');
  root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
  await nextTick();
  write('添加回复', '已核对');
  await nextTick();
  root.querySelector('main')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  expect(root.querySelector<HTMLElement>('.annotation-popup')?.style.display).toBe('none');
  root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
  await nextTick();
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="添加回复"]')?.value).toBe('已核对');
  root.querySelector<HTMLButtonElement>('[aria-label="发表添加回复"]')!.click();
  await expect.poll(() => root!.querySelector('.annotation-count')?.textContent?.trim()).toBe('2');
  expect((await loadCommentFile(adapter, 'annotation', openDocument.id)).file.threads[0]?.messages).toHaveLength(2);
  await expect.poll(() => root!.querySelector<HTMLTextAreaElement>('[aria-label="添加回复"]')?.value).toBe('');
  readonly.value = true;
  await nextTick();
  expect(root.querySelectorAll('textarea')).toHaveLength(0);
  expect(root.querySelector('button[title="完成批注"]')).toBeNull();
  expect(root.querySelector('.annotation-count')?.textContent?.trim()).toBe('2');
  await comments.value?.beginAnnotation();
  expect(root.querySelector('[aria-label="添加批注"]')).toBeNull();
  readonly.value = false;
  await nextTick();
  write('添加评论', '整体方案可行');
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="发表添加评论"]')!.click();
  await expect.poll(async () => (await loadCommentFile(adapter, 'discussion', openDocument.id)).file.threads.length).toBe(1);
  expect((await loadCommentFile(adapter, 'annotation', openDocument.id)).file.threads[0]?.anchor).toBeDefined();
  expect((await loadCommentFile(adapter, 'discussion', openDocument.id)).file.threads[0]?.anchor).toBeUndefined();
  if (!root.querySelector('.annotation-popup')) {
    root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
    await nextTick();
  }
  root.querySelector<HTMLButtonElement>('.annotation-popup [aria-label="更多评论操作"]')!.click();
  await nextTick();
  click('编辑');
  await nextTick();
  write('编辑评论', '这里已经核对');
  await nextTick();
  click('确认编辑');
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', openDocument.id))
    .file.threads[0]?.messages[0]?.body).toBe('这里已经核对');
  await expect.poll(() => root!.querySelector('[aria-label="编辑评论"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('.annotation-popup .is-reply [aria-label="更多评论操作"]')!.click();
  await nextTick();
  click('删除');
  await nextTick();
  click('确认删除');
  await expect.poll(() => root!.querySelector('.annotation-count')?.textContent?.trim()).toBe('1');
  root.querySelector<HTMLButtonElement>('.document-discussion-messages [aria-label="更多评论操作"]')!.click();
  await nextTick();
  click('编辑');
  await nextTick();
  write('编辑评论', '整体方案已经确认');
  await nextTick();
  click('确认编辑');
  await expect.poll(() => root!.textContent?.includes('整体方案已经确认')).toBe(true);
  root.querySelector<HTMLButtonElement>('.annotation-count')!.click();
  await nextTick();
  click('完成批注');
  await expect.poll(() => root!.querySelector('.annotation-count')).toBeNull();
  expect(root.querySelector('.annotation-popup')).toBeNull();
  expect(marks.at(-1)).toEqual([]);
  const savedAnnotation = (await loadCommentFile(adapter, 'annotation', openDocument.id)).file.threads[0]!;
  expect(savedAnnotation.resolved).toBe(true);
  expect(savedAnnotation.messages[0]?.body).toBe('这里已经核对');
  expect(root.querySelector('.resolved-annotations')).toBeNull();
  expect(root.textContent).not.toContain('已解决的批注');
  openDocument.content = '';
  await expect.poll(() => marks.at(-1)?.length).toBe(0);
  openDocument.base = { content: '', hash: await sha256(''), modified: Date.now() };
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', openDocument.id))
    .file.threads[0]?.detached).toBe(true);
  openDocument.content = content;
  openDocument.base = { content, hash: await sha256(content), modified: Date.now() };
  await nextTick();
  expect(root.querySelector('.annotation-count')).toBeNull();
  expect(root.textContent).toContain('整体方案已经确认');
  click('添加批注');
  await expect.poll(() => root!.querySelector('[aria-label="添加批注"]')).toBeTruthy();
  write('添加批注', '再次核对');
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="发表添加批注"]')!.click();
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', openDocument.id))
    .file.threads.length).toBe(2);
  openDocument.content = '';
  openDocument.content = content;
  await expect.poll(async () => (await loadCommentFile(adapter, 'annotation', openDocument.id))
    .file.threads[1]?.detached).toBe(true);
  await expect.poll(() => root!.querySelector('.annotation-count')).toBeNull();
  root.querySelector<HTMLButtonElement>('.document-discussion-messages [aria-label="更多评论操作"]')!.click();
  await nextTick();
  click('删除');
  await nextTick();
  click('确认删除');
  await expect.poll(async () => (await loadCommentFile(adapter, 'discussion', openDocument.id)).file.threads).toEqual([]);
});
