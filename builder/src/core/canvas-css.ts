/**
 * The canvas stylesheet.
 *
 * Separate from `core/export.tsx` on purpose: that module imports
 * `react-dom/server`, and the canvas needs styles on first paint. Keeping them
 * apart means the server renderer only loads when the user previews or
 * publishes, instead of sitting in the bundle everyone waits for.
 */

import { compileCss } from './css';
import { componentCss } from '../registry/registry';
import { EMPTY_SLOT_CSS } from '../registry/helpers';
import type { SiteDoc } from './types';

/** Canvas stylesheet: the site's CSS plus the editor-only affordances. */
export function buildCanvasCss(doc: SiteDoc): string {
  return `${compileCss(doc, { componentCss, includeReset: true })}\n${EMPTY_SLOT_CSS}\n${CANVAS_ONLY_CSS}`;
}

/**
 * Styles that exist only while editing. Kept here next to `buildCanvasCss` so
 * it is obvious they never reach `buildExport`.
 */
const CANVAS_ONLY_CSS = `/*
 * The page root must fill the frame, or the only droppable area on an empty page
 * is the 64px strip its placeholder occupies. \`min-height: 100%\` on the root
 * cannot do this alone: a percentage height resolves against the parent's
 * *definite* height, and \`body\` has none by default — so the chain has to be
 * established explicitly. This is canvas-only; the export leaves document height
 * to the content, where the body background covers any short page.
 */
html, body { height: 100%; }
body > .c-page-root { min-height: 100%; }
/*
 * On an empty page the placeholder *is* the drop target, so it has to be the size
 * of the frame. \`flex: 1\` does not do it: the root's height comes from
 * min-height while its used height stays auto, so the flex layout has no free
 * space to distribute. The frame's viewport is the device viewport, which makes
 * \`vh\` exactly the right unit here.
 */
body > .c-page-root > .sb-empty { min-height: 100vh; }
body { cursor: default; }
.sb-hidden { opacity: 0.35; outline: 1px dashed rgba(122, 95, 229, 0.5); outline-offset: -1px; }
.sb-unknown {
  padding: 16px;
  border: 1px dashed #d0433a;
  border-radius: 4px;
  background: #fff3f2;
  color: #b3271e;
  font: 500 13px/1.4 var(--font-body, system-ui);
}
/* Empty containers still need a target the pointer can find. */
.c-section:empty, .c-container:empty, .c-stack:empty, .c-row:empty, .c-grid:empty, .c-card:empty {
  min-height: 72px;
}
/* Text selection inside the canvas belongs to inline editing only. */
[data-node-id] { -webkit-user-select: none; user-select: none; }
[contenteditable="true"] { -webkit-user-select: text; user-select: text; outline: none; cursor: text; }
`;
