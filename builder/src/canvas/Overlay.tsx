/**
 * Selection, hover and drop-indicator chrome.
 *
 * Drawn in the *parent* document, in a layer that exactly covers the iframe.
 * Rectangles come from `getBoundingClientRect()` inside the frame, which is
 * already relative to the frame's viewport and already accounts for its scroll
 * position — so a frame-space rect can be used as an overlay position directly,
 * with no arithmetic to get wrong.
 *
 * The layer is `pointer-events: none` so every pointer event still reaches the
 * page being edited.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DropTarget, Rect } from '../core/types';

export interface OverlayProps {
  frame: HTMLIFrameElement | null;
  selectedId: string | null;
  hoverId: string | null;
  selectedLabel: string;
  /** Bumped by the canvas whenever geometry may have changed. */
  version: number;
  drop: DropTarget | null;
  /** Pointer position in frame coordinates, while a drag is active. */
  dragPoint?: { x: number; y: number } | null;
  /** Why the current position is not a valid drop, if it is not. */
  rejection?: string | undefined;
  /** Zoom, used to keep the chrome one physical pixel wide at any scale. */
  zoom: number;
  /** Actions for the selected element, shown in the badge next to its name. */
  actions?: SelectionActions;
  /**
   * True while an inline text edit is open.
   *
   * The action row and the formatting toolbar both anchor above the element and
   * would sit on top of each other. Restructuring is not what anyone is doing
   * mid-sentence, so the row stands down and the formatting toolbar gets the space.
   */
  editing?: boolean;
}

/**
 * The action row on the selected element.
 *
 * Ordered the way the operations relate to each other — go up a level, move
 * within the level, copy, remove — so the destructive one is last and always in
 * the same place. Delete used to live only on a keyboard shortcut and three
 * clicks deep in the Settings tab.
 */
export interface SelectionActions {
  selectParent: () => void;
  moveUp: () => void;
  moveDown: () => void;
  duplicate: () => void;
  remove: () => void;
  canGoUp: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMutate: boolean;
}

/**
 * Plain-language reason a drop is refused.
 *
 * Without this the drag simply does nothing on release, which reads as a broken
 * editor rather than a rule. Naming the rule is the difference between "this is
 * buggy" and "oh, sections go at the page level".
 */
const REJECTION_TEXT: Record<string, string> = {
  'not-a-container': 'This element cannot hold others',
  'child-rejected': 'Not allowed inside this element',
  'parent-rejected': 'This element does not belong here',
  'locked-parent': 'That container is locked',
  'into-descendant': 'Cannot drop inside itself',
  'into-self': 'Cannot drop inside itself',
  'fixed-node': 'This element cannot be moved',
  'unknown-node': 'No drop target',
  'unknown-type': 'No drop target',
};

function rectOf(frame: HTMLIFrameElement | null, id: string | null): Rect | null {
  if (!frame || !id) return null;
  const el = frame.contentDocument?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function Overlay({
  frame,
  selectedId,
  hoverId,
  selectedLabel,
  version,
  drop,
  dragPoint,
  rejection,
  zoom,
  actions,
  editing = false,
}: OverlayProps) {
  const [selected, setSelected] = useState<Rect | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    setSelected(rectOf(frame, selectedId));
    setHover(hoverId && hoverId !== selectedId ? rectOf(frame, hoverId) : null);
  }, [frame, selectedId, hoverId]);

  useEffect(measure, [measure, version]);

  // Fonts and images change layout after the fact, so re-measure when the frame
  // itself reflows rather than only when React re-renders.
  useEffect(() => {
    const frameDoc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!frameDoc || !win) return;

    const onScroll = () => measure();
    frameDoc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onScroll);

    const observer = new ResizeObserver(() => measure());
    observer.observe(frameDoc.documentElement);
    if (frameDoc.body) observer.observe(frameDoc.body);

    return () => {
      frameDoc.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', onScroll);
      observer.disconnect();
    };
  }, [frame, measure]);

  // Hairlines stay 1px on screen however far the canvas is zoomed out.
  const hair = `${Math.max(0.5, 1 / zoom)}px`;
  const ring = `${Math.max(1, 2 / zoom)}px`;
  const labelScale = 1 / zoom;

  return (
    <div className="cv-overlay" aria-hidden="true">
      {hover ? (
        <div
          className="cv-hover"
          style={{ ...box(hover), outlineWidth: hair }}
        />
      ) : null}

      {selected ? (
        <div className="cv-selected" style={{ ...box(selected), outlineWidth: ring }}>
          {/* Flips inside the element when there is no room above it. */}
          <div
            className={`cv-bar ${selected.top < 30 / zoom ? 'is-inside' : ''} ${editing ? 'is-hidden' : ''}`}
            style={{ transform: `scale(${labelScale})` }}
          >
            <button
              type="button"
              className="cv-tag"
              onClick={actions?.selectParent}
              disabled={!actions?.canGoUp}
              title={actions?.canGoUp ? 'Select parent' : undefined}
              tabIndex={-1}
            >
              {selectedLabel}
            </button>

            {actions ? (
              <span className="cv-acts">
                <BarButton
                  label="Select parent"
                  path="M12 19V5M5 12l7-7 7 7"
                  onClick={actions.selectParent}
                  disabled={!actions.canGoUp}
                />
                <BarButton
                  label="Move up"
                  path="M18 15l-6-6-6 6"
                  onClick={actions.moveUp}
                  disabled={!actions.canMoveUp}
                />
                <BarButton
                  label="Move down"
                  path="M6 9l6 6 6-6"
                  onClick={actions.moveDown}
                  disabled={!actions.canMoveDown}
                />
                <BarButton
                  label="Duplicate"
                  path="M9 9h11v11H9zM4 15V4h11"
                  onClick={actions.duplicate}
                  disabled={!actions.canMutate}
                />
                <BarButton
                  label="Delete"
                  path="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
                  onClick={actions.remove}
                  disabled={!actions.canMutate}
                  danger
                />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {drop?.parentRect ? (
        <div className="cv-drop-parent" style={{ ...box(drop.parentRect), outlineWidth: ring }} />
      ) : null}

      {!drop && dragPoint ? (
        <div
          className="cv-nodrop"
          style={{
            top: `${dragPoint.y}px`,
            left: `${dragPoint.x}px`,
            transform: `scale(${labelScale})`,
          }}
        >
          {rejection ? (REJECTION_TEXT[rejection] ?? 'Cannot drop here') : 'Cannot drop here'}
        </div>
      ) : null}

      {drop ? (
        <div
          className={`cv-drop-line ${drop.horizontal ? 'is-h' : 'is-v'}`}
          style={
            drop.horizontal
              ? {
                  top: `${drop.rect.top}px`,
                  left: `${drop.rect.left}px`,
                  width: `${drop.rect.width}px`,
                  height: `${Math.max(2, 3 / zoom)}px`,
                  marginTop: `${-Math.max(1, 1.5 / zoom)}px`,
                }
              : {
                  top: `${drop.rect.top}px`,
                  left: `${drop.rect.left}px`,
                  height: `${drop.rect.height}px`,
                  width: `${Math.max(2, 3 / zoom)}px`,
                  marginLeft: `${-Math.max(1, 1.5 / zoom)}px`,
                }
          }
        />
      ) : null}
    </div>
  );
}

function BarButton({
  label,
  path,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  path: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`cv-act ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      tabIndex={-1}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </button>
  );
}

function box(rect: Rect) {
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}
