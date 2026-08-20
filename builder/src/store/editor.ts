/**
 * The editor store.
 *
 * Two halves that never mix:
 *   - `doc` is the document. Every change to it goes through `commit`, which
 *     snapshots the previous value for undo. Immer gives structural sharing, so
 *     a hundred snapshots of a large document cost far less than a hundred deep
 *     copies.
 *   - everything else is UI state (selection, zoom, which panel is open). None
 *     of it is undoable, because undoing a *selection* is never what anyone
 *     means when they press ⌘Z.
 */

import { create } from 'zustand';
import { produce } from 'immer';

import {
  SHARED_TYPE,
  addPage as docAddPage,
  addSharedInstance,
  findShared,
  inlineShared as docInlineShared,
  makeShared as docMakeShared,
  pageOfNode,
  removeShared as docRemoveShared,
  sharedList,
  clearStyleLayer,
  createEmptyDoc,
  duplicateNode as docDuplicate,
  duplicatePage as docDuplicatePage,
  findPage,
  insertSubtree,
  moveNode as docMoveNode,
  movePage as docMovePage,
  normalisePath,
  removeNode as docRemoveNode,
  removePage as docRemovePage,
  renameNode as docRenameNode,
  setAnchorId as docSetAnchorId,
  setNodeFlag,
  setProps,
  setPropPath,
  setStyle,
  structureSignature,
  wrapNode,
  type StyleLayer,
} from '../core/doc';
import { slugify } from '../core/ids';
import { nodeLabel, spawnComponent, spawnPreset, spawnTemplate } from '../core/factory';
import { navRowOf, pageEdges } from '../core/sitemap';
import { paletteById } from '../registry/palettes';
import { ancestorsOf, canDrop, canMutate, indexOf, selectableAncestor } from '../core/tree';
import { breakpointForDevice, clampZoom, deviceById, nextZoom } from '../core/devices';
import { createSaver, load, type UiPrefs } from '../core/storage';
import { dropRules, getComponent } from '../registry/registry';
import type { Template } from '../registry/templates';
import type {
  Breakpoint,
  DeviceId,
  DragPayload,
  DropTarget,
  InspectorTabId,
  LeftPanelId,
  PresetChild,
  SBNode,
  SiteDoc,
  StyleKey,
  StyleState,
  ViewId,
} from '../core/types';

const HISTORY_LIMIT = 100;
/** Most toasts on screen at once. */
const TOAST_LIMIT = 3;
/** Successive edits with the same key inside this window share one undo step. */
const COALESCE_MS = 700;

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export interface DragState {
  payload: DragPayload;
  /**
   * Set when the drag came from a section card. The payload still describes the
   * template's *root* component type, so `canDrop` validates the thing that will
   * actually be inserted; this carries the tree to build on release.
   */
  template?: Template;
  /** Pointer position in frame coordinates (CSS px inside the device iframe). */
  point: { x: number; y: number };
  /** Where the gesture began, in client coordinates. */
  origin: { x: number; y: number };
  /** False until the pointer has moved far enough to count as a drag. */
  active: boolean;
  target: DropTarget | null;
  /** Why the current position is not a valid drop, for the cursor hint. */
  rejection?: string;
}

interface CommitOptions {
  /** Merge into the previous undo step when it shares this key and is recent. */
  coalesce?: string;
  /** Selection to apply after the change. `undefined` leaves it alone. */
  select?: string | null;
  /** Skip the undo snapshot entirely (used by undo/redo themselves). */
  noHistory?: boolean;
}

export interface EditorState {
  doc: SiteDoc;
  past: SiteDoc[];
  future: SiteDoc[];
  lastCommit: { key: string; at: number } | null;

  currentPageId: string;
  selectedId: string | null;
  hoverId: string | null;

  /** Which workspace is on screen: the page designer, or the site map. */
  view: ViewId;
  device: DeviceId;
  zoom: number;
  zoomToFit: boolean;
  leftPanel: LeftPanelId | null;
  inspectorTab: InspectorTabId;
  /**
   * The node the user last chose a tab for.
   *
   * Without this the inspector either ignores what you clicked (always opening
   * on the same tab) or overrides you every time the selection changes. Pinning
   * the choice to one node means a manual switch sticks while you work on that
   * element, and the panel opens where the useful controls are for the next one.
   */
  tabPinnedFor: string | null;
  /** Collapsed to a strip, so the canvas can have the full width. */
  inspectorOpen: boolean;
  /** `null` means "edit the plain state"; `'hover'` edits the hover bag. */
  styleState: StyleState | null;

  /**
   * The active inline text edit.
   *
   * `caretAt` is the frame-space point the user clicked, so the caret can land
   * where they aimed instead of selecting the whole slot. `selectAll` is the
   * double-click intent — replace the lot.
   */
  editing: {
    nodeId: string;
    key: string;
    caretAt?: { x: number; y: number };
    selectAll?: boolean;
  } | null;
  /**
   * True while the canvas link popover has focus.
   *
   * Its text field has to take focus to be typed into, which blurs the element
   * being edited — and blur commits and ends the session, unmounting the very
   * toolbar the user is using. The edit session holds open while this is set.
   */
  linkPopoverOpen: boolean;
  drag: DragState | null;
  previewOpen: boolean;
  clipboard: PresetChild | null;
  toasts: Toast[];
  saveError: string | null;

  /* derived */
  breakpoint: () => Breakpoint;
  styleLayer: () => StyleLayer;
  pageRootId: () => string;
  selectedNode: () => SBNode | undefined;

  /* document */
  commit: (recipe: (doc: SiteDoc) => void, options?: CommitOptions) => void;
  undo: () => void;
  redo: () => void;
  replaceDoc: (doc: SiteDoc, message?: string) => void;
  resetDoc: () => void;

  /* selection */
  select: (id: string | null) => void;
  selectParent: () => void;
  setHover: (id: string | null) => void;

  /* insertion + structure */
  insertPayload: (payload: DragPayload, parentId: string, index: number) => string | undefined;
  insertComponent: (type: string) => void;
  insertTemplate: (template: Template) => void;
  insertTemplateAt: (template: Template, parentId: string, index: number) => string | undefined;
  moveTo: (nodeId: string, parentId: string, index: number) => void;
  remove: (id?: string) => void;
  duplicate: (id?: string) => void;
  wrapInContainer: (id?: string) => void;
  copy: (id?: string) => void;
  paste: () => void;
  reorderSibling: (id: string, delta: number) => void;

  /* node data */
  setProp: (nodeId: string, key: string, value: unknown, coalesce?: boolean) => void;
  setStyleValue: (nodeId: string, key: StyleKey, value: string | null, coalesce?: boolean) => void;
  clearLayer: (nodeId: string, layer?: StyleLayer) => void;
  rename: (nodeId: string, name: string) => void;
  toggleFlag: (nodeId: string, flag: 'hidden' | 'locked') => void;
  setAnchor: (nodeId: string, value: string) => void;

  /* pages */
  addPage: () => void;
  selectPage: (pageId: string) => void;
  updatePage: (pageId: string, patch: { name?: string; path?: string; title?: string; description?: string; socialImage?: string }) => void;
  deletePage: (pageId: string) => void;
  duplicatePage: (pageId: string) => void;
  movePage: (pageId: string, toIndex: number) => void;
  setPagePosition: (pageId: string, x: number, y: number) => void;
  /** Turn the selected section into one shared by every page. */
  shareSection: (nodeId?: string) => void;
  /** Give this page its own private copy again. */
  unshareSection: (nodeId?: string) => void;
  /** Add an existing shared section to the current page. */
  addSharedToPage: (sharedId: string) => void;
  removeSharedEverywhere: (sharedId: string) => void;
  /**
   * Adds a nav link on `fromPageId` pointing at `toPageId` — the site map's
   * connect gesture. Lands in the page's nav bar when it has one, so the link
   * shows up where a visitor would expect rather than at the end of the page.
   */
  connectPages: (fromPageId: string, toPageId: string) => boolean;
  disconnectPages: (fromPageId: string, toPageId: string) => void;

  /* site + theme */
  setSiteName: (name: string) => void;
  setSiteUrl: (url: string) => void;
  setThemeFont: (slot: 'heading' | 'body' | 'mono', value: string) => void;
  setThemeColor: (index: number, patch: { name?: string; value?: string }) => void;
  addThemeColor: () => void;
  removeThemeColor: (index: number) => void;
  setThemeScalar: (key: 'radius' | 'maxWidth', value: string) => void;
  /**
   * Swap the whole palette in one undoable step.
   *
   * Existing token names are preserved and their values overwritten, so every
   * element already pointing at `var(--color-brand)` restyles itself. Tokens the
   * user added by hand are left alone — a preset should not delete their work.
   */
  applyPalette: (paletteId: string) => void;
  setCustomCss: (css: string) => void;

  /* ui */
  setView: (view: ViewId) => void;
  setDevice: (device: DeviceId) => void;
  setZoom: (zoom: number) => void;
  stepZoom: (direction: 1 | -1) => void;
  setZoomToFit: (on: boolean) => void;
  setLeftPanel: (panel: LeftPanelId | null) => void;
  setInspectorTab: (tab: InspectorTabId) => void;
  setInspectorOpen: (open: boolean) => void;
  setStyleState: (state: StyleState | null) => void;
  beginEdit: (
    nodeId: string,
    key: string,
    options?: { caretAt?: { x: number; y: number }; selectAll?: boolean },
  ) => void;
  setLinkPopoverOpen: (open: boolean) => void;
  endEdit: () => void;
  startDrag: (payload: DragPayload, origin: { x: number; y: number }, template?: Template) => void;
  updateDrag: (patch: Partial<DragState>) => void;
  endDrag: () => void;
  setPreview: (open: boolean) => void;
  toast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

const saver = createSaver();
let toastId = 0;

const initial = load();

function uiPrefs(state: EditorState): UiPrefs {
  return {
    currentPageId: state.currentPageId,
    device: state.device,
    zoom: state.zoom,
    zoomToFit: state.zoomToFit,
  };
}

/** Page id to open on boot, falling back to the first page if it is gone. */
function initialPageId(doc: SiteDoc, ui: UiPrefs): string {
  return ui.currentPageId && doc.pages.some((p) => p.id === ui.currentPageId)
    ? ui.currentPageId
    : doc.pages[0].id;
}

export const useEditor = create<EditorState>((set, get) => {
  /** Persist after any change. Debounced inside the saver. */
  const persist = () => {
    const state = get();
    saver.schedule(state.doc, uiPrefs(state));
  };

  /**
   * Where a click-to-insert should land: inside the selection when it can hold
   * children, otherwise directly after it, otherwise at the end of the page.
   */
  const insertionPoint = (payload: DragPayload): { parentId: string; index: number } => {
    const { doc, selectedId } = get();
    const rootId = get().pageRootId();
    if (selectedId && doc.nodes[selectedId]) {
      if (canDrop(doc.nodes, dropRules, payload, selectedId).ok) {
        return { parentId: selectedId, index: doc.nodes[selectedId].children.length };
      }
      // Walk up until something accepts it — a heading selected inside a card
      // should insert as the card's next child, not at the bottom of the page.
      for (const ancestorId of [selectedId, ...ancestorsOf(doc.nodes, selectedId)]) {
        const parentId = doc.nodes[ancestorId]?.parent;
        if (parentId && canDrop(doc.nodes, dropRules, payload, parentId).ok) {
          return { parentId, index: indexOf(doc.nodes, ancestorId) + 1 };
        }
      }
    }
    return { parentId: rootId, index: doc.nodes[rootId]?.children.length ?? 0 };
  };

  /**
   * After undo/redo, drop references the restored document cannot satisfy.
   *
   * Both are reachable: undoing an insert deletes the node that is still
   * selected, and undoing "add page" deletes the page that is still open. A
   * dangling page id leaves the canvas rendering a page the user cannot see in
   * the page list.
   */
  const reconcileAfterTimeTravel = (doc: SiteDoc): void => {
    const { selectedId, currentPageId, editing } = get();
    const patch: Partial<EditorState> = {};
    if (selectedId && !doc.nodes[selectedId]) patch.selectedId = null;
    if (!doc.pages.some((page) => page.id === currentPageId)) patch.currentPageId = doc.pages[0].id;
    if (editing && !doc.nodes[editing.nodeId]) patch.editing = null;
    if (Object.keys(patch).length) set(patch);
  };

  return {
    doc: initial.doc,
    past: [],
    future: [],
    lastCommit: null,

    currentPageId: initialPageId(initial.doc, initial.ui),
    selectedId: null,
    hoverId: null,

    view: 'design',
    device: initial.ui.device ?? 'desktop',
    zoom: clampZoom(initial.ui.zoom ?? 0.75),
    // Fit is the default for a fresh session, and it has to be stored: deriving
    // it from "zoom is unset" broke the moment the first save wrote a zoom.
    zoomToFit: initial.ui.zoomToFit ?? true,
    leftPanel: 'insert',
    inspectorTab: 'style',
    tabPinnedFor: null,
    inspectorOpen: true,
    styleState: null,

    editing: null,
    linkPopoverOpen: false,
    drag: null,
    previewOpen: false,
    clipboard: null,
    toasts: initial.notices.map((message) => ({ id: (toastId += 1), message, kind: 'info' as const })),
    saveError: null,

    /* ---------------- derived ---------------- */

    breakpoint: () => breakpointForDevice(get().device),
    styleLayer: () => get().styleState ?? breakpointForDevice(get().device),
    pageRootId: () => {
      const state = get();
      const page = findPage(state.doc, state.currentPageId) ?? state.doc.pages[0];
      return page.rootId;
    },
    selectedNode: () => {
      const { doc, selectedId } = get();
      return selectedId ? doc.nodes[selectedId] : undefined;
    },

    /* ---------------- document ---------------- */

    commit: (recipe, options = {}) => {
      const state = get();
      const next = produce(state.doc, (draft) => {
        recipe(draft as SiteDoc);
        draft.updatedAt = Date.now();
      });
      if (next === state.doc && options.select === undefined) return;

      const now = Date.now();
      const coalesced =
        options.coalesce !== undefined &&
        state.lastCommit?.key === options.coalesce &&
        now - state.lastCommit.at < COALESCE_MS;

      const past = options.noHistory || coalesced ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT);

      set({
        doc: next,
        past,
        future: options.noHistory ? state.future : [],
        lastCommit: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
        ...(options.select !== undefined ? { selectedId: options.select } : {}),
      });
      persist();
    },

    undo: () => {
      const { past, future, doc } = get();
      if (!past.length) return;
      const previous = past[past.length - 1];
      set({
        doc: previous,
        past: past.slice(0, -1),
        future: [...future, doc].slice(-HISTORY_LIMIT),
        lastCommit: null,
      });
      reconcileAfterTimeTravel(previous);
      persist();
    },

    redo: () => {
      const { past, future, doc } = get();
      if (!future.length) return;
      const next = future[future.length - 1];
      set({
        doc: next,
        past: [...past, doc].slice(-HISTORY_LIMIT),
        future: future.slice(0, -1),
        lastCommit: null,
      });
      reconcileAfterTimeTravel(next);
      persist();
    },

    replaceDoc: (doc, message) => {
      const state = get();
      set({
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        lastCommit: null,
        selectedId: null,
        hoverId: null,
        currentPageId: doc.pages[0].id,
      });
      persist();
      if (message) get().toast(message, 'success');
    },

    resetDoc: () => get().replaceDoc(createEmptyDoc(get().doc.name), 'Started a blank site'),

    /* ---------------- selection ---------------- */

    select: (id) => {
      const { doc, editing } = get();
      if (editing && editing.nodeId !== id) get().endEdit();
      if (id === null) {
        set({ selectedId: null, tabPinnedFor: null });
        return;
      }
      // Clicking a locked node selects the nearest thing the user can act on.
      const resolved = selectableAncestor(doc.nodes, id) ?? null;
      set({
        selectedId: resolved,
        ...(resolved === get().selectedId ? {} : { tabPinnedFor: null }),
      });
    },

    selectParent: () => {
      const { doc, selectedId } = get();
      if (!selectedId) return;
      const parent = doc.nodes[selectedId]?.parent;
      if (parent) set({ selectedId: parent });
    },

    setHover: (id) => {
      if (get().hoverId !== id) set({ hoverId: id });
    },

    /* ---------------- insertion + structure ---------------- */

    insertPayload: (payload, parentId, index) => {
      const { doc } = get();
      const decision = canDrop(doc.nodes, dropRules, payload, parentId);
      if (!decision.ok) return undefined;

      if (payload.kind === 'move') {
        get().moveTo(payload.nodeId, parentId, index);
        return payload.nodeId;
      }

      const spawned = spawnComponent(payload.componentType);
      if (!spawned) return undefined;
      get().commit(
        (draft) => {
          insertSubtree(draft, spawned.nodes, spawned.rootId, parentId, index);
        },
        { select: spawned.rootId },
      );
      return spawned.rootId;
    },

    insertComponent: (type) => {
      const payload: DragPayload = { kind: 'new', componentType: type };
      const { parentId, index } = insertionPoint(payload);
      const id = get().insertPayload(payload, parentId, index);
      if (!id) get().toast(`${getComponent(type)?.label ?? type} cannot go there`, 'error');
    },

    insertTemplate: (template) => {
      const { parentId, index } = insertionPoint({
        kind: 'new',
        componentType: template.tree.type,
      });
      if (!get().insertTemplateAt(template, parentId, index)) {
        get().toast(`${template.label} cannot go there`, 'error');
      }
    },

    insertTemplateAt: (template, parentId, index) => {
      const payload: DragPayload = { kind: 'new', componentType: template.tree.type };
      if (!canDrop(get().doc.nodes, dropRules, payload, parentId).ok) return undefined;
      const spawned = spawnTemplate(template);
      if (!spawned) return undefined;
      get().commit(
        (draft) => {
          insertSubtree(draft, spawned.nodes, spawned.rootId, parentId, index);
        },
        { select: spawned.rootId },
      );
      get().toast(`Added ${template.label}`, 'success');
      return spawned.rootId;
    },

    moveTo: (nodeId, parentId, index) => {
      const { doc } = get();
      if (!canDrop(doc.nodes, dropRules, { kind: 'move', nodeId }, parentId).ok) return;
      get().commit((draft) => {
        docMoveNode(draft, nodeId, parentId, index);
      });
    },

    remove: (id) => {
      const targetId = id ?? get().selectedId;
      if (!targetId) return;
      const { doc } = get();
      if (!canMutate(doc.nodes, dropRules, targetId)) {
        get().toast('That element is locked', 'error');
        return;
      }
      // Select the neighbour so the user is not left with an empty inspector.
      const parentId = doc.nodes[targetId].parent;
      const at = indexOf(doc.nodes, targetId);
      const siblings = parentId ? doc.nodes[parentId].children : [];
      const nextSelection = siblings[at + 1] ?? siblings[at - 1] ?? parentId ?? null;

      get().commit(
        (draft) => {
          docRemoveNode(draft, targetId);
        },
        { select: nextSelection },
      );
    },

    duplicate: (id) => {
      const targetId = id ?? get().selectedId;
      if (!targetId) return;
      if (!canMutate(get().doc.nodes, dropRules, targetId)) return;
      let created: string | undefined;
      get().commit((draft) => {
        created = docDuplicate(draft, targetId);
      });
      if (created) set({ selectedId: created });
    },

    wrapInContainer: (id) => {
      const targetId = id ?? get().selectedId;
      if (!targetId) return;
      const { doc } = get();
      const node = doc.nodes[targetId];
      if (!node?.parent) return;
      if (!canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'stack' }, node.parent).ok) {
        get().toast('Cannot wrap that element here', 'error');
        return;
      }
      const wrapper = spawnComponent('stack');
      if (!wrapper) return;
      get().commit(
        (draft) => {
          wrapNode(draft, targetId, wrapper.nodes, wrapper.rootId);
        },
        { select: wrapper.rootId },
      );
    },

    copy: (id) => {
      const targetId = id ?? get().selectedId;
      const { doc } = get();
      if (!targetId || !doc.nodes[targetId]) return;

      // Stored as a preset tree rather than raw nodes: paste then goes through
      // the same factory as everything else and gets fresh ids for free.
      const toPreset = (nodeId: string): PresetChild => {
        const node = doc.nodes[nodeId];
        return {
          type: node.type,
          props: JSON.parse(JSON.stringify(node.props)),
          styles: JSON.parse(JSON.stringify(node.styles)),
          children: node.children.map(toPreset),
        };
      };
      set({ clipboard: toPreset(targetId) });
      get().toast('Copied', 'info');
    },

    paste: () => {
      const { clipboard } = get();
      if (!clipboard) return;
      const spawned = spawnPreset(clipboard);
      if (!spawned) return;
      const { parentId, index } = insertionPoint({ kind: 'new', componentType: clipboard.type });
      if (!canDrop(get().doc.nodes, dropRules, { kind: 'new', componentType: clipboard.type }, parentId).ok) {
        get().toast('Cannot paste there', 'error');
        return;
      }
      get().commit(
        (draft) => {
          insertSubtree(draft, spawned.nodes, spawned.rootId, parentId, index);
        },
        { select: spawned.rootId },
      );
    },

    reorderSibling: (id, delta) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node?.parent) return;
      const at = indexOf(doc.nodes, id);
      const target = at + delta;
      if (target < 0 || target >= doc.nodes[node.parent].children.length) return;
      // `moveNode` interprets the index against the pre-detach list, so moving
      // down needs the extra +1 the drop indicator would have implied.
      get().moveTo(id, node.parent, delta > 0 ? target + 1 : target);
    },

    /* ---------------- node data ---------------- */

    setProp: (nodeId, key, value, coalesce = false) => {
      get().commit(
        (draft) => {
          if (key.includes('.')) setPropPath(draft, nodeId, key, value);
          else setProps(draft, nodeId, { [key]: value });
        },
        coalesce ? { coalesce: `prop:${nodeId}:${key}` } : {},
      );
    },

    setStyleValue: (nodeId, key, value, coalesce = false) => {
      const layer = get().styleLayer();
      get().commit(
        (draft) => {
          setStyle(draft, nodeId, layer, key, value);
        },
        coalesce ? { coalesce: `style:${nodeId}:${layer}:${key}` } : {},
      );
    },

    clearLayer: (nodeId, layer) => {
      const target = layer ?? get().styleLayer();
      get().commit((draft) => {
        clearStyleLayer(draft, nodeId, target);
      });
    },

    rename: (nodeId, name) => {
      get().commit(
        (draft) => {
          docRenameNode(draft, nodeId, name);
        },
        { coalesce: `rename:${nodeId}` },
      );
    },

    setAnchor: (nodeId, value) => {
      // Checked before committing rather than reporting afterwards: the clash is
      // a question about the current document, and asking it here keeps the
      // mutation in `doc.ts` a pure apply.
      const wanted = slugify(value, '');
      if (wanted) {
        const clash = Object.values(get().doc.nodes).some(
          (node) => node.id !== nodeId && node.anchorId === wanted,
        );
        if (clash) {
          get().toast(`Another element already uses #${wanted}`, 'error');
          return;
        }
      }
      get().commit(
        (draft) => {
          docSetAnchorId(draft, nodeId, value);
        },
        { coalesce: `anchor:${nodeId}` },
      );
    },

    toggleFlag: (nodeId, flag) => {
      const current = get().doc.nodes[nodeId]?.[flag] === true;
      get().commit((draft) => {
        setNodeFlag(draft, nodeId, flag, !current);
      });
    },

    /* ---------------- pages ---------------- */

    addPage: () => {
      let created: string | undefined;
      get().commit((draft) => {
        const page = docAddPage(draft, `Page ${draft.pages.length + 1}`);
        created = page.id;
        // A blank page was the single most tedious thing about building a
        // multi-page site: every new page needed its nav and footer rebuilt.
        // Shared sections are by definition wanted everywhere, so they come with it.
        for (const shared of sharedList(draft)) addSharedInstance(draft, shared.id, page.id);
      });
      if (created) set({ currentPageId: created, selectedId: null, leftPanel: 'pages' });
    },

    selectPage: (pageId) => {
      if (!findPage(get().doc, pageId)) return;
      set({ currentPageId: pageId, selectedId: null, hoverId: null, editing: null });
      persist();
    },

    updatePage: (pageId, patch) => {
      get().commit(
        (draft) => {
          const page = findPage(draft, pageId);
          if (!page) return;
          if (patch.name !== undefined) page.name = patch.name;
          if (patch.title !== undefined) page.title = patch.title;
          if (patch.description !== undefined) page.description = patch.description;
          if (patch.socialImage !== undefined) page.socialImage = patch.socialImage;
          if (patch.path !== undefined) {
            const wanted = normalisePath(patch.path);
            // Two pages sharing a path would overwrite each other on export.
            const clash = draft.pages.some((other) => other.id !== pageId && other.path === wanted);
            if (!clash) page.path = wanted;
          }
          page.updatedAt = Date.now();
        },
        { coalesce: `page:${pageId}` },
      );
    },

    deletePage: (pageId) => {
      const { doc, currentPageId } = get();
      if (doc.pages.length <= 1) {
        get().toast('A site needs at least one page', 'error');
        return;
      }
      const fallback = doc.pages.find((page) => page.id !== pageId)?.id;
      get().commit((draft) => {
        docRemovePage(draft, pageId);
      });
      if (currentPageId === pageId && fallback) set({ currentPageId: fallback, selectedId: null });
    },

    duplicatePage: (pageId) => {
      let created: string | undefined;
      get().commit((draft) => {
        created = docDuplicatePage(draft, pageId)?.id;
      });
      if (created) set({ currentPageId: created, selectedId: null });
    },

    movePage: (pageId, toIndex) => {
      get().commit((draft) => {
        docMovePage(draft, pageId, toIndex);
      });
    },

    setPagePosition: (pageId, x, y) => {
      get().commit(
        (draft) => {
          const page = findPage(draft, pageId);
          if (!page) return;
          page.x = Math.round(x);
          page.y = Math.round(y);
        },
        // One undo step per drag, not one per pointer move.
        { coalesce: `page:pos:${pageId}` },
      );
    },

    shareSection: (nodeId) => {
      const targetId = nodeId ?? get().selectedId;
      if (!targetId) return;
      const { doc } = get();
      const node = doc.nodes[targetId];
      if (!node) return;
      if (node.type === SHARED_TYPE) {
        get().toast('That section is already shared', 'info');
        return;
      }
      // Only a top-level section makes sense: sharing something nested would
      // mean an instance could land somewhere its parent does not accept.
      const page = pageOfNode(doc, targetId);
      if (!page || node.parent !== page.rootId) {
        get().toast('Only a whole section can be shared across pages', 'error');
        return;
      }

      const label = nodeLabel(doc, node);
      const signature = structureSignature(doc, targetId);
      let created: string | undefined;
      let replaced = 0;
      let added = 0;
      get().commit((draft) => {
        const shared = docMakeShared(draft, targetId, label);
        if (!shared) return;
        created = shared.id;
        /*
         * Put it on every other page straight away — "share this" means "use it
         * everywhere", and making the user visit five pages to add it would be
         * the same chore in a different order.
         *
         * Those pages usually already carry their own copy: the way anyone
         * builds a site is to drop a nav bar on every page and only later wish
         * they were one. Adding an instance without taking that copy away left
         * two identical nav bars stacked on six of seven pages, so a page whose
         * own section has the same structure has it replaced in place, keeping
         * the position the author chose.
         */
        for (const other of draft.pages) {
          if (other.id === page.id) continue;
          const siblings = draft.nodes[other.rootId].children;
          const twinId = siblings.find(
            (id) =>
              draft.nodes[id]?.type !== SHARED_TYPE &&
              structureSignature(draft, id) === signature,
          );
          if (twinId) {
            const at = siblings.indexOf(twinId);
            docRemoveNode(draft, twinId);
            addSharedInstance(draft, shared.id, other.id, at);
            replaced += 1;
          } else {
            addSharedInstance(draft, shared.id, other.id);
            added += 1;
          }
        }
      });
      if (created) {
        /*
         * Keep the section the user was looking at selected — which is now the
         * shared master's root, still exactly where it was on screen.
         *
         * Selecting the *instance* instead seems more correct and is not: an
         * instance renders its master's subtree without an element of its own,
         * so it has no box on the canvas, and selecting it leaves the overlay
         * and the context panel with nothing to measure or show.
         */
        // Say what actually happened. Replacing a copy and adding to a page that
        // had none are different outcomes, and a section the user did not expect
        // on six pages is worth being told about while undo is still one press
        // away.
        const used = replaced + added + 1;
        const parts: string[] = [];
        if (replaced) parts.push(`replaced ${replaced} ${replaced === 1 ? 'copy' : 'copies'}`);
        if (added) parts.push(`added to ${added} ${added === 1 ? 'page' : 'pages'}`);
        get().toast(
          `“${label}” is now shared across ${used} ${used === 1 ? 'page' : 'pages'}` +
            (parts.length ? ` — ${parts.join(', ')}` : ''),
          'success',
        );
      }
    },

    unshareSection: (nodeId) => {
      const targetId = nodeId ?? get().selectedId;
      if (!targetId) return;
      if (get().doc.nodes[targetId]?.type !== SHARED_TYPE) return;
      let inlined: string | undefined;
      get().commit((draft) => {
        inlined = docInlineShared(draft, targetId);
      });
      if (inlined) {
        set({ selectedId: inlined });
        get().toast('This page now has its own copy', 'info');
      }
    },

    addSharedToPage: (sharedId) => {
      const pageId = get().currentPageId;
      let created: string | undefined;
      get().commit((draft) => {
        created = addSharedInstance(draft, sharedId, pageId);
      });
      if (created) set({ selectedId: created });
    },

    removeSharedEverywhere: (sharedId) => {
      const name = findShared(get().doc, sharedId)?.name ?? 'Shared section';
      get().commit((draft) => {
        docRemoveShared(draft, sharedId);
      });
      set({ selectedId: null });
      get().toast(`Removed “${name}” from every page`, 'info');
    },

    connectPages: (fromPageId, toPageId) => {
      const { doc } = get();
      const from = findPage(doc, fromPageId);
      const target = findPage(doc, toPageId);
      if (!from || !target || fromPageId === toPageId) return false;

      // Already linked? Connecting twice would quietly duplicate a nav item.
      if (pageEdges(doc).some((e) => e.fromPageId === fromPageId && e.toPageId === toPageId)) {
        get().toast(`${from.name} already links to ${target.name}`, 'info');
        return false;
      }

      const parentId = navRowOf(doc, fromPageId) ?? from.rootId;
      const spawned = spawnPreset({
        type: 'link',
        props: { label: target.name, href: target.path },
      });
      if (!spawned) return false;
      if (!canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'link' }, parentId)) return false;

      get().commit((draft) => {
        insertSubtree(draft, spawned.nodes, spawned.rootId, parentId, draft.nodes[parentId].children.length);
      });
      get().toast(`Linked ${from.name} → ${target.name}`, 'success');
      return true;
    },

    disconnectPages: (fromPageId, toPageId) => {
      const edge = pageEdges(get().doc).find(
        (candidate) => candidate.fromPageId === fromPageId && candidate.toPageId === toPageId,
      );
      if (!edge) return;
      get().commit((draft) => {
        for (const nodeId of edge.nodeIds) docRemoveNode(draft, nodeId);
      });
      get().toast('Link removed', 'info');
    },

    /* ---------------- site + theme ---------------- */

    setSiteName: (name) => {
      get().commit(
        (draft) => {
          draft.name = name;
        },
        { coalesce: 'site:name' },
      );
    },

    setSiteUrl: (url) => {
      get().commit(
        (draft) => {
          draft.siteUrl = url.trim();
        },
        { coalesce: 'site:url' },
      );
    },

    setThemeFont: (slot, value) => {
      get().commit((draft) => {
        draft.theme.fonts[slot] = value;
      });
    },

    setThemeColor: (index, patch) => {
      get().commit(
        (draft) => {
          const token = draft.theme.colors[index];
          if (!token) return;
          if (patch.name !== undefined) token.name = patch.name;
          if (patch.value !== undefined) token.value = patch.value;
        },
        { coalesce: `theme:color:${index}` },
      );
    },

    addThemeColor: () => {
      get().commit((draft) => {
        draft.theme.colors.push({ name: `custom-${draft.theme.colors.length + 1}`, value: '#7a5fe5' });
      });
    },

    removeThemeColor: (index) => {
      get().commit((draft) => {
        draft.theme.colors.splice(index, 1);
      });
    },

    setThemeScalar: (key, value) => {
      get().commit(
        (draft) => {
          draft.theme[key] = value;
        },
        { coalesce: `theme:${key}` },
      );
    },

    applyPalette: (paletteId) => {
      const palette = paletteById(paletteId);
      if (!palette) return;
      get().commit((draft) => {
        for (const [name, value] of Object.entries(palette.colors)) {
          const token = draft.theme.colors.find((candidate) => candidate.name === name);
          if (token) token.value = value;
          else draft.theme.colors.push({ name, value });
        }
        if (palette.fonts) Object.assign(draft.theme.fonts, palette.fonts);
        if (palette.radius) draft.theme.radius = palette.radius;
      });
      get().toast(`Applied the ${palette.label} palette`, 'success');
    },

    setCustomCss: (css) => {
      get().commit(
        (draft) => {
          draft.theme.customCss = css;
        },
        { coalesce: 'theme:css' },
      );
    },

    /* ---------------- ui ---------------- */

    setView: (view) => set({ view, selectedId: null, hoverId: null, editing: null }),

    setDevice: (device) => {
      set({ device, styleState: null });
      persist();
    },

    setZoom: (zoom) => {
      set({ zoom: clampZoom(zoom), zoomToFit: false });
      persist();
    },

    stepZoom: (direction) => {
      set({ zoom: nextZoom(get().zoom, direction), zoomToFit: false });
      persist();
    },

    setZoomToFit: (on) => set({ zoomToFit: on }),

    setLeftPanel: (panel) => set({ leftPanel: panel }),
    setInspectorTab: (tab) => set({ inspectorTab: tab, tabPinnedFor: get().selectedId }),
    setInspectorOpen: (open) => set({ inspectorOpen: open }),
    setStyleState: (state) => set({ styleState: state }),

    beginEdit: (nodeId, key, options) =>
      set({ editing: { nodeId, key, ...options }, selectedId: nodeId }),
    endEdit: () => {
      if (get().editing) set({ editing: null, linkPopoverOpen: false });
    },

    setLinkPopoverOpen: (open) => set({ linkPopoverOpen: open }),

    startDrag: (payload, origin, template) =>
      set({
        drag: {
          payload,
          origin,
          point: { x: 0, y: 0 },
          active: false,
          target: null,
          ...(template ? { template } : {}),
        },
      }),

    updateDrag: (patch) => {
      const drag = get().drag;
      if (!drag) return;
      set({ drag: { ...drag, ...patch } });
    },

    endDrag: () => set({ drag: null }),

    setPreview: (open) => set({ previewOpen: open, editing: null }),

    toast: (message, kind = 'info') => {
      const id = (toastId += 1);
      // Capped: a burst of actions (inserting six sections, applying a palette)
      // otherwise stacks enough toasts to cover the canvas the user is watching.
      set({ toasts: [...get().toasts, { id, message, kind }].slice(-TOAST_LIMIT) });
    },

    dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  };
});

/** Flush the debounced save when the tab goes away. */
export function installSaveGuards(): () => void {
  const flush = () => saver.flush();
  window.addEventListener('beforeunload', flush);
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener('beforeunload', flush);
    document.removeEventListener('visibilitychange', onHide);
  };
}

export function deviceWidth(state: EditorState): number {
  return deviceById(state.device).width;
}
