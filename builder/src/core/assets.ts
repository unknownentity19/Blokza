/**
 * Uploaded images.
 *
 * The editor has no server, so an uploaded file has nowhere to go but the
 * document — and the document lives in `localStorage`, which is about 5 MB for
 * everything. A single photo off a phone is 3–6 MB, so storing what the user
 * picked would fill the quota with one upload and every later save would fail.
 *
 * So nothing is stored as picked. Every image is decoded, scaled to fit a sane
 * maximum, and re-encoded before it is ever put in the document, which turns
 * that phone photo into a couple of hundred kilobytes. A running budget refuses
 * the upload that would not fit, because refusing with a number is far better
 * than accepting it and silently breaking every save afterwards.
 *
 * Nodes refer to an asset by `asset:<id>` rather than by a data URL, so the
 * bytes appear exactly once however many places use the image, and the export
 * can write real files instead of megabytes of base64 inside the HTML.
 */

import { slugify, uid } from './ids';
import type { SiteDoc } from './types';

export interface Asset {
  id: string;
  /** Original filename, kept for the export path and the inspector. */
  name: string;
  /** MIME type of the *stored* bytes, which is not always what was uploaded. */
  type: string;
  width: number;
  height: number;
  /** Approximate stored size in bytes, so the budget needs no decoding. */
  bytes: number;
  /** `data:<type>;base64,<...>` */
  data: string;
}

const PREFIX = 'asset:';

/**
 * Longest edge, in CSS pixels, that any stored image is scaled down to.
 *
 * 1600 covers a full-width hero on a 2× display and is where the size curve
 * stops being worth it: past this, a document holds a handful of images before
 * the quota rather than dozens.
 */
export const MAX_EDGE = 1600;

/**
 * Ceiling on all assets in one document.
 *
 * Deliberately well under the ~5 MB `localStorage` gives an origin: the pages,
 * nodes and theme need room too, and JSON escaping of base64 costs more on top.
 */
export const ASSET_BUDGET = 3_000_000;

/** Reference stored on a node's `src`. */
export function assetRef(id: string): string {
  return `${PREFIX}${id}`;
}

/** The asset id inside a reference, or undefined if this is a plain URL. */
export function parseAssetRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : undefined;
}

export function assetList(doc: SiteDoc): Asset[] {
  return Object.values(doc.assets ?? {});
}

export function findAsset(doc: SiteDoc, id: string): Asset | undefined {
  return (doc.assets ?? {})[id];
}

export function assetBytes(doc: SiteDoc): number {
  return assetList(doc).reduce((total, asset) => total + asset.bytes, 0);
}

/** Where the export writes this asset. Ids keep two photo.jpg uploads apart. */
export function assetPath(asset: Asset): string {
  const ext = extensionFor(asset.type);
  const base = slugify(asset.name.replace(/\.[^.]+$/, ''), 'image');
  return `assets/${base}-${asset.id.slice(0, 6)}.${ext}`;
}

function extensionFor(type: string): string {
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  if (type === 'image/svg+xml') return 'svg';
  if (type === 'image/gif') return 'gif';
  return 'jpg';
}

/** The base64 payload of a data URL, for a binary write. */
export function assetBase64(asset: Asset): string {
  const comma = asset.data.indexOf(',');
  return comma === -1 ? '' : asset.data.slice(comma + 1);
}

/**
 * Every asset id referenced by any node, so the unreferenced ones can go.
 *
 * Deleting a node has to release its bytes or the budget only ever climbs, and
 * a user who removed an image would be told the document is full because of one
 * they cannot see. Reads props rather than a maintained index: a reference can
 * appear on any prop of any component, and an index would drift.
 */
export function referencedAssets(doc: SiteDoc): Set<string> {
  const used = new Set<string>();
  const scan = (value: unknown): void => {
    const id = parseAssetRef(value);
    if (id) used.add(id);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  for (const node of Object.values(doc.nodes)) scan(node.props);
  if (doc.favicon) scan(doc.favicon);
  return used;
}

/** Drop assets nothing points at. Returns how many went. */
export function pruneAssets(doc: SiteDoc): number {
  if (!doc.assets) return 0;
  const used = referencedAssets(doc);
  let removed = 0;
  for (const id of Object.keys(doc.assets)) {
    if (used.has(id)) continue;
    delete doc.assets[id];
    removed += 1;
  }
  return removed;
}

export interface ImportLimits {
  maxEdge?: number;
  budget?: number;
  /** Bytes already used, so the caller can charge against the live document. */
  used?: number;
}

export class AssetError extends Error {}

/** Bytes a base64 payload decodes to, without decoding it. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function humanSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/**
 * Turn a picked file into a stored asset.
 *
 * Vector and animated sources are kept byte-for-byte: putting an SVG through a
 * canvas would rasterise the one format that never needs it, and re-encoding a
 * GIF would keep the first frame and quietly throw the animation away. Only
 * raster stills are scaled and re-encoded.
 */
export async function importImageFile(
  file: File,
  limits: ImportLimits = {},
  deps: {
    decode?: (file: File) => Promise<{ width: number; height: number; draw: ImageBitmapSource }>;
    encode?: typeof encodeScaled;
  } = {},
): Promise<Asset> {
  const budget = limits.budget ?? ASSET_BUDGET;
  const used = limits.used ?? 0;

  if (!file.type.startsWith('image/')) {
    throw new AssetError(`${file.name} is not an image.`);
  }

  const passthrough = file.type === 'image/svg+xml' || file.type === 'image/gif';
  const encode = deps.encode ?? encodeScaled;
  const stored = passthrough
    ? await storeAsIs(file)
    : await encode(file, limits.maxEdge ?? MAX_EDGE);

  const remaining = budget - used;
  if (stored.bytes > remaining) {
    // "after resizing" only when it was resized. A vector file is stored as it
    // arrived, and telling someone their SVG is too big *after resizing* sends
    // them looking for a resize setting that does not apply to it.
    const sized = passthrough ? humanSize(stored.bytes) : `${humanSize(stored.bytes)} after resizing`;
    throw new AssetError(
      remaining <= 0
        ? `There is no room left for images (${humanSize(budget)} in total). Remove one first.`
        : `${file.name} is ${sized}, and only ${humanSize(remaining)} of the ` +
          `${humanSize(budget)} image budget is left.`,
    );
  }

  return { id: uid(), name: file.name, ...stored };
}

async function readDataUrl(file: File | Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new AssetError('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

type Stored = Omit<Asset, 'id' | 'name'>;

async function storeAsIs(file: File): Promise<Stored> {
  const data = await readDataUrl(file);
  return { type: file.type, width: 0, height: 0, bytes: base64Bytes(assetBase64({ data } as Asset)), data };
}

/**
 * Decode, scale to fit `maxEdge`, and re-encode.
 *
 * WebP where the browser has it, JPEG otherwise, and the smaller of the two
 * results is kept — WebP usually wins by a wide margin but loses on flat
 * graphics, and there is no reason to store the bigger one. Transparency forces
 * PNG, because a JPEG would fill it with black.
 */
export async function encodeScaled(file: File, maxEdge: number): Promise<Stored> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AssetError('This browser cannot resize images.');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const keepAlpha = file.type === 'image/png' && hasTransparency(ctx, width, height);
  const candidates = keepAlpha
    ? [canvas.toDataURL('image/png')]
    : [canvas.toDataURL('image/webp', 0.82), canvas.toDataURL('image/jpeg', 0.85)];

  // `toDataURL` falls back to PNG for a format it cannot encode, so the winner
  // is chosen by measured size rather than by assuming WebP exists.
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.length < best.length) best = candidate;
  }

  const type = best.slice(5, best.indexOf(';'));
  return { type, width, height, bytes: base64Bytes(best.slice(best.indexOf(',') + 1)), data: best };
}

/** Any pixel below fully opaque means an alpha channel has to survive. */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* Safari has refused some types here; the <img> path below still works. */
    }
  }
  const url = await readDataUrl(file);
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new AssetError(`${file.name} could not be decoded as an image.`));
    img.src = url;
  });
  return img;
}
