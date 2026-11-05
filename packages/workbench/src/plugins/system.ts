import { canonicalPluginJson, parsePluginPackage, type PluginPackage, type WorkspacePluginRule } from '@tano/protocol';
import { pluginIntegrity } from './packages';

/** Trusted product registrations, never supplied by a workspace manifest or catalog. */
const loaders = {
  'presentation-preview': () => import('./presentation-preview/bundle.tano-plugin.json'),
  'word-preview': () => import('./word-preview/bundle.tano-plugin.json'),
};
export const systemPluginIds: readonly string[] = Object.keys(loaders);
const packages = new Map<string, Promise<{ pkg: PluginPackage; integrity: string }>>();
export async function systemPlugin(id: string) {
  if (!Object.hasOwn(loaders, id)) throw new Error('未知系统插件');
  if (!packages.has(id)) packages.set(id, loaders[id as keyof typeof loaders]().then(async module => {
    const pkg = parsePluginPackage(JSON.stringify(module.default));
    return { pkg, integrity: await pluginIntegrity(pkg) };
  }).catch(error => { packages.delete(id); throw error; }));
  return packages.get(id)!;
}
export async function resolveSystemPlugin(rule: WorkspacePluginRule) {
  const { pkg, integrity } = await systemPlugin(rule.manifest.id);
  if (rule.integrity !== integrity || canonicalPluginJson(rule.manifest) !== canonicalPluginJson(pkg.manifest))
    throw new Error('系统插件版本与应用内置版本不一致');
  return pkg;
}
