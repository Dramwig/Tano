// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createApp, h } from 'vue';
import { parsePluginManifest } from '@tano/protocol';
import PluginChangeSummary from './PluginChangeSummary.vue';
it('compares permission removal and origin expansion even when the broad network permission is unchanged', () => {
  const manifest = { manifestVersion: 2, apiVersion: 1, id: 'test', name: '测试', version: '1.0.0', description: '', objectTypes: [], relationTypes: [], permissions: ['documents.write', 'network'], networkOrigins: ['https://old.example'] };
  const before = parsePluginManifest(manifest), after = parsePluginManifest({ ...manifest, version: '2.0.0', permissions: ['network'], networkOrigins: ['https://new.example'] });
  const root = document.createElement('div'), app = createApp(() => h(PluginChangeSummary, { before, after, workspace: '研究组' })); app.mount(root);
  try {
    expect(root.textContent).toContain('1.0.0 → 2.0.0'); expect(root.textContent).toContain('影响工作区：研究组');
    expect(root.textContent).toContain('移除运行权限：创建与修改文档');
    expect(root.textContent).toContain('新增联网地址：https://new.example'); expect(root.textContent).toContain('移除联网地址：https://old.example');
    expect(root.textContent).toContain('每位成员需在自己的设备上授权');
  } finally { app.unmount(); }
});

it('displays attachments.read permission and fileHandlers additions/removals clearly', () => {
  const base = {
    manifestVersion: 2, apiVersion: 1, id: 'viewer', name: '预览器', version: '1.0.0', description: '',
    objectTypes: [], relationTypes: [], permissions: ['attachments.read', 'ui'], networkOrigins: [], nativeCommands: [],
    commands: [{ id: 'open', label: '打开' }], views: [{ id: 'main', label: '主视图', location: 'tab', layout: 'fill' }],
    fileHandlers: [{ extensions: ['.csv'], mode: 'preview', view: 'main', command: 'open' }],
  };
  const before = parsePluginManifest(base);
  const after = parsePluginManifest({
    ...base,
    version: '1.1.0',
    fileHandlers: [{ extensions: ['.tsv'], mode: 'preview', view: 'main', command: 'open' }],
  });
  const root = document.createElement('div'), app = createApp(() => h(PluginChangeSummary, { before, after, workspace: '工作区' }));
  app.mount(root);
  try {
    expect(root.textContent).toContain('只读访问工作区附件');
    expect(root.textContent).toContain('文件打开器');
    expect(root.textContent).toContain('新增文件打开器：.tsv（预览）');
    expect(root.textContent).toContain('移除文件打开器：.csv（预览）');
  } finally { app.unmount(); }
});
