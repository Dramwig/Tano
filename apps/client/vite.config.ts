import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
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
        manualChunks: {
          editor: [
            '@milkdown/kit/core',
            '@milkdown/kit/preset/commonmark',
            '@milkdown/kit/preset/gfm',
            '@milkdown/kit/plugin/history',
            '@milkdown/kit/plugin/clipboard',
          ],
        },
      },
    },
  },
});
