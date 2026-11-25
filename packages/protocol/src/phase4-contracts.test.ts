import { describe, expect, it } from 'vitest';
import {
  isPluginArchiveV2Bytes,
  packPluginArchiveV2,
  parsePluginManifest,
  parsePluginPackage,
  pluginArchiveDigest,
  unpackPluginArchiveV2,
} from './index';

describe('Phase 4 packageVersion 2 deterministic ZIP container', () => {
  it('produces bit-for-bit identical ZIP bytes and SHA-256 while preserving raw binary WASM/PNG assets', async () => {
    const manifest = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'wasm-diagram',
      name: 'WASM 图表引擎',
      version: '1.0.0',
      description: '确定性 ZIP v2 测试',
      objectTypes: [],
      relationTypes: [],
      permissions: ['ui'],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [{ id: 'canvas', label: '画布', location: 'tab', layout: 'fill' }],
    });
    const pkg = parsePluginPackage(
      JSON.stringify({
        packageVersion: 1,
        manifest,
        source: 'console.log("hello v2");',
        ui: { canvas: { html: '<div id="root"></div>', css: '.box{color:red}', source: 'console.log("ui");' } },
      }),
    );

    const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Different key insertion orders must produce byte-identical ZIP archives and digests
    const zipA = packPluginArchiveV2({
      pkg,
      binaryAssets: { 'engine.wasm': wasmBytes, 'icons/logo.png': pngBytes },
    });
    const zipB = packPluginArchiveV2({
      pkg,
      binaryAssets: { 'icons/logo.png': pngBytes, 'engine.wasm': wasmBytes },
    });

    expect(isPluginArchiveV2Bytes(zipA)).toBe(true);
    expect(zipA).toEqual(zipB);
    expect(await pluginArchiveDigest(zipA)).toBe(await pluginArchiveDigest(zipB));

    const unpacked = unpackPluginArchiveV2(zipA);
    expect(unpacked.packageVersion).toBe(2);
    expect(unpacked.pkg.manifest.id).toBe('wasm-diagram');
    expect(unpacked.pkg.ui?.canvas?.css).toBe('.box{color:red}');
    expect(unpacked.binaryAssets['engine.wasm']).toEqual(wasmBytes);
    expect(unpacked.binaryAssets['icons/logo.png']).toEqual(pngBytes);

    // Tampering with a single payload byte fails CRC32 check
    const tampered = new Uint8Array(zipA);
    const marker = new TextEncoder().encode('hello v2');
    const idx = tampered.findIndex((_, i) => marker.every((b, j) => tampered[i + j] === b));
    expect(idx).toBeGreaterThan(0);
    tampered[idx]! ^= 0xff;
    expect(() => unpackPluginArchiveV2(tampered)).toThrow('CRC32');
  });
});

describe('Phase 4 cross-plugin services and homeTab/newTab manifest contracts', () => {
  it('validates cross-plugin services, usesServices, onService activation, and homeTab/newTab locations', () => {
    const provider = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'citation-engine',
      name: '引文引擎',
      version: '1.0.0',
      description: '提供引文格式化服务',
      objectTypes: [],
      relationTypes: [],
      permissions: [],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [
        { id: 'home', label: '学术主页', location: 'homeTab' },
        { id: 'blank', label: '文献新标签', location: 'newTab' },
      ],
      services: [
        {
          name: 'format.apa',
          description: '格式化单条引文为 APA 格式',
          parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          returns: { type: 'object', properties: { citation: { type: 'string' } }, required: ['citation'] },
        },
      ],
      activationEvents: ['onService:format.apa'],
    });
    expect(provider.manifestVersion).toBe(2);
    if (provider.manifestVersion === 2) {
      expect(provider.services).toHaveLength(1);
      expect(provider.views.map(v => v.location)).toEqual(['homeTab', 'newTab']);
    }

    const consumer = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'paper-writer',
      name: '论文写作助手',
      version: '1.0.0',
      description: '消费引文服务',
      objectTypes: [],
      relationTypes: [],
      permissions: [],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [],
      usesServices: [{ pluginId: 'citation-engine', service: 'format.apa', optional: true }],
    });
    if (consumer.manifestVersion === 2) {
      expect(consumer.usesServices?.[0]).toEqual({
        pluginId: 'citation-engine',
        service: 'format.apa',
        optional: true,
      });
    }
  });
});
