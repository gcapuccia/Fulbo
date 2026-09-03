import { defineConfig } from 'vite';

export default defineConfig({
  // El juego se sirve desde la raíz, sin base pública especial.
  server: { open: false },
  build: {
    outDir: 'dist',
    // three.js pesa; separarlo evita rehacer el bundle del juego en cada cambio.
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
