/**
 * Bundles the export into a ZIP.
 *
 * JSZip is imported lazily: it is ~100kB and only needed when someone actually
 * publishes, so it should not be in the bundle that has to load before the
 * editor is usable.
 */

import { buildExport } from './export';
import { downloadBlob } from './download';
import { slugify } from './ids';
import type { SiteDoc } from './types';

export interface ZipResult {
  filename: string;
  files: number;
  bytes: number;
}

export async function downloadSiteZip(doc: SiteDoc): Promise<ZipResult> {
  const { default: JSZip } = await import('jszip');
  const { files, bytes } = buildExport(doc);

  const zip = new JSZip();
  // Uploaded images arrive as base64 and have to be told apart from text, or
  // JSZip stores the base64 *characters* and every exported image is corrupt.
  for (const file of files) zip.file(file.path, file.content, { base64: file.base64 === true });

  // A README earns its place here: the ZIP is the hand-off, and "which file do I
  // open" plus "how do I host this" are the only two questions it gets asked.
  zip.file('README.txt', readme(doc, files.map((file) => file.path)));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const filename = `${slugify(doc.name, 'site')}.zip`;
  downloadBlob(filename, blob);
  return { filename, files: files.length, bytes };
}

function readme(doc: SiteDoc, paths: string[]): string {
  const pages = paths.filter((path) => path.endsWith('.html'));
  return `${doc.name}
${'='.repeat(doc.name.length)}

Exported from the Cilbs builder.

Contents
--------
${paths.map((path) => `  ${path}`).join('\n')}

Viewing it locally
------------------
Open index.html in a browser. Every link between pages is a relative filename,
so it works straight from this folder with no server.

Hosting it
----------
Upload the whole folder as-is. It is plain HTML and CSS with no build step, so
it works on Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3, or any static
host. Point the host's publish directory at this folder.

Pages: ${pages.length}
Stylesheet: styles.css (one file, all pages)
Generated: ${new Date(doc.updatedAt).toISOString()}
`;
}
