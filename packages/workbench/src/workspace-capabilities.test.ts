// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { loadCapabilities, saveCapabilityPatch } from './workspace-capabilities';
import { capabilityPath, defaultCapabilities } from '@tano/editor/runtime';

beforeEach(() => localStorage.clear());
it.each(['superscript', 'subscript', 'underline', 'highlight', 'inlineComment'] as const)(
  'persists the %s extension in portable workspace rules', async feature => {
    const adapter = new DemoAdapter();
    const workspace = await adapter.open();
    const initial = await loadCapabilities(adapter, workspace);
    expect(initial.capabilities.features[feature]).toBe(true);
    const saved = await saveCapabilityPatch(adapter, initial.snapshot, { feature, enabled: false });
    expect(JSON.parse(saved.snapshot.content).features[feature]).toBe(false);
    expect((await loadCapabilities(new DemoAdapter(), await adapter.refresh())).capabilities.features[feature]).toBe(false);
  },
);
it('persists workspace policy without touching document content or identity', async () => {
  const adapter = new DemoAdapter();
  const workspace = await adapter.open();
  const before = await adapter.read(workspace.files.find((f) => f.kind === 'file')!.path);
  const initial = await loadCapabilities(adapter, workspace);
  const saved = await saveCapabilityPatch(adapter, initial.snapshot, {
    feature: 'math',
    enabled: false,
  });
  expect(saved.capabilities.features.math).toBe(false);
  expect(
    (await loadCapabilities(new DemoAdapter(), await adapter.refresh())).capabilities.features.math,
  ).toBe(false);
  expect(await adapter.read(workspace.files.find((f) => f.kind === 'file')!.path)).toEqual(before);
});
it('merges independent external edits and preserves unknown policy fields', async () => {
  const adapter = new DemoAdapter();
  await adapter.create(
    capabilityPath,
    JSON.stringify({
      ...defaultCapabilities,
      custom: 'retain',
      features: { ...defaultCapabilities.features, future: false },
    }),
  );
  const base = await adapter.read(capabilityPath);
  await saveCapabilityPatch(adapter, base, { feature: 'mermaid', enabled: false });
  const saved = await saveCapabilityPatch(adapter, base, { feature: 'math', enabled: false });
  expect(saved.capabilities.features).toMatchObject({ math: false, mermaid: false });
  expect(JSON.parse(saved.snapshot.content)).toMatchObject({
    custom: 'retain',
    features: { future: false },
  });
});

it('persists bullet markers, merges independent rules, and rejects competing marker edits', async () => {
  const adapter = new DemoAdapter();
  const workspace = await adapter.open();
  const document = workspace.files.find(file => file.kind === 'file' && file.path.endsWith('.md'))!;
  const before = await adapter.read(document.path);
  const initial = await saveCapabilityPatch(adapter, null, { bulletListMarker: '*' });
  await saveCapabilityPatch(adapter, initial.snapshot, { mathSyntax: 'latex' });
  const saved = await saveCapabilityPatch(adapter, initial.snapshot, { bulletListMarker: '+' });
  expect(saved.capabilities).toMatchObject({ mathSyntax: 'latex', bulletListMarker: '+' });
  expect((await loadCapabilities(new DemoAdapter(), await adapter.refresh())).capabilities.bulletListMarker)
    .toBe('+');
  await expect(saveCapabilityPatch(adapter, initial.snapshot, { bulletListMarker: '-' }))
    .rejects.toThrow('外部修改');
  expect(await adapter.read(capabilityPath)).toEqual(saved.snapshot);
  expect(await adapter.read(document.path)).toEqual(before);
});
it('shares page width per document and merges changes to different documents', async () => {
  const adapter = new DemoAdapter();
  const workspace = await adapter.open();
  const markdown = workspace.files.filter((file) => file.kind === 'file' && file.path.endsWith('.md'));
  const first = markdown[0]!;
  const second = markdown[1]!;
  const before = await adapter.read(first.path);
  await saveCapabilityPatch(adapter, null, {
    pageWidth: { documentId: first.id, limited: false },
  });
  const merged = await saveCapabilityPatch(adapter, null, {
    pageWidth: { documentId: second.id, limited: false },
  });
  expect(merged.capabilities.pageWidthLimits).toMatchObject({
    [first.id]: false,
    [second.id]: false,
  });
  expect((await loadCapabilities(new DemoAdapter(), await adapter.refresh())).capabilities.pageWidthLimits)
    .toEqual(merged.capabilities.pageWidthLimits);
  expect(await adapter.read(first.path)).toEqual(before);
  await expect(saveCapabilityPatch(adapter, null, {
    pageWidth: { documentId: first.id, limited: true },
  })).rejects.toThrow('外部修改');
  const restored = await saveCapabilityPatch(adapter, merged.snapshot, {
    pageWidth: { documentId: first.id, limited: true },
  });
  expect(restored.capabilities.pageWidthLimits[first.id]).toBeUndefined();
  expect(restored.capabilities.pageWidthLimits[second.id]).toBe(false);
});
it('rejects conflicting external changes and corrupt policy without overwriting', async () => {
  const adapter = new DemoAdapter();
  const initial = await saveCapabilityPatch(adapter, null, { mathSyntax: 'preserve' });
  const external = await saveCapabilityPatch(adapter, initial.snapshot, { mathSyntax: 'latex' });
  await expect(
    saveCapabilityPatch(adapter, initial.snapshot, { mathSyntax: 'dollar' }),
  ).rejects.toThrow('外部修改');
  expect(await adapter.read(capabilityPath)).toEqual(external.snapshot);
  await adapter.write(capabilityPath, '{broken', external.snapshot.hash);
  await expect(
    saveCapabilityPatch(adapter, external.snapshot, { mathSyntax: 'dollar' }),
  ).rejects.toThrow();
  expect((await adapter.read(capabilityPath)).content).toBe('{broken');
});
it('handles a racing creator and rejects invalid feature types', async () => {
  const adapter = new DemoAdapter();
  await saveCapabilityPatch(adapter, null, { feature: 'mermaid', enabled: false });
  const saved = await saveCapabilityPatch(adapter, null, { feature: 'math', enabled: false });
  expect(saved.capabilities.features).toMatchObject({ math: false, mermaid: false });
  await adapter.write(capabilityPath, '{"features":{"math":"false"}}', saved.snapshot.hash);
  await expect(loadCapabilities(adapter, await adapter.refresh())).rejects.toThrow('布尔值');
});
