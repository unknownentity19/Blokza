/**
 * The single renderer.
 *
 * Both the canvas and the export go through this component, which is the only
 * way to guarantee that what the user arranges is what ships. The export path
 * feeds it to `renderToStaticMarkup`; the canvas path mounts it in a portal
 * inside the device iframe. `mode` is the only difference between the two.
 */

import { Fragment, type ReactNode } from 'react';
import { nodeClass, typeClass } from '../core/css';
import { SHARED_TYPE, sharedOfNode } from '../core/doc';
import { assetPath, findAsset, parseAssetRef } from '../core/assets';
import { safeHref } from '../core/sanitize';
import type { RenderMode, RootAttrs, SBNode, SiteDoc } from '../core/types';
import { getComponent } from '../registry/registry';

export interface RenderContext {
  doc: SiteDoc;
  mode: RenderMode;
  /** Maps a page path such as `/about` to the file the export writes. */
  pageHref: (path: string) => string;
  /**
   * Forces one node's subtree to remount.
   *
   * Inline editing lets the browser mutate a subtree React owns, so after a
   * session that actually changed the DOM, React's picture of those children is
   * stale. Bumping `n` changes the key and rebuilds it cleanly. Export never
   * sets this.
   */
  remount?: { id: string; n: number } | null;
  /**
   * Carry uploaded images inside the markup instead of pointing at the files
   * the export writes.
   *
   * For the one-file preview, which has no `assets/` folder beside it. Without
   * it every uploaded image was blank in Preview — the one place someone looks
   * to check their work before publishing, so it read as the upload having
   * failed. Same reason the standalone page inlines the stylesheet.
   */
  inlineAssets?: boolean;
}

/** Filename for a page path in the exported site. Flat files keep `file://` working. */
export function pageFileName(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}.html` : 'index.html';
}

export function makeContext(
  doc: SiteDoc,
  mode: RenderMode,
  remount?: { id: string; n: number } | null,
  options: { inlineAssets?: boolean } = {},
): RenderContext {
  const byPath = new Map(doc.pages.map((page) => [page.path, page]));
  return {
    doc,
    mode,
    remount,
    inlineAssets: options.inlineAssets === true,
    pageHref: (path: string) => {
      const page = byPath.get(path);
      return page ? pageFileName(page.path) : safeHref(path);
    },
  };
}

/**
 * `asset:<id>` becomes something the current mode can load.
 *
 * On the canvas that is the stored data URL. In the export it is the file path
 * the asset is written to, so the page loads a real image instead of carrying
 * a few hundred kilobytes of base64 inline — which would also be duplicated
 * into every page that used it.
 *
 * A reference with no asset behind it resolves to empty rather than to the
 * literal string, so the image component falls back to its placeholder instead
 * of asking the browser to fetch `asset:abc123`.
 *
 * Sanitising happens here, because this is the only place that knows where the
 * URL came from. A pasted URL is untrusted and goes through `safeHref`; the
 * data URL and the export path are ours. Leaving it to the component meant the
 * export path — a bare relative filename, which `safeHref` does not allow —
 * came out as `#`, and every uploaded image in a published site was blank.
 */
function resolveAssetFor(ctx: RenderContext) {
  return (value: unknown): string => {
    const id = parseAssetRef(value);
    if (id === undefined) {
      const raw = typeof value === 'string' ? value.trim() : '';
      return raw ? safeHref(raw) : '';
    }
    const asset = findAsset(ctx.doc, id);
    if (!asset) return '';
    const asFile = ctx.mode === 'export' && !ctx.inlineAssets;
    return asFile ? assetPath(asset) : asset.data;
  };
}

function resolveHrefFor(ctx: RenderContext) {
  return (value: unknown): string => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '#';
    // Internal links are stored as page paths and rewritten at export time so a
    // multi-page site keeps working from a folder, a bucket, or any host.
    if (raw.startsWith('/')) {
      const page = ctx.doc.pages.find((candidate) => candidate.path === raw);
      if (page) return ctx.mode === 'export' ? pageFileName(page.path) : raw;
    }
    return safeHref(raw);
  };
}

function attrsFor(node: SBNode, mode: RenderMode): RootAttrs {
  const classes = [typeClass(node.type), nodeClass(node.id)];
  if (mode === 'canvas' && node.hidden) classes.push('sb-hidden');
  const attrs: RootAttrs = { className: classes.join(' ') };
  // Emitted in both modes: the canvas must scroll to an anchor exactly like the
  // exported page does, or in-page links cannot be tested before publishing.
  if (node.anchorId) attrs.id = node.anchorId;
  if (mode === 'canvas') {
    // Hit-testing and drag hooks. Stripped from the export entirely.
    attrs['data-node-id'] = node.id;
    attrs['data-node-type'] = node.type;
  }
  return attrs;
}

export function RenderNode({ ctx, id }: { ctx: RenderContext; id: string }): ReactNode {
  const node = ctx.doc.nodes[id];
  if (!node) return null;

  // Hidden nodes are an editor-time concept: they never reach the export.
  if (node.hidden && ctx.mode === 'export') return null;

  /*
   * A shared node is a reference, not content: render the master's tree in its
   * place. The rendered elements carry the *master's* node ids, which is what
   * makes editing a shared nav from any page edit the one real copy.
   */
  if (node.type === SHARED_TYPE) {
    const shared = sharedOfNode(ctx.doc, node.id);
    if (!shared) {
      return ctx.mode === 'export' ? null : (
        <div className="sb-unknown" data-node-id={node.id}>
          This shared section no longer exists.
        </div>
      );
    }
    return <RenderNode ctx={ctx} id={shared.rootId} />;
  }

  const def = getComponent(node.type);
  if (!def) {
    if (ctx.mode === 'export') return null;
    return (
      <div className="sb-unknown" data-node-id={node.id}>
        Unknown component: {node.type}
      </div>
    );
  }

  const children = node.children.length
    ? node.children.map((childId) => <RenderNode key={childId} ctx={ctx} id={childId} />)
    : undefined;

  return (
    <Fragment key={ctx.remount?.id === node.id ? `${node.id}#${ctx.remount.n}` : undefined}>
      {def.render({
        node,
        props: node.props,
        attrs: attrsFor(node, ctx.mode),
        children,
        mode: ctx.mode,
        resolveHref: resolveHrefFor(ctx),
        resolveAsset: resolveAssetFor(ctx),
      })}
    </Fragment>
  );
}

/** Renders one page's whole tree. */
export function RenderPage({ ctx, rootId }: { ctx: RenderContext; rootId: string }): ReactNode {
  return <RenderNode ctx={ctx} id={rootId} />;
}
