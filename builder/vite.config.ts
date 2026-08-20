import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Altask marketing site is served statically from the repository root
// (netlify `publish = "."`). The builder is a single-page app mounted at /app/,
// so we emit the bundle into <repo>/app and commit it. That keeps the
// zero-config static deploy working while giving the editor a real build step.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../app', import.meta.url)),
    emptyOutDir: true,
    // The bundle in /app is committed to the repository, so source maps would
    // add well over a megabyte to every build's diff. Vite serves inline maps in
    // dev, which is where they actually get used.
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          zip: ['jszip'],
        },
      },
    },
  },
  server: {
    port: 5273,
    // Never auto-open: the editor is driven from the in-app browser during
    // development, and hijacking the default browser is a surprise.
    open: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
  },
});
