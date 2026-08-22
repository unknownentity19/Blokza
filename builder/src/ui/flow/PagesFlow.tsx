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
import { nodeLabel } from '../../core/factory';
import type { Page, SiteDoc } from '../../core/types';

const CARD_W = 232;
const CARD_H = 140;
const GAP_X = 132;
const GAP_Y = 56;
/** Wrap a column after this many cards, so a flat site is not one tall stack. */
const MAX_ROWS = 4;

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
 *
 * Only content edges are passed in. Depth measured across a shared nav is
 * meaningless — every page is one hop from every other, so every page lands in
 * column one and the "shape of the navigation" is a single vertical stack.
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

  /*
   * Anything unreachable from home trails the columns that mean something, and
   * wraps once a column is full. Depth is a real statement about the graph, so
   * those columns are never wrapped; the leftovers carry no depth to preserve,
   * and a site with no content links at all is otherwise a single stack of
   * cards taller than the viewport.
   */
  const maxDepth = Math.max(0, ...depth.values());
  const loose = doc.pages.filter((page) => !depth.has(page.id));

  const perColumn = new Map<number, number>();
  const place = (pageId: string, column: number, row: number) => {
    out.set(pageId, { x: 60 + column * (CARD_W + GAP_X), y: 40 + row * (CARD_H + GAP_Y) });
  };

  for (const page of doc.pages) {
    const column = depth.get(page.id);
    if (column === undefined) continue;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    place(page.id, column, row);
  }
  loose.forEach((page, index) => {
    place(page.id, maxDepth + 1 + Math.floor(index / MAX_ROWS), index % MAX_ROWS);
  });
  return out;
}

/**
 * The sections on a page, for the card body.
 *
 * `nodeLabel` rather than a local walk. The local one used `walk`, which stops
 * at a shared reference and finds no heading inside it, so every card opened
 * with the literal word "shared" — and a section with no heading read
 * "section". `nodeLabel` resolves a shared instance through to its master
 * ("Header", "Footer"), prefers the semantic tag, and only then falls back to
 * the first heading, which is what a person would call the section anyway.
 */
function outlineOf(doc: SiteDoc, page: Page): string[] {
  const root = doc.nodes[page.rootId];
  return (root?.children ?? [])
    // Three is what fits in the fixed card height without clipping a line.
    .slice(0, 3)
    .map((childId) => {
      const child = doc.nodes[childId];
      return child ? nodeLabel(doc, child) : '';
    })
    .filter(Boolean);
}

/** Side-to-side cubic between two absolute points, with its midpoint. */
function sideRoute(x1: number, y1: number, x2: number, y2: number): { d: string; mid: Point } {
  const bend = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return {
    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
  };
}

/**
 * A cubic curve between two cards, and the point halfway along it.
 *
 * Always leaving the right edge for the left edge only reads when the target is
 * genuinely further right. For a link down its own column — a journal page whose
 * call to action points at contact — it threw the curve out past both cards and
 * doubled back, which is the unreadable shape the column layout exists to avoid.
 * So a target that is not clear to the right is joined bottom-to-top instead,
 * and the curve stays inside the space between the two cards.
 *
 * The midpoint is returned rather than recomputed by the caller: the label has
 * to sit on the curve, and a caller assuming the horizontal route left every
 * vertical edge's label floating in empty space.
 */
function wirePath(from: Point, to: Point): { d: string; mid: Point } {
  // A target clear to the right keeps the side-to-side route.
  if (to.x >= from.x + CARD_W + 24) {
    return sideRoute(from.x + CARD_W, from.y + CARD_H / 2, to.x, to.y + CARD_H / 2);
  }

  // Vertical route: down out of the source, up into the target — or the reverse
  // when the target sits above.
  const downward = to.y >= from.y;
  const x1 = from.x + CARD_W / 2;
  const y1 = downward ? from.y + CARD_H : from.y;
  const x2 = to.x + CARD_W / 2;
  const y2 = downward ? to.y : to.y + CARD_H;
  const bend = Math.max(36, Math.abs(y2 - y1) * 0.5) * (downward ? 1 : -1);
  return {
    d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
    mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
  };
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
  /*
   * Wires are content links only. The shared nav puts every page one hop from
   * every other, which on the seven-page demo was thirty crossing curves that
   * hid the two links a reader actually needed — and said nothing beyond "there
   * is a nav". The chrome is stated once instead, on the cards and in the bar.
   */
  const contentEdges = useMemo(() => edges.filter((edge) => !edge.viaChrome), [edges]);
  const inChrome = useMemo(
    () => new Set(edges.filter((edge) => edge.viaChrome).map((edge) => edge.toPageId)),
    [edges],
  );
  const orphans = useMemo(() => new Set(orphanPages(doc)), [doc]);

  const positions = useMemo(() => {
    const auto = autoLayout(doc, contentEdges);
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
  }, [doc, contentEdges, dragCard]);

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

  /*
   * Re-fit whenever the automatic layout moves, and never once the user has
   * arranged a card themselves.
   *
   * Keying on `doc.pages.length` alone was not enough: the columns come from the
   * link graph, so adding the nav after the pages exist re-laid the whole map
   * with no change in count, and two of three columns sat off the left edge with
   * no way to know they were there. Keying on every `positions` change is the
   * other failure — it would recentre the map under a card being dragged — so
   * the box is measured from the document, and one manual position switches the
   * automatic fit off for good. The Fit button stays.
   */
  const hasManualLayout = doc.pages.some((p) => typeof p.x === 'number' && typeof p.y === 'number');
  const layoutBox = hasManualLayout
    ? 'manual'
    : [...autoLayout(doc, contentEdges).values()]
        .map((p) => `${p.x},${p.y}`)
        .join(' ');
  useEffect(() => {
    if (hasManualLayout) return;
    fit();
  }, [layoutBox]); // eslint-disable-line react-hooks/exhaustive-deps

  const wireFrom = wire ? positions.get(wire.fromPageId) : undefined;

  return (
    // The card height is published as a custom property rather than repeated in
    // the stylesheet: the wire anchors are computed from CARD_H, so a card whose
    // CSS height had drifted from it would detach every wire from every edge —
    // silently, and only on the pages long enough to notice.
    <div className="fl" ref={viewportRef} style={{ ['--fl-card-h' as string]: `${CARD_H}px` }}>
      <header className="fl__bar">
        <div className="fl__title">
          <strong>Site map</strong>
          <span>
            {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
            {/* One page has nothing to link between, and saying so reads as a fault. */}
            {doc.pages.length > 1
              ? ` · ${contentEdges.length} ${contentEdges.length === 1 ? 'link' : 'links'} between them`
              : ''}
            {inChrome.size ? ` · ${inChrome.size} in the shared nav` : ''}
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
            {contentEdges.map((edge) => {
              const from = positions.get(edge.fromPageId);
              const to = positions.get(edge.toPageId);
              if (!from || !to) return null;
              const { d, mid } = wirePath(from, to);
              return (
                <g className="fl__wire" key={`${edge.fromPageId}->${edge.toPageId}`}>
                  <path className="fl__wire-hit" d={d} />
                  <path className="fl__wire-line" d={d} />
                  <foreignObject x={mid.x - 60} y={mid.y - 13} width={120} height={26}>
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
              /*
               * The draft follows the pointer, so it always leaves the port on
               * the right edge and ends exactly where the cursor is. Routing it
               * through `wirePath` meant the vertical branch offset the end by
               * half a card and the line stopped tracking the cursor.
               */
              <path
                className="fl__wire-draft"
                d={
                  sideRoute(
                    wireFrom.x + CARD_W,
                    wireFrom.y + CARD_H / 2,
                    wire.to.x,
                    wire.to.y,
                  ).d
                }
              />
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

                <div className="fl__meta">
                  <code className="fl__path">{pageFileName(page.path)}</code>
                  {inChrome.has(page.id) ? (
                    <span className="fl__navchip" title="Reached from the shared navigation">
                      in nav
                    </span>
                  ) : null}
                </div>

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
        Wires are links written on the page itself — pages in the shared nav are marked instead of
        wired · drag the dot on a card's right edge onto another page to add a nav link ·
        double-click a card to edit it
      </p>
    </div>
  );
}
