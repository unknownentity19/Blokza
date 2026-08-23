# Cilbs — Marketing Site + Visual Editor

Two things live in this repository:

1. **The marketing site** — pure HTML, CSS and vanilla JavaScript at the repo root. No build step, no dependencies.
2. **The builder** — a React + TypeScript single-page app in `builder/`, compiled into `app/` and served at `/app/`.

## Pages

| Page | Path | Description |
| --- | --- | --- |
| Home | `index.html` | Hero, problem, tabbed showcase, features, templates, pricing, testimonials, FAQ, CTA |
| Product | `product.html` | Editor walkthrough |
| Features | `features.html` | Full feature matrix |
| Templates | `templates.html` | 9 production templates |
| Pricing | `pricing.html` | Plans, comparison table, monthly/yearly toggle |
| Docs | `docs.html` | Sticky sidebar + content |
| Blog | `blog.html` | 6-post grid with custom SVG covers |
| Contact | `contact.html` | Form wired to Formspree |
| Builder | `app/` | The visual builder (built from `builder/`) |
| Editor (legacy) | `editor.html` | 301 redirect to `/app/` for old links |
| 404 | `404.html` | Branded not-found page |

## The builder

The builder is a real editor, not a demo: nested containers, per-breakpoint
styling, multiple pages, and a static-site export.

### Running it

```bash
cd builder
npm install
npm run dev        # http://localhost:5273
```

```bash
cd builder
npm test           # unit tests (core model, store, export)
npm run typecheck  # tsc, no emit
npm run build      # typecheck + emit into ../app
```

`app/` is **committed**, because the marketing site is deployed as static files
with no build step. Rebuild it and commit the result whenever `builder/` changes.

### How it is put together

| Area | Where | What it does |
| --- | --- | --- |
| Document model | `builder/src/core/` | Normalised node map, tree queries, drop validation, CSS compiler, storage, export |
| Components | `builder/src/registry/` | Layout, content, media and form primitives, plus section templates |
| State | `builder/src/store/editor.ts` | Zustand + Immer, snapshot undo with coalescing |
| Canvas | `builder/src/canvas/` | Device iframe, pointer drag engine, selection overlay |
| Panels | `builder/src/ui/` | Rail, top bar, insert/layers/pages/theme/settings, inspector |

Three decisions explain most of the design:

- **The canvas is a real `<iframe>` sized to the device.** Media queries fire
  because the frame genuinely is 390px wide, `vh` resolves against a real
  viewport, and no editor CSS can leak into the page.
- **Styles compile to a stylesheet, not inline styles.** `@media` and `:hover`
  cannot be expressed inline, so responsive and interaction states would
  otherwise be fake. Properties come from a closed whitelist and every value is
  validated before it is emitted.
- **Templates expand into primitives.** A "hero" is a Section holding a
  Container holding a Row — every part of it selects, restyles and comes apart,
  rather than being an opaque block with a fixed set of fields.

### Export

Publish produces a ZIP containing one HTML file per page, a single `styles.css`,
`sitemap.xml` and `robots.txt`. Pages are rendered through the same components
the canvas uses, so the output cannot drift from the preview. Links between pages
are rewritten to relative filenames, which means the ZIP works from a local
folder, an S3 bucket, GitHub Pages or Netlify without changes.

Everything is client-side: work autosaves to `localStorage`, and the project can
be downloaded as a `.cilbs.json` file to move between browsers.

## Production checklist

- [x] Semantic HTML5, `<main id="main">` landmark per page
- [x] Skip-to-content link on every page
- [x] Focus-visible rings on every interactive element
- [x] Honors `prefers-reduced-motion`
- [x] Responsive across phone, tablet, desktop
- [x] Open Graph + Twitter card tags per page
- [x] JSON-LD `Organization` + `SoftwareApplication` structured data
- [x] Canonical URL per page
- [x] Web App Manifest (`/site.webmanifest`)
- [x] `robots.txt` + `sitemap.xml`
- [x] Custom 404 page
- [x] Security headers (CSP-friendly, HSTS, X-Frame-Options) via `_headers` (Netlify) + `vercel.json`
- [x] Cache-Control: 1-year immutable on `/assets/*`, no-cache on HTML
- [x] Deferred JS, font preconnect
- [x] Contact form with Formspree integration, honeypot, validation, success/error states
- [x] GitHub Actions CI (HTML/JS validation, broken link check, builder typecheck + tests + build)
- [x] No external runtime dependencies on the marketing site

## Deploy

### Netlify
```bash
# Drag the project folder into the Netlify deploy area, or:
npm i -g netlify-cli
netlify deploy --prod
```
The included `netlify.toml` and `_headers` configure caching, security headers, and redirects automatically.

### Vercel
```bash
npm i -g vercel
vercel --prod
```
The `vercel.json` handles clean URLs, headers, and cache rules.

### Static host (any)
Upload the project root to any static file server. The marketing site has no
build step, and `app/` is committed pre-built, so nothing needs to run on the
host.

## Wiring the contact form

The form on `contact.html` is configured to POST to Formspree. Replace `YOUR_FORM_ID` in `contact.html`:

```html
<form action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
```

Sign up free at https://formspree.io and paste in your form ID. The honeypot field, validation, and success/error states are already wired up.

## Local development

No build step. Open `index.html` directly in a browser, or:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then visit http://localhost:8000.

## Project structure

```
.
├── index.html / product.html / pricing.html / ...        ← marketing pages
├── editor.html                                           ← redirect to /app/
├── 404.html                                              ← branded not-found
├── sitemap.xml / robots.txt / site.webmanifest           ← SEO foundation
├── _headers / netlify.toml / vercel.json                 ← deploy + security config
├── .github/workflows/ci.yml                              ← validation pipeline
├── assets/
│   ├── css/
│   │   ├── base.css     ← tokens, nav, footer, motion utilities
│   │   ├── pages.css    ← hero, features, pricing, testimonials, FAQ
│   │   └── demos.css    ← template demo pages
│   ├── js/
│   │   └── site.js      ← reveals, submenus, pricing toggle, contact form
│   └── og-image.png     ← social share card (1200×630; SVG is not rendered by any platform)
├── app/                                                  ← built builder (committed)
├── builder/                                              ← builder source
│   ├── src/core/        ← document model, CSS compiler, export
│   ├── src/registry/    ← components + section templates
│   ├── src/store/       ← editor state, undo/redo
│   ├── src/canvas/      ← device iframe, drag engine, overlay
│   ├── src/ui/          ← chrome, panels, inspector
│   └── test/            ← unit tests
└── README.md
```

## What the builder can do

**Structure.** Sections, containers, stacks, rows, grids and cards nest to any
depth. Drop anywhere — between siblings, inside a container, into an empty box —
with a live indicator showing exactly where an element will land. Drag from the
palette, from the canvas, or from the layers tree.

**Elements.** Heading, text, rich text, button, link, badge, quote, list, icon,
image, video, embed, form, input, text area, select, checkbox, submit — plus 14
section templates (nav bar, two heroes, feature grid and media, logo strip,
stats, testimonials, pricing, FAQ, gallery, CTA, contact, footer).

**Styling.** A generic CSS inspector over a whitelisted property set: layout,
visual spacing box, size, typography, background, border, effects, position.
Every property can be overridden per breakpoint (desktop / tablet / mobile) and
for `:hover`, with the current layer always named in the panel and an indicator
on any property you have changed.

**Pages and theme.** Multiple pages with their own path and SEO metadata,
internal links that resolve to real files on export, and design tokens for
colour, type, radius and content width.

**Editing.** Click to select, click again to edit text in place, drag to move,
⌘D to duplicate, ⌘C/⌘V to copy, ⌥↑/⌥↓ to reorder, ⇧↑ to select the parent, and
undo across everything — typing counts as one step, not one per keystroke.
