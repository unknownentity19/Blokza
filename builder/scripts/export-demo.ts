/**
 * Writes the demo site to disk exactly as Publish would.
 *
 * Used to check the published output of a realistic multi-page site — the thing
 * the editor exists to produce — without clicking through a download.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import '../src/registry';
import { useEditor } from '../src/store/editor';
import { buildExport } from '../src/core/export';
import { seedDemo } from '../src/dev/seedDemo';

const out = process.argv[2];
if (!out) throw new Error('usage: export-demo <dir>');

seedDemo();
const { files } = buildExport(useEditor.getState().doc);
mkdirSync(out, { recursive: true });
for (const file of files) {
  writeFileSync(join(out, file.path), file.content, 'utf8');
  console.log(`${file.path}  ${file.content.length} bytes`);
}
console.log(`\n${files.length} files, ${useEditor.getState().doc.pages.length} pages`);
