/**
 * The site map: pages as cards, links between them as wires.
 *
 * The point is to make navigation something you *arrange* rather than something
 * you reconstruct in your head from href fields scattered across pages. Dragging
 * a wire from one card to another writes a real nav link on the source page —
 * there is no separate "flow" data model to keep in sync, because the edges are
 * derived from the document every render (`core/sitemap.ts`).
 *
 * Geometry is deliberately simple: absolute positions in a pannable world, wires
 * drawn as cubic curves in one SVG layer underneath the cards. No zoom — pan and
 * a fit button cover the range a site map actually needs, and every pixel of
 * zoom machinery is a pixel that can be off by one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../common';
import { useEditor } from '../../store/editor';
import { orphanPages, pageEdges, type PageEdge } from '../../core/sitemap';
import { pageFileName } from '../../render/RenderNode';
import { walk } from '../../core/tree';
import type { Page, SiteDoc } from '../../core/types';

const CARD_W = 232;
const CARD_H = 128;
const GAP_X = 132;
const GAP_Y = 56;

interface Point {
  x: number;
  y: number;
}

/**
 * Default positions: breadth-first from the home page, one column per hop.
 *
 * A plain grid put every page in one column, which forced every wire to leave a
 * card's right edge and double back to the card below it — unreadable. Laying
 * pages out by link depth makes the map flow left to right, so the shape of the
 * graph is the shape of the navigation.
 */
function autoLayout(doc: SiteDoc, edges: PageEdge[]): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!doc.pages.length) return out;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.fromPageId) ?? [];
    list.push(edge.toPageId);
    outgoing.set(edge.fromPageId, list);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [doc.pages[0].id];
  depth.set(doc.pages[0].id, 0);
  while (queue.length) {
    const id = queue.shift() as string;
    for (const next of outgoing.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }

  // Anything unreachable from home gets its own trailing column.
  const maxDepth = Math.max(0, ...depth.values());
  for (const page of doc.pages) {
    if (!depth.has(page.id)) depth.set(page.id, maxDepth + 1);
  }

  const perColumn = new Map<number, number>();
  for (const page of doc.pages) {
    const column = depth.get(page.id) ?? 0;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    out.set(page.id, {
      x: 60 + column * (CARD_W + GAP_X),
      y: 40 + row * (CARD_H + GAP_Y),
    });
  }
  return out;
}

/** A one-line summary of what is on a page, for the card body. */
function outlineOf(doc: SiteDoc, page: Page): string[] {
  const names: string[] = [];
  const root = doc.nodes[page.rootId];
  for (const childId of root?.children ?? []) {
    const child = doc.nodes[childId];
    if (!child) continue;
    let label = child.type;
    // A section is only meaningful by what it contains, so use its first heading.
    walk(doc.nodes, childId, (node) => {
      if (label !== child.type) return;
      if (node.type === 'heading' && typeof node.props.text === 'string' && node.props.text.trim()) {
        label = node.props.text.trim();
      }
    });
    names.push(label);
    // Three is what fits in the fixed card height without clipping a line.
    if (names.length >= 3) break;
  }
  return names;
}

/** Cubic curve from the right edge of one card to the left edge of another. */
function wirePath(from: Point, to: Point): string {
  const x1 = from.x + CARD_W;
  const y1 = from.y + CARD_H / 2;
  const x2 = to.x;
  const y2 = to.y + CARD_H / 2;
  const bend = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export function PagesFlow() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectPage = useEditor((s) => s.selectPage);
  const setView = useEditor((s) => s.setView);
  const addPage = useEditor((s) => s.addPage);
  const deletePage = useEditor((s) => s.deletePage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const setPagePosition = useEditor((s) => s.setPagePosition);
  const connectPages = useEditor((s) => s.connectPages);
  const disconnectPages = useEditor((s) => s.disconnectPages);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  /** Live drag state. Kept in a ref for the move handler, mirrored to state to paint. */
  const gesture = useRef<
    | { kind: 'card'; pageId: string; grab: Point; origin: Point }
    | { kind: 'wire'; fromPageId: string }
    | { kind: 'pan'; start: Point; from: Point }
    | null
  >(null);
  const [dragCard, setDragCard] = useState<{ pageId: string; at: Point } | null>(null);
  const [wire, setWire] = useState<{ fromPageId: string; to: Point } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);

  const edges = useMemo(() => pageEdges(doc), [doc]);
  const orphans = useMemo(() => new Set(orphanPages(doc)), [doc]);

  const positions = useMemo(() => {
    const auto = autoLayout(doc, edges);
    const map = new Map<string, Point>();
    for (const page of doc.pages) {
      // An explicit position always wins: once the user arranges a card, the
      // layout must never move it back.
      map.set(
        page.id,
        typeof page.x === 'number' && typeof page.y === 'number'
          ? { x: page.x, y: page.y }
          : auto.get(page.id) ?? { x: 60, y: 40 },
      );
    }
    // While dragging, the dragged card follows the pointer rather than the document.
    if (dragCard) map.set(dragCard.pageId, dragCard.at);
    return map;
  }, [doc, edges, dragCard]);

  /** Client coordinates → world coordinates. */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = viewportRef.current?.getBoundingClientRect();
      return {
        x: clientX - (rect?.left ?? 0) - pan.x,
        y: clientY - (rect?.top ?? 0) - pan.y,
      };
    },
    [pan],
  );

  /** Which card is under this world point, if any. */
  const cardAt = useCallback(
    (world: Point): string | null => {
      for (const page of doc.pages) {
        const at = positions.get(page.id);
        if (!at) continue;
        if (
          world.x >= at.x &&
          world.x <= at.x + CARD_W &&
          world.y >= at.y &&
          world.y <= at.y + CARD_H
        ) {
          return page.id;
        }
      }
      return null;
    },
    [doc.pages, positions],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active) return;
      const world = toWorld(event.clientX, event.clientY);

      if (active.kind === 'card') {
        setDragCard({
          pageId: active.pageId,
          at: { x: world.x - active.grab.x, y: world.y - active.grab.y },
        });
      } else if (active.kind === 'wire') {
        setWire({ fromPageId: active.fromPageId, to: world });
        const over = cardAt(world);
        setHoverTarget(over && over !== active.fromPageId ? over : null);
      } else {
        setPan({
          x: active.from.x + (event.clientX - active.start.x),
          y: active.from.y + (event.clientY - active.start.y),
        });
      }
    };

    const onUp = () => {
      const active = gesture.current;
      gesture.current = null;

      if (active?.kind === 'card' && dragCard) {
        setPagePosition(active.pageId, dragCard.at.x, dragCard.at.y);
      }
      if (active?.kind === 'wire' && hoverTarget) {
        connectPages(active.fromPageId, hoverTarget);
      }
      setDragCard(null);
      setWire(null);
      setHoverTarget(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [toWorld, cardAt, dragCard, hoverTarget, setPagePosition, connectPages]);

  /** Centre the graph in the viewport. */
  const fit = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const all = [...positions.values()];
    if (!all.length) return;
    const minX = Math.min(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxX = Math.max(...all.map((p) => p.x + CARD_W));
    const maxY = Math.max(...all.map((p) => p.y + CARD_H));
    setPan({
      x: (rect.width - (maxX - minX)) / 2 - minX,
      y: Math.max(24, (rect.height - (maxY - minY)) / 2) - minY,
    });
  }, [positions]);

  // Re-fit when pages are added or removed, so a new card is never off-screen.
  // Deliberately not on every `positions` change — that would fight the user
  // while they drag.
  useEffect(fit, [doc.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const wireFrom = wire ? positions.get(wire.fromPageId) : undefined;

  return (
    <div className="fl" ref={viewportRef}>
      <header className="fl__bar">
        <div className="fl__title">
          <strong>Site map</strong>
          <span>
            {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'} · {edges.length}{' '}
            {edges.length === 1 ? 'link' : 'links'}
          </span>
        </div>
        <div className="fl__tools">
          <button type="button" className="ui-minibtn" onClick={fit}>
            <Icon path="M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5" size={13} /> Fit
          </button>
          <button type="button" className="ui-minibtn" onClick={addPage}>
            <Icon path="M12 5v14M5 12h14" size={13} strokeWidth={2} /> Add page
          </button>
        </div>
      </header>

      <div
        className={`fl__canvas ${gesture.current?.kind === 'pan' ? 'is-panning' : ''}`}
        onPointerDown={(event) => {
          // Background press pans. Cards and ports stop propagation themselves.
          if (event.button !== 0) return;
          gesture.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, from: pan };
        }}
      >
        <div className="fl__world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="fl__wires" aria-hidden="true">
            {edges.map((edge) => {
              const from = positions.get(edge.fromPageId);
              const to = positions.get(edge.toPageId);
              if (!from || !to) return null;
              const path = wirePath(from, to);
              return (
                <g className="fl__wire" key={`${edge.fromPageId}->${edge.toPageId}`}>
                  <path className="fl__wire-hit" d={path} />
                  <path className="fl__wire-line" d={path} />
                  <foreignObject
                    x={(from.x + CARD_W + to.x) / 2 - 60}
                    y={(from.y + to.y) / 2 + CARD_H / 2 - 13}
                    width={120}
                    height={26}
                  >
                    <button
                      type="button"
                      className="fl__wire-label"
                      title={`Remove the link from this page to ${
                        doc.pages.find((p) => p.id === edge.toPageId)?.name ?? 'page'
                      }`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => disconnectPages(edge.fromPageId, edge.toPageId)}
                    >
                      <span>{edge.label}</span>
                      <Icon path="M6 6l12 12M18 6L6 18" size={9} strokeWidth={2.4} />
                    </button>
                  </foreignObject>
                </g>
              );
            })}

            {wire && wireFrom ? (
              <path className="fl__wire-draft" d={wirePath(wireFrom, { x: wire.to.x, y: wire.to.y - CARD_H / 2 })} />
            ) : null}
          </svg>

          {doc.pages.map((page, index) => {
            const at = positions.get(page.id) ?? { x: 60, y: 40 };
            const isHome = index === 0;
            return (
              <div
                key={page.id}
                className={[
                  'fl__card',
                  page.id === currentPageId ? 'is-current' : '',
                  hoverTarget === page.id ? 'is-target' : '',
                  dragCard?.pageId === page.id ? 'is-dragging' : '',
                  orphans.has(page.id) ? 'is-orphan' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${at.x}px`, top: `${at.y}px`, width: `${CARD_W}px` }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  const world = toWorld(event.clientX, event.clientY);
                  gesture.current = {
                    kind: 'card',
                    pageId: page.id,
                    grab: { x: world.x - at.x, y: world.y - at.y },
                    origin: at,
                  };
                }}
                onDoubleClick={() => {
                  selectPage(page.id);
                  setView('design');
                }}
              >
                <div className="fl__card-head">
                  <Icon
                    path={
                      isHome
                        ? 'M3 11l9-8 9 8M5 10v10h14V10'
                        : 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5'
                    }
                    size={13}
                  />
                  <strong>{page.name}</strong>
                  {orphans.has(page.id) ? (
                    <span className="fl__badge" title="Nothing links here yet">
                      unlinked
                    </span>
                  ) : null}
                </div>

                <code className="fl__path">{pageFileName(page.path)}</code>

                <ul className="fl__outline">
                  {outlineOf(doc, page).map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                  {doc.nodes[page.rootId]?.children.length === 0 ? <li className="is-empty">Empty page</li> : null}
                </ul>

                <div className="fl__card-acts" onPointerDown={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="fl__card-open"
                    onClick={() => {
                      selectPage(page.id);
                      setView('design');
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ui-minibtn is-icon"
                    title="Duplicate page"
                    onClick={() => duplicatePage(page.id)}
                  >
                    <Icon path="M9 9h11v11H9zM4 15V4h11" size={12} />
                  </button>
                  <button
                    type="button"
                    className="ui-minibtn is-icon is-danger"
                    title={isHome ? 'The home page cannot be deleted' : 'Delete page'}
                    disabled={doc.pages.length <= 1}
                    onClick={() => deletePage(page.id)}
                  >
                    <Icon path="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" size={12} />
                  </button>
                </div>

                {/* Drag handle for making a connection. */}
                <button
                  type="button"
                  className="fl__port"
                  title="Drag to another page to add a nav link"
                  aria-label="Connect this page to another"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    gesture.current = { kind: 'wire', fromPageId: page.id };
                    setWire({ fromPageId: page.id, to: toWorld(event.clientX, event.clientY) });
                  }}
                >
                  <span />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <p className="fl__hint">
        Drag a card to arrange · drag the dot on its right edge onto another page to add a nav link ·
        double-click a card to edit it
      </p>
    </div>
  );
}
