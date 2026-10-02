import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
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
