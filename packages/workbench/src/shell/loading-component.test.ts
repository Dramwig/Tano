// @vitest-environment jsdom
import { createApp, defineComponent, h, type Component } from 'vue';
import { expect, it } from 'vitest';
import { loadingComponent } from './loading-component';
it('keeps a table-shaped skeleton while a data table component downloads', async () => {
  let finish!: (component: Component) => void;
  const Table = loadingComponent(() => new Promise<Component>(resolve => { finish = resolve; }), 'spreadsheet');
  const root = document.createElement('div'), app = createApp(() => h(Table)); app.mount(root);
  try {
    expect(root.querySelector('[data-preview-kind="spreadsheet"]')).not.toBeNull();
    expect(root.querySelector('.loading-skeleton-document')).toBeNull();
    finish(defineComponent({ render: () => h('table', [h('tbody', [h('tr', [h('td', '已加载')])])]) }));
    await expect.poll(() => root.querySelector('td')?.textContent).toBe('已加载');
    expect(root.querySelector('[data-preview-kind]')).toBeNull();
  } finally { app.unmount(); }
});

it.each([0, 1])('lets sibling region %s finish without waiting for the other or disabling controls', async first => {
  const resolve: ((component: Component) => void)[] = [];
  const regions = [0, 1].map(i => loadingComponent(() => new Promise<Component>(done => { resolve[i] = done; })));
  const root = document.createElement('div');
  const app = createApp({ render: () => h('main', [h('button', '搜索'), ...regions.map(region => h(region))]) });
  app.mount(root);
  try {
    const button = root.querySelector('button');
    expect(root.querySelectorAll('.loading-skeleton')).toHaveLength(2);
    resolve[first]!(defineComponent({ render: () => h('article', `区域 ${first}`) }));
    await expect.poll(() => root.querySelectorAll('.loading-skeleton').length).toBe(1);
    const ready = root.querySelector('article');
    resolve[1 - first]!(defineComponent({ render: () => h('section', '另一区域') }));
    await expect.poll(() => root.querySelectorAll('.loading-skeleton').length).toBe(0);
    expect(root.querySelector('article')).toBe(ready);
    expect(root.querySelector('button')).toBe(button);
    expect(button?.disabled).toBe(false);
  } finally { app.unmount(); }
});

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
