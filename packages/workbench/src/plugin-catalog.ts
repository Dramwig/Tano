import { bundledObjectPlugins, type PluginManifest, type PluginPackage } from '@tano/protocol';
import excalidrawManifest from './plugins/excalidraw/manifest.json';

/** Catalog metadata is separate from the portable plugin manifest. */
export interface PluginCatalogEntry {
  manifest: PluginManifest;
  category: { id: string; label: string };
  /** Bundled executable bytes can be installed without a network catalog. */
  package?: PluginPackage;
  /** Large offline integrations are loaded only when explicitly installed. */
  loadPackage?: () => Promise<PluginPackage>;
}

const categories: Record<string, PluginCatalogEntry['category']> = {
  research: { id: 'research', label: '学术研究' },
  reading: { id: 'reading', label: '阅读写作' },
};

export const bundledPluginCatalog: readonly PluginCatalogEntry[] = [
  { manifest: excalidrawManifest as PluginManifest, category: { id: 'tools', label: '其他工具' },
    loadPackage: async () => (await import('./plugins/excalidraw/bundle.tano-plugin.json')).default as PluginPackage },
  ...bundledObjectPlugins.map((manifest) => ({
    manifest,
    category: categories[manifest.id] ?? { id: 'tools', label: '其他工具' },
  })),
];
