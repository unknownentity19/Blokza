/**
 * Starting a drag from the editor chrome (palette cards, layer rows).
 *
 * Kept out of `Canvas.tsx` deliberately: a module that exports both a component
 * and a plain function cannot be hot-reloaded by React Fast Refresh, and the
 * canvas is the file most worth having working HMR on.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DragPayload } from '../core/types';
import type { Template } from '../registry/templates';

export interface DragSourceOptions {
  /** Section templates expand to a tree; the payload names their root type. */
  template?: Template;
  /** Runs when the press never travelled far enough to be a drag. */
  onTap?: () => void;
}

export interface BeginDragDetail extends DragSourceOptions {
  payload: DragPayload;
  x: number;
  y: number;
}

export const BEGIN_DRAG_EVENT = 'sb:begin-drag';

/**
 * Arms a drag. The canvas listens for the event and owns the gesture from here.
 *
 * Pointer capture on the source element is what keeps the gesture alive as the
 * pointer travels over the canvas iframe: captured events are delivered to the
 * capturing element in the *editor* document, so the canvas's window listeners
 * keep receiving them instead of the events vanishing into the frame.
 */
export function beginDragFromChrome(
  payload: DragPayload,
  event: ReactPointerEvent,
  options: DragSourceOptions = {},
): void {
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  const detail: BeginDragDetail = {
    payload,
    x: event.clientX,
    y: event.clientY,
    ...options,
  };
  window.dispatchEvent(new CustomEvent<BeginDragDetail>(BEGIN_DRAG_EVENT, { detail }));
}
