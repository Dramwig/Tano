import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // The browser export creates a DOM element at module load. Markdown also
    // runs in a Worker, so use the package's DOM-free entity lookup in both.
    alias: { 'decode-named-character-reference': require.resolve('decode-named-character-reference') },
  },
  plugins: [
    vue(),
    {
      name: 'isolated-dev-cache',
      config(config, { command }) {
        // Concurrent browser and desktop servers must not overwrite each other's bundles.
        if (command === 'serve') {
          return { cacheDir: `node_modules/.vite/dev-${config.server?.port ?? 43841}` };
        }
      },
    },
  ],
  server: {
    host: process.env.TAURI_DEV_HOST || '127.0.0.1', port: 43841, strictPort: true,
    // Transform the startup path while Tauri compiles, rather than making the
    // first WebView navigation wait for the entire workbench module waterfall.
    warmup: { clientFiles: ['./src/main.ts', './src/start.ts', '../../packages/workbench/src/App.vue'] },
    watch: {
      // Tauri watches native sources itself; Rust build artifacts can be locked on Windows.
      ignored: ['**/src-tauri/**'],
    },
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Shared Markdown parsers also serve the workspace picker. Do not pull the
        // entire editor into startup just because it shares those dependencies.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.replaceAll('\\', '/').includes('/node_modules/@milkdown/')) return 'editor';
        },
      },
    },
  },
});
