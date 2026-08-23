/**
 * Uploaded images.
 *
 * The interesting behaviour is all about limits and lifetimes, none of which is
 * visible by using the feature once: an image that fits, an image that does
 * not, and an image whose node was deleted look identical until a document is
 * near the storage quota — at which point the failure is that saving silently
 * stops. So the budget, the pruning and the export path are tested directly
 * rather than through the DOM.
 */

import { describe, expect, it, vi } from 'vitest';

import '../src/registry';
import {
  ASSET_BUDGET,
  AssetError,
  assetBase64,
  assetBytes,
  assetPath,
  assetRef,
  base64Bytes,
  importImageFile,
  parseAssetRef,
  pruneAssets,
  type Asset,
} from '../src/core/assets';
import { buildExport, buildStandalonePage } from '../src/core/export';
import { createEmptyDoc, insertSubtree } from '../src/core/doc';
import { spawnPreset } from '../src/core/factory';
import { createSaver, saveErrorMessage } from '../src/core/storage';
import type { SiteDoc } from '../src/core/types';

/** A file whose stored form is a fixed number of bytes, so budgets are exact. */
function fakeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return { name, type } as File;
}

/** Base64 of the given byte count, near enough for size arithmetic. */
function payload(bytes: number): string {
  return 'A'.repeat(Math.ceil(bytes / 3) * 4);
}

function encoderOf(bytes: number, type = 'image/webp') {
  return vi.fn(async () => ({
    type,
    width: 1200,
    height: 800,
    bytes,
    data: `data:${type};base64,${payload(bytes)}`,
  }));
}

function docWithImage(src: string): SiteDoc {
  const doc = createEmptyDoc('Assets');
  const spawned = spawnPreset({ type: 'image', props: { src, alt: 'A photo' } });
  if (!spawned) throw new Error('no image');
  insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
  return doc;
}

const asset = (id: string, bytes: number): Asset => ({
  id,
  name: 'photo.jpg',
  type: 'image/webp',
  width: 1200,
  height: 800,
  bytes,
  data: `data:image/webp;base64,${payload(bytes)}`,
});

describe('asset references', () => {
  it('round-trips an id', () => {
    expect(parseAssetRef(assetRef('abc123'))).toBe('abc123');
  });

  it('leaves an ordinary URL alone, so pasted links keep working', () => {
    expect(parseAssetRef('https://example.com/a.png')).toBeUndefined();
    expect(parseAssetRef('/assets/local.png')).toBeUndefined();
    expect(parseAssetRef(undefined)).toBeUndefined();
  });

  it('measures base64 without decoding it', () => {
    expect(base64Bytes('AAAA')).toBe(3);
    expect(base64Bytes('AAA=')).toBe(2);
    expect(base64Bytes('AA==')).toBe(1);
  });
});

describe('the storage budget', () => {
  it('accepts an image that fits', async () => {
    const stored = await importImageFile(fakeFile(), {}, { encode: encoderOf(200_000) });
    expect(stored.bytes).toBe(200_000);
    expect(stored.name).toBe('photo.jpg');
  });

  /**
   * The case that protects the document. `localStorage` is a few megabytes for
   * everything, so accepting an image that does not fit does not fail loudly —
   * it makes every later save throw, and the editor carries on looking normal
   * while the work stops being written.
   */
  it('refuses an image that would not fit, naming the sizes', async () => {
    const error = await importImageFile(
      fakeFile('huge.jpg'),
      { used: ASSET_BUDGET - 50_000 },
      { encode: encoderOf(400_000) },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AssetError);
    const message = (error as AssetError).message;
    expect(message).toContain('huge.jpg');
    // The number is the point: "too big" gives the user nothing to act on.
    expect(message).toMatch(/\d/);
  });

  it('charges against what is already stored, not against each file alone', async () => {
    const encode = encoderOf(1_200_000);
    await expect(importImageFile(fakeFile(), { used: 0 }, { encode })).resolves.toBeDefined();
    await expect(
      importImageFile(fakeFile(), { used: 2_400_000 }, { encode }),
    ).rejects.toBeInstanceOf(AssetError);
  });

  it('rejects a file that is not an image before doing any work', async () => {
    const encode = encoderOf(1000);
    await expect(
      importImageFile({ name: 'notes.pdf', type: 'application/pdf' } as File, {}, { encode }),
    ).rejects.toBeInstanceOf(AssetError);
    expect(encode).not.toHaveBeenCalled();
  });

  it('sums what a document holds', () => {
    const doc = createEmptyDoc('S');
    doc.assets = { a: asset('a', 100), b: asset('b', 250) };
    expect(assetBytes(doc)).toBe(350);
  });
});

describe('releasing unused images', () => {
  it('keeps an image a node still points at', () => {
    const doc = docWithImage(assetRef('keep'));
    doc.assets = { keep: asset('keep', 100) };
    expect(pruneAssets(doc)).toBe(0);
    expect(doc.assets.keep).toBeDefined();
  });

  /**
   * Without this the budget only ever climbs, and a user who deleted a photo is
   * told there is no room for images they can no longer see anywhere.
   */
  it('drops an image nothing points at any more', () => {
    const doc = docWithImage('');
    doc.assets = { orphan: asset('orphan', 100) };
    expect(pruneAssets(doc)).toBe(1);
    expect(doc.assets.orphan).toBeUndefined();
    expect(assetBytes(doc)).toBe(0);
  });

  it('finds a reference nested inside a repeated field', () => {
    const doc = createEmptyDoc('S');
    const root = doc.nodes[doc.pages[0].rootId];
    root.props.items = [{ image: assetRef('deep') }, { image: '' }];
    doc.assets = { deep: asset('deep', 100) };
    expect(pruneAssets(doc)).toBe(0);
  });

  it('counts the favicon as a reference', () => {
    const doc = createEmptyDoc('S');
    doc.favicon = assetRef('icon');
    doc.assets = { icon: asset('icon', 100) };
    expect(pruneAssets(doc)).toBe(0);
  });
});

describe('the exported site', () => {
  it('writes the image as a real file, not base64 in the markup', () => {
    const doc = docWithImage(assetRef('pic'));
    doc.assets = { pic: asset('pic', 4000) };

    const { files } = buildExport(doc);
    const image = files.find((file) => file.base64);
    expect(image).toBeDefined();
    expect(image?.path).toBe(assetPath(doc.assets.pic));
    expect(image?.content).toBe(assetBase64(doc.assets.pic));

    const html = files.find((file) => file.path === 'index.html')?.content ?? '';
    expect(html).toContain(assetPath(doc.assets.pic));
    expect(html).not.toContain('data:image/webp');
    expect(html).not.toContain('asset:pic');
  });

  it('leaves behind an image no node points at', () => {
    const doc = docWithImage('');
    doc.assets = { gone: asset('gone', 4000) };
    // Deliberately not pruned first: the export must not publish a picture the
    // user believes they deleted, whether or not the document has been tidied.
    expect(buildExport(doc).files.some((file) => file.base64)).toBe(false);
  });

  it('counts image bytes in the export size rather than the base64 length', () => {
    const doc = docWithImage(assetRef('pic'));
    doc.assets = { pic: asset('pic', 90_000) };
    const withImage = buildExport(doc).bytes;
    const withoutImage = buildExport(docWithImage('')).bytes;
    // Base64 is 4/3 the size, so measuring the string would overstate by ~30 kB.
    expect(withImage - withoutImage).toBeGreaterThan(80_000);
    expect(withImage - withoutImage).toBeLessThan(100_000);
  });
});

describe('a save that fails', () => {
  it('reports the first failure and stays quiet until one succeeds', () => {
    const onError = vi.fn();
    const saver = createSaver(0, onError);
    const doc = createEmptyDoc('S');

    const quota = new DOMException('over', 'QuotaExceededError');
    // A flag rather than restore-and-remock: `mockRestore` detaches the spy for
    // good, so re-arming it afterwards silently does nothing.
    let broken = true;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      if (broken) throw quota;
    });

    saver.schedule(doc, {});
    saver.flush();
    saver.schedule(doc, {});
    saver.flush();
    // Two failed writes, one message: the point is to be heard, not to nag.
    expect(onError).toHaveBeenCalledTimes(1);

    broken = false;
    saver.schedule(doc, {});
    saver.flush();
    broken = true;
    saver.schedule(doc, {});
    saver.flush();
    // Recovered, then broke again — that is worth saying a second time.
    expect(onError).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('explains a quota failure in terms of what to do about it', () => {
    const message = saveErrorMessage(new DOMException('over', 'QuotaExceededError'));
    expect(message).toMatch(/storage/i);
    expect(message).toMatch(/not being saved|no longer being saved/i);
  });
});

/**
 * The preview is where someone checks their work before publishing, so an
 * uploaded image being blank there is worse than it being blank in the export:
 * it teaches them the upload did not work.
 *
 * The standalone page is rendered in export mode, which points images at the
 * files the ZIP will contain — files that do not exist beside a single inlined
 * page. It has to inline them, for exactly the reason it already inlines the
 * stylesheet.
 */
describe('the standalone preview page', () => {
  it('inlines an uploaded image rather than linking a file that is not there', () => {
    const doc = docWithImage(assetRef('pic'));
    doc.assets = { pic: asset('pic', 4000) };

    const html = buildStandalonePage(doc, doc.pages[0].id);
    expect(html).toContain(doc.assets.pic.data);
    expect(html).not.toContain(assetPath(doc.assets.pic));
  });

  it('still inlines the site stylesheet, so the page needs no local file', () => {
    const doc = docWithImage('');
    const html = buildStandalonePage(doc, doc.pages[0].id);
    // The font link is a stylesheet link too and belongs here; what must not
    // survive is the reference to `styles.css`, which is not beside the page.
    expect(html).not.toContain('href="styles.css"');
    expect(html).toContain('<style>');
  });
});
