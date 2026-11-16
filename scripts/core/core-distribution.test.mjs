import { expect, it } from 'vitest';
import { distributionConfig, publicationAllowed, publishPackage } from './core-distribution.mjs';

const config = distributionConfig({ format: 1, npmScope: '@owner', npmRegistry: 'https://registry.npmjs.org', nativePackage: 'tano-native' });
it('publishes under an owned scope while preserving public imports with exact internal aliases', () => {
  const original = { name: '@tano/editor', version: '0.8.2', private: true,
    exports: './src/MarkdownEditor.vue', scripts: { postinstall: 'unwanted' },
    dependencies: { '@tano/protocol': '^0.8.2', vue: '^3.5.22' } };
  const packed = publishPackage(original, config, 'a'.repeat(40));
  expect(packed.name).toBe('@owner/editor');
  expect(packed.dependencies['@tano/protocol']).toBe('npm:@owner/protocol@0.8.2');
  expect(packed.dependencies.vue).toBe('^3.5.22');
  expect(packed.private).toBeUndefined();
  expect(packed.scripts).toBeUndefined();
  expect(original.private).toBe(true);
});
it('pins internal dependencies even when the original scope is owned', () => {
  const pkg = publishPackage({ name: '@tano/mcp', version: '0.8.2', dependencies: { '@tano/protocol': '*' } },
    { ...config, npmScope: '@tano' }, 'a'.repeat(40));
  expect(pkg.dependencies['@tano/protocol']).toBe('0.8.2');
});
it('rejects credential-bearing registries and invalid scopes', () => {
  expect(() => distributionConfig({ ...config, npmRegistry: 'https://secret@registry.npmjs.org' })).toThrow();
  expect(() => distributionConfig({ ...config, npmScope: '@../escape' })).toThrow();
});
it('requires evidence for this exact clean stable commit before real publication', () => {
  const manifest = { format: 2, npmRegistry: 'https://registry.npmjs.org/', dirty: false, version: '0.8.2', sourceCommit: 'a'.repeat(40),
    packages: ['protocol', 'markdown', 'editor', 'workbench', 'mcp'].map(name => ({ name: `@tano/${name}`, publishedName: `@tano.page/${name}`, version: '0.8.2' })),
    native: { name: 'tano-native', version: '0.8.2' } };
  const evidence = { sourceCommit: manifest.sourceCommit, commands:
    ['npm run check', 'npm run test:native', 'npm run mcp:smoke', 'npm run core:registry:smoke'].map(command => ({ command, exitCode: 0 })) };
  expect(() => publicationAllowed(manifest, evidence)).not.toThrow();
  expect(() => publicationAllowed({ ...manifest, dirty: true }, evidence)).toThrow('clean');
  expect(() => publicationAllowed(manifest, { ...evidence, sourceCommit: 'b'.repeat(40) })).toThrow('exact');
  expect(() => publicationAllowed(manifest, { ...evidence, commands: evidence.commands.slice(1) })).toThrow('npm run check');
});
