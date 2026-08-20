/**
 * Persistence.
 *
 * Everything lives in `localStorage` — there is no server. That makes two things
 * important: writes must be cheap enough to run on every edit (so they are
 * debounced and the payload is one JSON blob), and a corrupt or foreign payload
 * must never take the editor down. `load` therefore validates the shape,
 * repairs what it can, and falls back to a fresh document rather than throwing.
 */

import { createEmptyDoc, insertSubtree, repairDoc } from './doc';
import { spawnPreset } from './factory';
import { LEGACY_STORAGE_KEYS, migrateLegacyState } from './migrate';
import { DOC_VERSION, type DeviceId, type SiteDoc } from './types';

export const STORAGE_KEY = 'altask:builder:v3';

/** UI state worth restoring, kept out of the document so it never enters undo. */
export interface UiPrefs {
  currentPageId?: string;
  device?: DeviceId;
  zoom?: number;
  /** Whether the canvas is auto-fitting rather than pinned to `zoom`. */
  zoomToFit?: boolean;
}

interface Envelope {
  version: number;
  doc: SiteDoc;
  ui?: UiPrefs;
  savedAt: number;
}

export interface LoadResult {
  doc: SiteDoc;
  ui: UiPrefs;
  /** Non-fatal problems worth telling the user about. */
  notices: string[];
  source: 'storage' | 'legacy' | 'new';
}

function isDoc(value: unknown): value is SiteDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<SiteDoc>;
  return (
    Array.isArray(doc.pages) &&
    doc.pages.length > 0 &&
    typeof doc.nodes === 'object' &&
    doc.nodes !== null &&
    typeof doc.theme === 'object' &&
    doc.theme !== null
  );
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function save(doc: SiteDoc, ui: UiPrefs): void {
  const envelope: Envelope = { version: DOC_VERSION, doc, ui, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (error) {
    // Quota exceeded, private-mode restrictions, or a disabled storage API.
    // The editor keeps working from memory; the caller surfaces the warning.
    if (typeof console !== 'undefined') console.warn('[altask] could not save', error);
    throw error;
  }
}

/** Debounced saver. One instance per app; `flush` is wired to `beforeunload`. */
export function createSaver(delay = 600): {
  schedule: (doc: SiteDoc, ui: UiPrefs) => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { doc: SiteDoc; ui: UiPrefs } | undefined;

  const write = () => {
    timer = undefined;
    if (!pending) return;
    const { doc, ui } = pending;
    pending = undefined;
    try {
      save(doc, ui);
    } catch {
      /* already logged */
    }
  };

  return {
    schedule(doc, ui) {
      pending = { doc, ui };
      if (timer === undefined) timer = setTimeout(write, delay);
    },
    flush: write,
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

export function load(): LoadResult {
  const notices: string[] = [];

  const stored = readJson(STORAGE_KEY);
  if (stored && typeof stored === 'object') {
    const envelope = stored as Partial<Envelope>;
    if (isDoc(envelope.doc)) {
      const doc = envelope.doc;
      doc.version = DOC_VERSION;
      const repaired = repairDoc(doc);
      if (repaired > 0) notices.push(`Repaired ${repaired} inconsistencies in the saved document.`);
      return { doc, ui: envelope.ui ?? {}, notices, source: 'storage' };
    }
    notices.push('The saved project could not be read, so a new one was started.');
  }

  // Nothing in the new format — try the previous editor's state.
  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = readJson(key);
    const migrated = migrateLegacyState(legacy);
    if (!migrated) continue;

    const doc = createEmptyDoc(migrated.name);
    const rootId = doc.pages[0].rootId;
    for (const tree of migrated.trees) {
      const spawned = spawnPreset(tree);
      if (spawned) insertSubtree(doc, spawned.nodes, spawned.rootId, rootId, doc.nodes[rootId].children.length);
    }
    notices.push('Imported your page from the previous editor.');
    if (migrated.skipped.length) {
      notices.push(`Could not convert: ${migrated.skipped.join(', ')}.`);
    }
    return { doc, ui: {}, notices, source: 'legacy' };
  }

  return { doc: createEmptyDoc(), ui: {}, notices, source: 'new' };
}

export function clearStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Project files (import / export)                                     */
/* ------------------------------------------------------------------ */

export function serialiseProject(doc: SiteDoc): string {
  return JSON.stringify({ kind: 'altask-project', version: DOC_VERSION, doc }, null, 2);
}

/**
 * Parse a `.altask.json` file. Returns a message instead of throwing so the
 * caller can show it directly.
 */
export function parseProject(text: string): { doc: SiteDoc } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'That file does not contain a project.' };
  const candidate = (parsed as { doc?: unknown }).doc ?? parsed;
  if (!isDoc(candidate)) return { error: 'That file does not look like an Altask project.' };
  const doc = candidate as SiteDoc;
  doc.version = DOC_VERSION;
  repairDoc(doc);
  return { doc };
}
