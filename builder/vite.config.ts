import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The BLOKZA marketing site is served statically from the repository root:
// Vercel publishes the repo as it stands, with no build step of its own. The
// builder is a single-page app mounted at /app/, so we emit the bundle into
// <repo>/app and commit it — which is why scripts/release.sh exists to keep
// that commit current.
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
    name: 'blokza-classic-entry',
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
   * `/assets/...`. The redirects in vercel.json cover that case for anyone who
   * types the short URL.
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
    /*
     * Stand in for the Vercel function at `api/auth/[...all].mjs`.
     *
     * Without this, `/api/auth/*` 404s in development and the only way to sign
     * in locally is to point the client straight at Neon — which is a different
     * code path from the deployed one, and specifically the path with the
     * third-party-cookie problem the proxy exists to avoid. Testing the flow
     * that way proves nothing about the flow that ships.
     *
     * With it, dev and production differ only in who runs the proxy: the cookie
     * is first-party on localhost exactly as it is on blokza.com, and
     * `VITE_NEON_AUTH_URL` stays unset in both.
     *
     * `changeOrigin` rewrites the `Host` header, not the `Origin` header — two
     * different things that are easy to conflate, and getting it wrong here
     * fails in a thoroughly misleading way. Left off, the upstream TLS
     * handshake carries `localhost` as its SNI name, Neon answers with a
     * default certificate, and Node reports "self-signed certificate" as though
     * something were intercepting the connection.
     *
     * It does not touch `Origin`, so the CSRF check upstream still sees
     * `http://localhost:5273` — which Neon Auth trusts by default.
     */
    proxy: process.env.NEON_AUTH_URL
      ? {
          '/api/auth': {
            target: process.env.NEON_AUTH_URL,
            changeOrigin: true,
            secure: true,
            rewrite: (path: string) => path.replace(/^\/api\/auth/, ''),
          },
        }
      : undefined,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
  },
});
