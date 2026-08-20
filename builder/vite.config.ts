import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Altask marketing site is served statically from the repository root
// (netlify `publish = "."`). The builder is a single-page app mounted at /app/,
// so we emit the bundle into <repo>/app and commit it. That keeps the
// zero-config static deploy working while giving the editor a real build step.
/**
 * Emit the entry as a classic script.
 *
 * Vite always writes `<script type="module" crossorigin>` for the entry, even
 * when the output format is IIFE. A module tag is exactly what `file://` refuses,
 * so the whole point of building IIFE is lost unless the tag is rewritten too.
 * `crossorigin` goes with it: it makes a file:// request fail outright.
 */
function classicEntryScript(): Plugin {
  return {
    name: 'altask-classic-entry',
    // Build only. In dev the entry is `/src/main.tsx`, which Vite must serve as a
    // real module — stripping `type="module"` there loads TypeScript as a classic
    // script, so nothing runs and the dev server shows the boot guard instead of
    // the editor.
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        // `defer` is not optional here. Vite puts the entry in <head>, which is
        // safe for a module (deferred by definition) but not for a classic
        // script: it would execute before <body> exists and `#root` would be
        // null, which is the one thing `main.tsx` throws on.
        .replace(/<script\s+type="module"\s+crossorigin\s+/g, '<script defer ')
        .replace(/<script\s+type="module"\s+/g, '<script defer ')
        // modulepreload is meaningless for a classic script and 404s from disk.
        .replace(/\s*<link[^>]*rel="modulepreload"[^>]*>/g, '')
        .replace(/(<link[^>]*rel="stylesheet")\s+crossorigin/g, '$1');
    },
  };
}

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
  plugins: [react(), classicEntryScript()],
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
        /*
         * A single classic script, not ES modules.
         *
         * Browsers refuse `<script type="module">` from a `file://` origin — it
         * is opaque, so the CORS check can never pass — and this repository is
         * developed by opening the HTML files from disk. A module build meant the
         * editor could not be opened without first standing up a server, which
         * is a strange thing to require of a static site.
         *
         * The cost is real and worth naming: IIFE cannot code-split, so the
         * export renderer and JSZip are inlined instead of loaded on demand, and
         * the first load carries them. `import()` still works at runtime —
         * Rollup resolves it against the already-bundled module — so the source
         * keeps its lazy structure and nothing else changes.
         */
        format: 'iife',
        inlineDynamicImports: true,
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
