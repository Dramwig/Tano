import { bundledObjectPlugins, type PluginManifest } from '@tano/protocol';

/** Catalog metadata is separate from the portable plugin manifest. */
export interface PluginCatalogEntry {
  manifest: PluginManifest;
  category: { id: string; label: string };
}

const categories: Record<string, PluginCatalogEntry['category']> = {
  research: { id: 'research', label: '学术研究' },
  reading: { id: 'reading', label: '阅读写作' },
};

export const bundledPluginCatalog: readonly PluginCatalogEntry[] = bundledObjectPlugins.map(
  (manifest) => ({
    manifest,
    category: categories[manifest.id] ?? { id: 'tools', label: '其他工具' },
  }),
);
