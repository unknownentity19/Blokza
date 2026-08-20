import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Altask marketing site is served statically from the repository root
// (netlify `publish = "."`). The builder is a single-page app mounted at /app/,
// so we emit the bundle into <repo>/app and commit it. That keeps the
// zero-config static deploy working while giving the editor a real build step.
export default defineConfig({
  /*
   * Relative, not '/app/'.
   *
   * The marketing site has no dev server — it is developed by opening the HTML
   * files from disk — and an absolute base makes the built shell request
   * `/app/assets/...`, which over `file://` resolves to the filesystem root and
   * 404s. A relative base resolves against the document instead, so the editor
   * opens both by double-clicking `index.html` and from any static host.
   *
   * This is why every link points at `app/index.html` rather than `app/`: with a
   * relative base the asset URLs are resolved against the *document*, so landing
   * on a bare `/app` (no trailing slash, no filename) would look for
   * `/assets/...`. The redirects in netlify.toml and vercel.json cover that case
   * for anyone who types the short URL.
   */
  base: './',
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
