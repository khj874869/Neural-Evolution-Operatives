import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/phaser/')) return 'phaser-core';
          if (id.includes('/node_modules/@colyseus/')) return 'network-core';
          return undefined;
        },
      },
    },
  },
});
