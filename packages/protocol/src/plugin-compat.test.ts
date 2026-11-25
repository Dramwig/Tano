import { describe, expect, it } from 'vitest';
import {
  canonicalPluginJson,
  checkPluginCompatibility,
  classifyPluginError,
  parsePluginManifest,
  PluginError,
  resolvePluginSettingsWithDefaults,
  validatePluginSettingsAgainstSchema,
  type ExecutablePluginManifest,
} from './index';

const baseV2 = {
  manifestVersion: 2,
  apiVersion: 1,
  id: 'demo-tool',
  name: '示例工具',
  version: '1.0.0',
  description: '测试清单',
  objectTypes: [],
  relationTypes: [],
  permissions: ['documents.read'],
  networkOrigins: [],
  nativeCommands: [],
  commands: [{ id: 'run', label: '执行' }],
  views: [{ id: 'main', label: '主视图', location: 'tab' }],
};

describe('engines, platforms and compatibility', () => {
  it('parses engines and platforms on both v1 and v2 manifests without changing legacy canonical JSON', () => {
    const legacy = parsePluginManifest(baseV2);
    expect('engines' in legacy).toBe(false);
    expect('platforms' in legacy).toBe(false);
    expect(canonicalPluginJson(legacy)).not.toContain('"engines"');

    const v1 = parsePluginManifest({
      manifestVersion: 1,
      id: 'theme-a',
      name: '主题',
      version: '1.0.0',
      description: '',
      objectTypes: [],
      relationTypes: [],
      engines: { tano: '>=0.14.0' },
      platforms: ['web', 'desktop-local'],
    });
    expect(v1.engines).toEqual({ tano: '>=0.14.0' });
    expect(v1.platforms).toEqual(['web', 'desktop-local']);

    expect(checkPluginCompatibility(v1, { coreVersion: '0.14.0', platform: 'web' })).toEqual({ compatible: true });
    expect(checkPluginCompatibility(v1, { coreVersion: '0.13.9', platform: 'web' })).toMatchObject({
      compatible: false,
      code: 'CORE_VERSION_TOO_OLD',
    });
    expect(checkPluginCompatibility(v1, { coreVersion: '0.15.0', platform: 'mobile' })).toMatchObject({
      compatible: false,
      code: 'PLATFORM_UNSUPPORTED',
    });
  });

  it.each([
    { engines: { tano: '0.14.0' } },
    { engines: { tano: '>=01.0.0' } },
    { engines: { node: '>=20.0.0' } },
    { platforms: [] },
    { platforms: ['web', 'web'] },
    { platforms: ['ios'] },
  ])('rejects invalid engines or platforms: %j', (extra) => {
    expect(() => parsePluginManifest({ ...baseV2, ...extra })).toThrow();
  });
});

describe('settingsSchema and activationEvents', () => {
  it('validates settingsSchema, merges defaults and validates user values', () => {
    const manifest = parsePluginManifest({
      ...baseV2,
      settingsSchema: [
        { key: 'title', label: '标题', type: 'string', default: '日报', required: true },
        { key: 'minutes', label: '时长', type: 'number', min: 5, max: 120, default: 25 },
        { key: 'notify', label: '提醒', type: 'boolean', default: true },
        {
          key: 'mode',
          label: '模式',
          type: 'select',
          options: [
            { value: 'compact', label: '紧凑' },
            { value: 'full', label: '完整' },
          ],
          default: 'compact',
        },
      ],
      fileHandlers: [{ extensions: ['.canvas.md'], mode: 'editor', view: 'main', command: 'run' }],
      activationEvents: ['onCommand:run', 'onView:main', 'onFile:.canvas.md'],
    }) as ExecutablePluginManifest;

    expect(resolvePluginSettingsWithDefaults({ minutes: 45 }, manifest.settingsSchema)).toEqual({
      title: '日报',
      minutes: 45,
      notify: true,
      mode: 'compact',
    });
    expect(validatePluginSettingsAgainstSchema({ title: '周报', minutes: 60, notify: false, mode: 'full' }, manifest.settingsSchema)).toEqual({
      title: '周报',
      minutes: 60,
      notify: false,
      mode: 'full',
    });
    expect(() => validatePluginSettingsAgainstSchema({ minutes: 3 }, manifest.settingsSchema)).toThrow('不能小于 5');
    expect(() => validatePluginSettingsAgainstSchema({ mode: 'other' }, manifest.settingsSchema)).toThrow('允许选项');
  });

  it.each([
    { settingsSchema: [] },
    { settingsSchema: [{ key: 'n', label: '数字', type: 'number', min: 10, max: 5 }] },
    { settingsSchema: [{ key: 'n', label: '数字', type: 'number', min: 10, default: 5 }] },
    { settingsSchema: [{ key: 's', label: '选择', type: 'select', options: [{ value: 'a', label: 'A' }], default: 'b' }] },
    { activationEvents: [] },
    { activationEvents: ['onCommand:missing'] },
    { activationEvents: ['onView:missing'] },
    { activationEvents: ['onFile:.canvas.md'] },
    { activationEvents: ['onStartup', 'onStartup'] },
  ])('rejects invalid settingsSchema or activationEvents: %j', (extra) => {
    expect(() => parsePluginManifest({ ...baseV2, ...extra })).toThrow();
  });
});

describe('classifyPluginError', () => {
  it('maps host errors and explicit PluginError instances to stable codes', () => {
    expect(classifyPluginError(new PluginError('CONFLICT', 'custom', true))).toEqual({
      code: 'CONFLICT',
      message: 'custom',
      retryable: true,
    });
    expect(classifyPluginError(new Error('插件没有 documents.write 权限')).code).toBe('PERMISSION_DENIED');
    expect(classifyPluginError(new Error('你对这篇文档只有阅读权限')).code).toBe('READ_ONLY');
    expect(classifyPluginError(new Error('查询结果已变化或分页已过期，请从第一页重新查询'))).toMatchObject({
      code: 'CURSOR_EXPIRED',
      retryable: true,
    });
    expect(classifyPluginError(new Error('请先读取目标内容，再使用返回的版本摘要修改')).code).toBe('STALE_BASELINE');
    expect(classifyPluginError(new Error('文档有重叠修改，插件版本已保存在 a.md')).code).toBe('CONFLICT');
    expect(classifyPluginError(new Error('插件本机状态不能超过 256 KiB')).code).toBe('QUOTA_EXCEEDED');
    expect(classifyPluginError(new Error('插件请求超时')).code).toBe('TIMEOUT');
    expect(classifyPluginError(new Error('插件运行实例已失效')).code).toBe('INSTANCE_STOPPED');
  });
});
