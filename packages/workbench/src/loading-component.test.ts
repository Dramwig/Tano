// @vitest-environment jsdom
import { createApp, defineComponent, h, type Component } from 'vue';
import { expect, it } from 'vitest';
import { loadingComponent } from './loading-component';

it('resolves nested regions independently without replacing already mounted content', async () => {
  let resolveParent!: (component: Component) => void;
  let resolveChild!: (component: Component) => void;
  const Child = loadingComponent(() => new Promise<Component>(resolve => { resolveChild = resolve; }));
  const Parent = loadingComponent(() => new Promise<Component>(resolve => { resolveParent = resolve; }), 'document');
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h('main', [h('button', '已加载的导航'), h(Parent)]) });
  app.mount(root);
  try {
    const navigation = root.querySelector('button');
    expect(root.querySelector('.loading-skeleton-document')).not.toBeNull();
    resolveParent(defineComponent({ render: () => h('article', [h('h1', '已加载的文档'), h(Child)]) }));
    await expect.poll(() => root.querySelector('h1')?.textContent).toBe('已加载的文档');
    expect(root.querySelector('.loading-skeleton-document')).toBeNull();
    expect(root.querySelector('.loading-skeleton-list')).not.toBeNull();
    const heading = root.querySelector('h1');
    resolveChild(defineComponent({ render: () => h('p', '已加载的讨论') }));
    await expect.poll(() => root.querySelector('p')?.textContent).toBe('已加载的讨论');
    expect(root.querySelector('.loading-skeleton')).toBeNull();
    expect(root.querySelector('h1')).toBe(heading);
    expect(root.querySelector('button')).toBe(navigation);
  } finally { app.unmount(); root.remove(); }
});
