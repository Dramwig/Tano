import { expect, it } from 'vitest';
import { canonicalPluginJson, parsePluginManifest, parsePluginPackage } from './extensions';

const manifest = { manifestVersion: 2, apiVersion: 1, id: 'report', name: '报告', version: '1.0.0', description: '', objectTypes: [], relationTypes: [],
  permissions: ['documents.read'], networkOrigins: [], nativeCommands: [], commands: [], views: [] };
const pkg = { packageVersion: 1, manifest, source: '// foreground' };
it('preserves existing package hashes and includes separate automation code only with declared entries', () => {
  expect(canonicalPluginJson(parsePluginPackage(JSON.stringify(pkg)))).toBe(canonicalPluginJson(pkg));
  const value = { ...pkg, manifest: { ...manifest, automations: [{ id: 'daily', label: '日报' }] }, automationSource: 'return await tano.documents.list();' };
  expect(parsePluginPackage(JSON.stringify(value))).toEqual(value);
  expect(canonicalPluginJson(parsePluginPackage(JSON.stringify({ ...value, automationSource: 'return [];' })))).not.toBe(canonicalPluginJson(value));
  expect(() => parsePluginPackage(JSON.stringify({ ...pkg, automationSource: 'return [];' }))).toThrow('声明自动化');
  expect(() => parsePluginPackage(JSON.stringify({ ...value, automationSource: undefined }))).toThrow('入口脚本');
  expect(() => parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { ...manifest, manifestVersion: 1, apiVersion: undefined, permissions: undefined, networkOrigins: undefined, nativeCommands: undefined, commands: undefined, views: undefined }, automationSource: 'return null;' }))).toThrow();
});
it('rejects duplicate, empty, excessive and scheduling or privilege fields in code declarations', () => {
  const entry = { id: 'daily', label: '日报' };
  for (const automations of [[], [entry, entry], Array.from({ length: 11 }, (_, i) => ({ id: `run-${i}`, label: '任务' })), [{ ...entry, id: '../bad' }],
    [{ ...entry, everyMinutes: 5 }], [{ ...entry, userId: 'owner' }], [{ ...entry, label: '' }]]) {
    expect(() => parsePluginManifest({ ...manifest, automations })).toThrow();
  }
});
