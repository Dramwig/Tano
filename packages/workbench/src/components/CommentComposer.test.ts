// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';
import CommentComposer from './CommentComposer.vue';
import type { CommentMention } from '@tano/protocol';

let app: ReturnType<typeof createApp>;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); localStorage.clear(); });
it('selects a stable person identity when typing @ and drops removed mentions before submit', async () => {
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  useWorkspaceStore().objects = [{ path: '.tano/objects/a00001.tano.json', snapshot: { content: '', hash: 'hash', modified: 0 }, object: {
    version: 1, id: 'a00001', type: 'person', name: 'Alice', description: '', archived: false, properties: {},
  } }];
  const body = ref('');
  const submissions: CommentMention[][] = [];
  root = document.createElement('div'); document.body.append(root);
  app = createApp(defineComponent({ setup: () => () => h(CommentComposer, {
    modelValue: body.value, authorName: 'Bob', label: 'Comment',
    'onUpdate:modelValue': value => { body.value = value; }, onSubmit: mentions => submissions.push(mentions),
  }) }));
  app.use(pinia).mount(root);
  const input = root.querySelector('textarea')!;
  input.value = '@Al'; input.setSelectionRange(3, 3); input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(root.querySelector('.comment-people button')?.textContent).toContain('Alice');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick(); await nextTick();
  expect(body.value).toBe('@Alice ');
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(submissions[0]).toEqual([{ personId: 'a00001', text: '@Alice' }]);
  body.value = 'No mention'; await nextTick();
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(submissions[1]).toEqual([]);
});
