/**
 * Drop-target resolution.
 *
 * The canvas is a real iframe, so the drag layer works in *frame coordinates*:
 * CSS pixels inside the iframe's own viewport. `elementFromPoint` on the frame
 * document does the hit-testing, which means the browser's own layout answers
 * "what is under the pointer" — no bookkeeping of element rectangles, and it
 * stays correct through scrolling, wrapping, grids and transforms.
 *
 * The old editor compared the pointer's Y against a list of gap positions in one
 * flat column. That cannot express "inside this card, between these two
 * paragraphs", which is most of what building a page actually is.
 */

import { canDrop } from '../core/tree';
import { dropRules } from '../registry/registry';
import type { DragPayload, DropTarget, Rect, SBNode, SiteDoc } from '../core/types';

export interface Point {
  x: number;
  y: number;
}

/**
 * Cross-realm element check.
 *
 * `value instanceof Element` is **false** for anything inside the canvas iframe:
 * that document has its own `Element` constructor, and `instanceof` compares
 * against the parent window's. Every DOM check on this side of the boundary has
 * to duck-type instead, or it silently fails for exactly the nodes we care about.
 */
export function asElement(value: unknown): HTMLElement | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as HTMLElement;
  return candidate.nodeType === 1 && typeof candidate.closest === 'function' ? candidate : null;
}

/** Nearest ancestor-or-self carrying `data-node-id`, across the iframe boundary. */
export function nodeIdFromTarget(target: unknown): string | null {
  const el = asElement(target);
  const holder = el?.closest<HTMLElement>('[data-node-id]');
  return holder?.dataset.nodeId ?? null;
}

/** How close to an edge counts as "between siblings" rather than "inside". */
function edgeInset(size: number): number {
  return Math.min(18, Math.max(6, size * 0.18));
}

function toRect(rect: DOMRect): Rect {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** The nearest ancestor (inclusive) that maps to a node in the document. */
function closestNodeElement(
  start: Element | null,
  doc: SiteDoc,
  skip: (id: string) => boolean,
): { el: HTMLElement; id: string } | undefined {
  let cursor: HTMLElement | null = asElement(start);
  while (cursor) {
    const id = cursor.dataset?.nodeId;
    if (id && doc.nodes[id] && !skip(id)) return { el: cursor, id };
    cursor = asElement(cursor.parentElement);
  }
  return undefined;
}

type Axis = 'column' | 'row' | 'grid';

function axisOf(el: Element, win: Window): Axis {
  const style = win.getComputedStyle(el);
  const display = style.display;
  if (display === 'flex' || display === 'inline-flex') {
    return style.flexDirection.startsWith('row') ? 'row' : 'column';
  }
  if (display === 'grid' || display === 'inline-grid') {
    const columns = style.gridTemplateColumns.split(' ').filter((part) => part && part !== 'none');
    return columns.length > 1 ? 'grid' : 'column';
  }
  return 'column';
}

interface ChildBox {
  id: string;
  rect: DOMRect;
}

/** Child elements that correspond to document nodes, in document order. */
function childBoxes(parentEl: HTMLElement, childIds: string[]): ChildBox[] {
  const boxes: ChildBox[] = [];
  for (const id of childIds) {
    // Scoped to this parent so a nested node with the same id cannot match.
    const el = parentEl.querySelector<HTMLElement>(`:scope > [data-node-id="${id}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    // Zero-size children (a collapsed element) give no usable geometry.
    if (rect.width === 0 && rect.height === 0) continue;
    boxes.push({ id, rect });
  }
  return boxes;
}

/**
 * Which slot the pointer sits in among `boxes`.
 * Returns the insertion index plus the box and side that produced it, so the
 * caller can draw the line on the correct edge.
 */
function slotFor(
  boxes: ChildBox[],
  point: Point,
  axis: Axis,
): { index: number; box?: ChildBox; after: boolean } {
  if (!boxes.length) return { index: 0, after: false };

  let best = boxes[0];
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < boxes.length; i += 1) {
    const { rect } = boxes[i];
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distance = (point.x - cx) ** 2 + (point.y - cy) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = boxes[i];
      bestIndex = i;
    }
  }

  const rect = best.rect;
  let after: boolean;
  if (axis === 'row') {
    after = point.x > rect.left + rect.width / 2;
  } else if (axis === 'column') {
    after = point.y > rect.top + rect.height / 2;
  } else {
    // Grid: if the pointer shares this item's row band, the meaningful axis is
    // horizontal; otherwise it is above or below the whole row.
    const sameRow = point.y >= rect.top && point.y <= rect.bottom;
    after = sameRow ? point.x > rect.left + rect.width / 2 : point.y > rect.top + rect.height / 2;
  }

  return { index: after ? bestIndex + 1 : bestIndex, box: best, after };
}

/** Indicator line for inserting at `index` among `boxes`. */
function lineFor(
  parentEl: HTMLElement,
  boxes: ChildBox[],
  slot: { index: number; box?: ChildBox; after: boolean },
  axis: Axis,
): { rect: Rect; horizontal: boolean } {
  const horizontal = axis !== 'row';

  if (!slot.box) {
    const rect = parentEl.getBoundingClientRect();
    return {
      rect: horizontal
        ? { top: rect.top + 2, left: rect.left, width: rect.width, height: 0 }
        : { top: rect.top, left: rect.left + 2, width: 0, height: rect.height },
      horizontal,
    };
  }

  const rect = slot.box.rect;
  if (axis === 'row') {
    return {
      rect: { top: rect.top, left: slot.after ? rect.right : rect.left, width: 0, height: rect.height },
      horizontal: false,
    };
  }

  // For a grid the line spans the item, not the whole container, so it reads as
  // "between these two cards" rather than "between these two rows".
  const spanLeft = axis === 'grid' ? rect.left : parentEl.getBoundingClientRect().left;
  const spanWidth = axis === 'grid' ? rect.width : parentEl.getBoundingClientRect().width;
  void boxes;
  return {
    rect: { top: slot.after ? rect.bottom : rect.top, left: spanLeft, width: spanWidth, height: 0 },
    horizontal: true,
  };
}

export interface Resolution {
  target: DropTarget | null;
  /** Set when a position was found but rejected, for the "no drop" cursor. */
  rejection?: string;
}

/**
 * Resolve the drop target under `point`.
 *
 * Strategy: find the element under the pointer, then try three things in order
 * until one validates — drop *inside* it, drop *beside* it, then the same for
 * each ancestor. Walking up is what makes the interaction forgiving: dragging a
 * Section over a heading buried four levels deep still lands sensibly at the
 * page level instead of refusing.
 */
export function resolveDropTarget(
  frame: HTMLIFrameElement,
  doc: SiteDoc,
  payload: DragPayload,
  point: Point,
): Resolution {
  const frameDoc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!frameDoc || !win) return { target: null };

  // A moving node cannot receive itself or its own descendants.
  const movingId = payload.kind === 'move' ? payload.nodeId : undefined;
  const insideMoving = (id: string): boolean => {
    if (!movingId) return false;
    if (id === movingId) return true;
    let cursor: string | null = doc.nodes[id]?.parent ?? null;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === movingId) return true;
      seen.add(cursor);
      cursor = doc.nodes[cursor]?.parent ?? null;
    }
    return false;
  };

  const hit = closestNodeElement(
    frameDoc.elementFromPoint(point.x, point.y),
    doc,
    insideMoving,
  );
  if (!hit) return { target: null };

  let rejection: string | undefined;

  const tryInside = (el: HTMLElement, id: string): DropTarget | undefined => {
    const node = doc.nodes[id];
    const decision = canDrop(doc.nodes, dropRules, payload, id);
    if (!decision.ok) {
      rejection ??= decision.reason;
      return undefined;
    }
    const axis = axisOf(el, win);
    const boxes = childBoxes(el, node.children);
    const slot = slotFor(boxes, point, axis);
    const line = lineFor(el, boxes, slot, axis);
    return {
      nodeId: id,
      position: 'inside',
      parentId: id,
      index: slot.index,
      rect: line.rect,
      horizontal: line.horizontal,
      parentRect: toRect(el.getBoundingClientRect()),
    };
  };

  const tryBeside = (el: HTMLElement, id: string): DropTarget | undefined => {
    const node = doc.nodes[id];
    const parentId = node.parent;
    if (!parentId) return undefined;
    const parentEl = el.parentElement?.closest<HTMLElement>('[data-node-id]');
    const decision = canDrop(doc.nodes, dropRules, payload, parentId);
    if (!decision.ok) {
      rejection ??= decision.reason;
      return undefined;
    }

    const axis = parentEl ? axisOf(parentEl, win) : 'column';
    const rect = el.getBoundingClientRect();
    const after =
      axis === 'row'
        ? point.x > rect.left + rect.width / 2
        : point.y > rect.top + rect.height / 2;
    const at = doc.nodes[parentId].children.indexOf(id);

    const horizontal = axis !== 'row';
    return {
      nodeId: id,
      position: after ? 'after' : 'before',
      parentId,
      index: at + (after ? 1 : 0),
      rect: horizontal
        ? { top: after ? rect.bottom : rect.top, left: rect.left, width: rect.width, height: 0 }
        : { top: rect.top, left: after ? rect.right : rect.left, width: 0, height: rect.height },
      horizontal,
      ...(parentEl ? { parentRect: toRect(parentEl.getBoundingClientRect()) } : {}),
    };
  };

  // First candidate: the element under the pointer.
  let el: HTMLElement | null = hit.el;
  let id: string | null = hit.id;

  while (el && id) {
    const node: SBNode = doc.nodes[id];
    const rect = el.getBoundingClientRect();
    const inX = edgeInset(rect.width);
    const inY = edgeInset(rect.height);
    const nearEdge =
      point.x < rect.left + inX ||
      point.x > rect.right - inX ||
      point.y < rect.top + inY ||
      point.y > rect.bottom - inY;

    // An empty container should always accept a drop: there is no "beside" to
    // fall back to, and an empty box the pointer cannot fill is a dead end.
    const empty = node.children.length === 0;

    if (empty || !nearEdge) {
      const inside = tryInside(el, id);
      if (inside) return { target: inside };
    }

    const beside = tryBeside(el, id);
    if (beside) return { target: beside };

    // Still nothing: try dropping inside even though we are near an edge.
    const inside = tryInside(el, id);
    if (inside) return { target: inside };

    const parentId: string | null = node.parent;
    el = el.parentElement?.closest<HTMLElement>('[data-node-id]') ?? null;
    id = parentId;
    if (el && id && el.dataset.nodeId !== id) {
      // Markup nesting and document nesting disagree (a component wrapped its
      // children); trust the document.
      el = frameDoc.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    }
  }

  return { target: null, ...(rejection ? { rejection } : {}) };
}

/** Distance in px the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

export function passedThreshold(origin: Point, current: Point): boolean {
  return Math.abs(current.x - origin.x) > DRAG_THRESHOLD || Math.abs(current.y - origin.y) > DRAG_THRESHOLD;
}
