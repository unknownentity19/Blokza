/**
 * Static site export.
 *
 * Produces exactly what a host needs and nothing else: one HTML file per page,
 * one stylesheet, a sitemap, and a robots.txt. Pages are rendered through the
 * same `RenderNode` the canvas uses (`renderToStaticMarkup`), so the export can
 * never drift from the preview.
 *
 * Links are flat filenames (`about.html`, not `/about/`) because those resolve
 * from a local folder, an S3 bucket, GitHub Pages and Netlify alike — a ZIP the
 * user can double-click and see working is worth more than pretty URLs.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { compileCss } from './css';
import { escapeHtml } from './sanitize';
import { formatHtml } from './format-html';
import { componentCss } from '../registry/registry';
import { makeContext, pageFileName, RenderPage } from '../render/RenderNode';
import type { Page, SiteDoc } from './types';

export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportResult {
  files: ExportFile[];
  /** Total size in bytes, for the confirmation toast. */
  bytes: number;
}

const STYLESHEET = 'styles.css';

/** Google Fonts families referenced by the theme, mapped to a single request. */
function fontLink(doc: SiteDoc): string {
  const stack = Object.values(doc.theme.fonts).join(' ');
  const families: string[] = [];
  const add = (name: string, spec: string) => {
    if (stack.includes(name)) families.push(spec);
  };
  add('Inter', 'Inter:wght@400;500;600;700');
  add('Fraunces', 'Fraunces:opsz,wght@9..144,400..900');
  add('Urbanist', 'Urbanist:wght@400;500;600;700;800');
  add('Playfair Display', 'Playfair+Display:wght@400;600;700');
  add('Manrope', 'Manrope:wght@400;500;600;700');
  add('JetBrains Mono', 'JetBrains+Mono:wght@400;500');
  if (!families.length) return '';
  const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
  return [
    '  <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
    `  <link rel="stylesheet" href="${escapeHtml(href)}" />`,
  ].join('\n');
}

function absoluteUrl(doc: SiteDoc, page: Page): string {
  const base = doc.siteUrl.replace(/\/+$/, '');
  const file = pageFileName(page.path);
  return file === 'index.html' ? `${base}/` : `${base}/${file}`;
}

function renderPageHtml(doc: SiteDoc, page: Page): string {
  const ctx = makeContext(doc, 'export');
  const body = formatHtml(renderToStaticMarkup(<RenderPage ctx={ctx} rootId={page.rootId} />), '    ');
  const title = page.title.trim() || page.name || doc.name;
  const description = page.description.trim();
  const canonical = absoluteUrl(doc, page);
  const social = page.socialImage?.trim();
  const fonts = fontLink(doc);

  const head = [
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    description ? `  <meta name="description" content="${escapeHtml(description)}" />` : '',
    `  <link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    description ? `  <meta property="og:description" content="${escapeHtml(description)}" />` : '',
    `  <meta property="og:url" content="${escapeHtml(canonical)}" />`,
    social ? `  <meta property="og:image" content="${escapeHtml(social)}" />` : '',
    `  <meta name="twitter:card" content="${social ? 'summary_large_image' : 'summary'}" />`,
    doc.favicon ? `  <link rel="icon" href="${escapeHtml(doc.favicon)}" />` : '',
    fonts,
    `  <link rel="stylesheet" href="${STYLESHEET}" />`,
  ]
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body>
${body}
</body>
</html>
`;
}

function sitemapXml(doc: SiteDoc): string {
  const entries = doc.pages
    .map(
      (page) =>
        `  <url>\n    <loc>${escapeHtml(absoluteUrl(doc, page))}</loc>\n    <lastmod>${new Date(page.updatedAt).toISOString().slice(0, 10)}</lastmod>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function robotsTxt(doc: SiteDoc): string {
  const base = doc.siteUrl.replace(/\/+$/, '');
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

/**
 * Build every file for the site.
 *
 * `EMPTY_SLOT_CSS` is intentionally *not* included — the drop-zone placeholder
 * is editor furniture, and `RenderNode` already omits it in export mode.
 */
export function buildExport(doc: SiteDoc): ExportResult {
  const css = compileCss(doc, { componentCss, includeReset: true });

  const files: ExportFile[] = [
    { path: STYLESHEET, content: css },
    ...doc.pages.map((page) => ({ path: pageFileName(page.path), content: renderPageHtml(doc, page) })),
    { path: 'sitemap.xml', content: sitemapXml(doc) },
    { path: 'robots.txt', content: robotsTxt(doc) },
  ];

  const bytes = files.reduce((total, file) => total + new Blob([file.content]).size, 0);
  return { files, bytes };
}

/** Single-page HTML with the stylesheet inlined — used by the preview overlay. */
export function buildStandalonePage(doc: SiteDoc, pageId: string): string {
  const page = doc.pages.find((candidate) => candidate.id === pageId) ?? doc.pages[0];
  const css = compileCss(doc, { componentCss, includeReset: true });
  const html = renderPageHtml(doc, page);
  return html.replace(
    `  <link rel="stylesheet" href="${STYLESHEET}" />`,
    `  <style>\n${css}\n  </style>`,
  );
}
