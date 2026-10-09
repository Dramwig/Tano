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
