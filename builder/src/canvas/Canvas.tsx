/**
 * The canvas: layout, zoom, and every pointer interaction with the page.
 *
 * Interaction lives here rather than on the rendered components because the
 * components are shared with the export — they must stay free of editor
 * concerns. So the canvas listens on the frame document and works out what the
 * user meant from the event target's `data-node-id`.
 *
 * Drags are pointer-event based, never HTML5 drag-and-drop. HTML5 DnD cannot
 * carry a live preview across an iframe boundary, fires no events over the
 * frame's content, and gives no reliable way to cancel — all three of which this
 * editor needs.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Frame } from './Frame';
import { ContextPanel } from './ContextPanel';
import { InlineToolbar } from './InlineToolbar';
import { Overlay, type SelectionActions } from './Overlay';
import { asElement, nodeIdFromTarget, passedThreshold, resolveDropTarget, type Point } from './dnd';
import { BEGIN_DRAG_EVENT, type BeginDragDetail } from './dragSource';
import { buildCanvasCss } from '../core/canvas-css';
import { sanitizeInline } from '../core/sanitize';
import { deviceById, clampZoom, nextZoom } from '../core/devices';
import { nodeLabel } from '../core/factory';
import { canMutate, selectableAncestor } from '../core/tree';
import { dropRules } from '../registry/registry';
import { makeContext, RenderPage } from '../render/RenderNode';
import { useEditor } from '../store/editor';
import type { DragPayload, Rect } from '../core/types';
import type { Template } from '../registry/templates';

/** Padding around the device frame inside the scroll viewport. */
const GUTTER = 40;
/** Pointer distance from a frame edge that triggers auto-scroll while dragging. */
const AUTOSCROLL_EDGE = 60;
const AUTOSCROLL_SPEED = 18;

export function Canvas() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectedId = useEditor((s) => s.selectedId);
  const hoverId = useEditor((s) => s.hoverId);
  const device = useEditor((s) => s.device);
  const zoom = useEditor((s) => s.zoom);
  const zoomToFit = useEditor((s) => s.zoomToFit);
  const drag = useEditor((s) => s.drag);
  const editing = useEditor((s) => s.editing);

  const select = useEditor((s) => s.select);
  const selectParent = useEditor((s) => s.selectParent);
  const setHover = useEditor((s) => s.setHover);
  const beginEdit = useEditor((s) => s.beginEdit);
  const endEdit = useEditor((s) => s.endEdit);
  const setProp = useEditor((s) => s.setProp);
  const startDrag = useEditor((s) => s.startDrag);
  const updateDrag = useEditor((s) => s.updateDrag);
  const endDrag = useEditor((s) => s.endDrag);
  const insertPayload = useEditor((s) => s.insertPayload);
  const setZoom = useEditor((s) => s.setZoom);
  const reorderSibling = useEditor((s) => s.reorderSibling);
  const duplicate = useEditor((s) => s.duplicate);
  const remove = useEditor((s) => s.remove);

  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  /** Bumped when an edit session leaves DOM React did not create. See `settle`. */
  const [remount, setRemount] = useState<{ id: string; n: number } | null>(null);
  /** Set when the canvas frame is unreachable, so the failure is visible. */
  const [frameError, setFrameError] = useState<string | null>(null);
  /** Selection rectangle, published by the overlay for the context panel. */
  const [selectedRect, setSelectedRect] = useState<Rect | null>(null);
  /** True while a text range is selected, so the two floating bars never stack. */
  const [rangeActive, setRangeActive] = useState(false);

  const preset = deviceById(device);
  const page = doc.pages.find((candidate) => candidate.id === currentPageId) ?? doc.pages[0];

  const css = useMemo(() => buildCanvasCss(doc), [doc]);
  const ctx = useMemo(() => makeContext(doc, 'canvas', remount), [doc, remount]);

  /* ---------------- sizing + zoom ---------------- */

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const fitZoom = useMemo(() => {
    if (!viewport.width) return 1;
    return clampZoom(Math.min(1, (viewport.width - GUTTER * 2) / preset.width));
  }, [viewport.width, preset.width]);

  const effectiveZoom = zoomToFit ? fitZoom : zoom;

  // The frame is sized so that, once scaled, it fills the visible area exactly.
  // That keeps a single scrollbar (the frame's own) and makes `vh` units behave
  // like a real viewport instead of resolving against the whole document height.
  const frameHeight = Math.max(
    420,
    Math.round((viewport.height - GUTTER * 2) / Math.max(effectiveZoom, 0.05)),
  );

  /* ---------------- coordinate conversion ---------------- */

  /** Client (editor) coordinates → frame coordinates. */
  const toFramePoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = frameRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      // rect is the *scaled* box, so dividing by its own scale factor is exact
      // even if the zoom transform changed between renders.
      const scaleX = rect.width / el.offsetWidth;
      const scaleY = rect.height / el.offsetHeight;
      return { x: (clientX - rect.left) / scaleX, y: (clientY - rect.top) / scaleY };
    },
    [],
  );

  /* ---------------- drag engine ---------------- */

  /**
   * Hand focus back to the editor shell.
   *
   * Keydown events inside the frame never cross the iframe boundary, so once the
   * user has clicked into the canvas the global shortcuts are dead until they
   * click chrome again. Returning focus after a gesture that did not open an
   * editor keeps ⌘Z and ⌫ working where the user expects.
   */
  const focusShell = useCallback(() => {
    viewportRef.current?.focus({ preventScroll: true });
  }, []);

  const pending = useRef<{
    payload: DragPayload;
    origin: Point;
    template?: Template;
    /** Runs when the gesture never became a drag, i.e. it was a click. */
    onTap?: () => void;
  } | null>(null);
  const autoScroll = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current);
      autoScroll.current = null;
    }
  }, []);

  const runAutoScroll = useCallback(
    (point: Point) => {
      stopAutoScroll();
      const scroller = frameRef.current?.contentDocument?.scrollingElement;
      if (!scroller) return;
      const height = frameRef.current?.offsetHeight ?? 0;
      let delta = 0;
      if (point.y < AUTOSCROLL_EDGE) delta = -AUTOSCROLL_SPEED;
      else if (point.y > height - AUTOSCROLL_EDGE) delta = AUTOSCROLL_SPEED;
      if (delta === 0) return;

      const step = () => {
        scroller.scrollTop += delta;
        autoScroll.current = requestAnimationFrame(step);
      };
      autoScroll.current = requestAnimationFrame(step);
    },
    [stopAutoScroll],
  );

  const resolveAt = useCallback(
    (point: Point) => {
      const el = frameRef.current;
      const state = useEditor.getState();
      if (!el || !state.drag) return;
      const { target, rejection } = resolveDropTarget(el, state.doc, state.drag.payload, point);
      updateDrag({ point, target, ...(rejection ? { rejection } : { rejection: undefined }) });
      runAutoScroll(point);
    },
    [runAutoScroll, updateDrag],
  );

  /**
   * Shared move handler. `framePoint` is in frame coordinates (null when the
   * pointer is nowhere near the frame); `clientPoint` is in editor coordinates
   * and is only used for the drag threshold.
   */
  const onDragMove = useCallback(
    (framePoint: Point | null, clientPoint: Point) => {
      const state = useEditor.getState();

      if (pending.current && !state.drag) {
        if (!passedThreshold(pending.current.origin, clientPoint)) return;
        startDrag(pending.current.payload, pending.current.origin, pending.current.template);
      }
      if (!useEditor.getState().drag) return;
      if (!useEditor.getState().drag?.active) updateDrag({ active: true });

      const el = frameRef.current;
      const inside =
        framePoint !== null &&
        el !== null &&
        framePoint.x >= 0 &&
        framePoint.y >= 0 &&
        framePoint.x <= el.offsetWidth &&
        framePoint.y <= el.offsetHeight;

      if (inside && framePoint) {
        resolveAt(framePoint);
      } else {
        // Outside the device frame there is nothing to drop onto. Clearing the
        // target is what makes "release off-canvas to cancel" work.
        stopAutoScroll();
        updateDrag({ target: null, rejection: undefined });
      }
    },
    [resolveAt, startDrag, stopAutoScroll, updateDrag],
  );

  /**
   * `cancelled` distinguishes a release from an abort.
   *
   * `pointercancel` fires when the browser takes the gesture over — a touch pan
   * that began on a heading, for instance. Treating that as a click opened an
   * edit session and raised the soft keyboard on someone who was only trying to
   * scroll, so an abort must neither open an editor nor complete a drop.
   */
  const finishDrag = useCallback((cancelled = false) => {
    stopAutoScroll();
    const tap = pending.current?.onTap;
    pending.current = null;
    const current = useEditor.getState().drag;

    // A press that never crossed the drag threshold is a click. It is resolved
    // here rather than through an `onClick` handler because pointer capture makes
    // the browser fire `click` on the source element even after a completed drag
    // — so having both paths meant every drag also ran the click action.
    if (!current || !current.active) {
      if (!cancelled) tap?.();
      if (current) endDrag();
      return;
    }

    if (!cancelled && current.target) {
      const { parentId, index } = current.target;
      const created = current.template
        ? useEditor.getState().insertTemplateAt(current.template, parentId, index)
        : insertPayload(current.payload, parentId, index);
      if (!created && current.payload.kind === 'new') {
        useEditor.getState().toast('That element cannot go there', 'error');
      }
    }
    endDrag();
  }, [endDrag, insertPayload, stopAutoScroll]);

  /* ---------------- events inside the frame ---------------- */

  useEffect(() => {
    const el = frame;
    const frameDoc = el?.contentDocument;
    if (!el || !frameDoc) return;

    // These use `asElement`, not `instanceof`: see the note in `dnd.ts` — the
    // event targets here belong to the iframe's realm.
    const nodeIdAt = (target: EventTarget | null): string | null => nodeIdFromTarget(target);

    const isEditingTarget = (target: EventTarget | null): boolean =>
      asElement(target)?.closest('[contenteditable="true"]') != null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (isEditingTarget(event.target)) return;

      const id = nodeIdAt(event.target);
      useEditor.getState().endEdit();
      select(id);

      // One click both selects and starts editing text. Requiring a second click
      // was a tax on the most common action in the editor; dragging still works
      // because editing begins on *release*, and only if the pointer never
      // travelled far enough to be a drag.
      const editSlot = asElement(event.target)?.closest<HTMLElement>('[data-edit]');
      const editKey = editSlot?.dataset.edit;
      // Frame coordinates, so the caret can be placed where they clicked.
      const caretAt = { x: event.clientX, y: event.clientY };

      const state = useEditor.getState();
      const resolved = state.selectedId;
      // Page roots and locked nodes are selectable but not draggable.
      if (resolved && resolved === id && state.doc.nodes[id]?.parent) {
        pending.current = {
          payload: { kind: 'move', nodeId: resolved },
          ...(editKey ? { onTap: () => beginEdit(resolved, editKey, { caretAt }) } : {}),
          // Origins are always stored in client space, so the drag threshold is
          // compared the same way whether the gesture began inside the frame or
          // in the editor chrome.
          origin: screenPointFromFrame(el, { x: event.clientX, y: event.clientY }),
        };
        // Capture on the frame root rather than the target: the element under
        // the pointer gets re-rendered as the document changes, and losing
        // capture mid-drag would abandon the gesture.
        try {
          frameDoc.documentElement.setPointerCapture(event.pointerId);
        } catch {
          /* capture is an optimisation, not a requirement */
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const client = { x: event.clientX, y: event.clientY };
      if (pending.current || useEditor.getState().drag) {
        // Inside the frame, clientX/Y already *are* frame coordinates; the
        // threshold test needs the client space the origin was stored in.
        onDragMove(client, screenPointFromFrame(el, client));
        return;
      }
      const id = nodeIdAt(event.target);
      setHover(id);
    };

    const releaseCapture = (event: PointerEvent) => {
      if (frameDoc.documentElement.hasPointerCapture?.(event.pointerId)) {
        frameDoc.documentElement.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      releaseCapture(event);
      // `finishDrag` also resolves the tap case, so it has to run even when no
      // drag ever started — a press that never moved is how click-to-edit fires.
      const wasTap = pending.current !== null && !useEditor.getState().drag?.active;
      if (pending.current || useEditor.getState().drag) finishDrag();
      pending.current = null;
      // Keyboard events inside the frame never reach the parent window, so a
      // click that did not open an editor would otherwise leave every global
      // shortcut inert until the user clicked editor chrome again.
      if (wasTap && !useEditor.getState().editing) focusShell();
    };

    const onPointerCancel = (event: PointerEvent) => {
      releaseCapture(event);
      if (pending.current || useEditor.getState().drag) finishDrag(true);
      pending.current = null;
    };

    const onPointerLeave = () => setHover(null);

    const onDoubleClick = (event: MouseEvent) => {
      const target = asElement(event.target);
      if (!target) return;
      const slot = target.closest<HTMLElement>('[data-edit]');
      const holder = target.closest<HTMLElement>('[data-node-id]');
      if (!slot || !holder?.dataset.nodeId) return;
      // The pointer path routes selection through `selectableAncestor`; without
      // the same guard here a double-click could edit — and select — a locked node.
      const nodeId = holder.dataset.nodeId;
      if (selectableAncestor(useEditor.getState().doc.nodes, nodeId) !== nodeId) return;
      event.preventDefault();
      // Double-click means "replace this", so it selects the whole slot.
      beginEdit(nodeId, slot.dataset.edit as string, { selectAll: true });
    };

    // Links and form controls must not navigate or submit inside the editor.
    // Unconditional: once a click has made a link's <a href> an editing host, a
    // cmd-click would navigate the frame and replace the document React portals
    // into, blanking the canvas until it remounts. Caret placement comes from
    // pointerdown and `placeCaret`, never from the click default, so nothing is
    // lost by cancelling it always.
    const onClickCapture = (event: MouseEvent) => {
      event.preventDefault();
    };

    frameDoc.addEventListener('pointerdown', onPointerDown);
    frameDoc.addEventListener('pointermove', onPointerMove);
    frameDoc.addEventListener('pointerup', onPointerUp);
    frameDoc.addEventListener('pointercancel', onPointerCancel);
    frameDoc.addEventListener('pointerleave', onPointerLeave);
    frameDoc.addEventListener('dblclick', onDoubleClick);
    frameDoc.addEventListener('click', onClickCapture, true);

    return () => {
      frameDoc.removeEventListener('pointerdown', onPointerDown);
      frameDoc.removeEventListener('pointermove', onPointerMove);
      frameDoc.removeEventListener('pointerup', onPointerUp);
      frameDoc.removeEventListener('pointercancel', onPointerCancel);
      frameDoc.removeEventListener('pointerleave', onPointerLeave);
      frameDoc.removeEventListener('dblclick', onDoubleClick);
      frameDoc.removeEventListener('click', onClickCapture, true);
    };
  }, [frame, select, setHover, beginEdit, onDragMove, finishDrag]);

  /* ---------------- events in the parent document ---------------- */

  // A drag that starts in the palette or the layers tree is captured by an
  // element in the editor document, so its moves arrive here.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!pending.current && !drag) return;
      onDragMove(toFramePoint(event.clientX, event.clientY), { x: event.clientX, y: event.clientY });
    };
    const onUp = () => {
      if (pending.current || useEditor.getState().drag) finishDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, finishDrag, onDragMove, toFramePoint]);

  // Exposed on the store-free window so the palette and layer rows can start a
  // drag without threading refs through the whole tree.
  useEffect(() => {
    const begin = (event: CustomEvent<BeginDragDetail>) => {
      pending.current = {
        payload: event.detail.payload,
        origin: { x: event.detail.x, y: event.detail.y },
        ...(event.detail.template ? { template: event.detail.template } : {}),
        ...(event.detail.onTap ? { onTap: event.detail.onTap } : {}),
      };
    };
    window.addEventListener(BEGIN_DRAG_EVENT, begin as EventListener);
    return () => window.removeEventListener(BEGIN_DRAG_EVENT, begin as EventListener);
  }, []);

  /* ---------------- ctrl/cmd + wheel zoom ---------------- */

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const state = useEditor.getState();
      const current = state.zoomToFit ? fitZoom : state.zoom;
      setZoom(nextZoom(current, event.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fitZoom, setZoom]);

  /* ---------------- inline text editing ---------------- */

  useEffect(() => {
    const frameDoc = frame?.contentDocument;
    const frameWin = frame?.contentWindow;
    if (!frameDoc || !frameWin || !editing) return;

    const holder = frameDoc.querySelector<HTMLElement>(`[data-node-id="${editing.nodeId}"]`);
    if (!holder) return;
    const el =
      holder.dataset.edit === editing.key
        ? holder
        : holder.querySelector<HTMLElement>(`[data-edit="${CSS.escape(editing.key)}"]`);
    if (!el) return;

    // Both sides of the "did it change?" test must be normalised the same way.
    // They were not: `before` was raw and the committed value was trimmed, and
    // because `trim()` does not strip U+200B — the zero-width space `Txt` renders
    // so an empty slot stays clickable — merely clicking an empty heading wrote
    // the prop and pushed an undo entry.
    const beforeValue = normaliseSlotHtml(el.innerHTML);

    // `setAttribute` rather than the `contentEditable` property: both work in a
    // browser, but the attribute is what `[contenteditable="true"]` selectors and
    // non-browser DOM implementations actually see.
    el.setAttribute('contenteditable', 'true');
    el.spellcheck = false;
    el.focus({ preventScroll: true });

    // Emit tags rather than styled spans, so bold survives the sanitiser: a
    // `<span style="font-weight:bold">` would lose its style attribute and the
    // formatting with it.
    try {
      frameDoc.execCommand('styleWithCSS', false, 'false');
    } catch {
      /* not supported; the sanitiser still normalises whatever arrives */
    }

    // Double-click asked for the whole slot; a single click wants the caret where
    // it landed. Selecting everything on a plain click would arm a full text wipe
    // on the next keystroke.
    const wantsCaret = !editing.selectAll && editing.caretAt !== undefined;
    if (!wantsCaret || !placeCaret(frameDoc, frameWin, el, editing.caretAt as Point)) {
      const range = frameDoc.createRange();
      range.selectNodeContents(el);
      const selection = frameWin.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    /*
     * An edit session settles exactly once.
     *
     * The previous version only committed on `blur`, and tore the listener down
     * in the effect cleanup. That was survivable when editing needed a second
     * click, but with one-click editing "click text A, type, click text B" is the
     * normal way to work — and it silently threw away everything typed into A,
     * because cleanup ran before blur. Committing from the cleanup path as well,
     * guarded by `settled`, is what makes the text safe.
     */
    let settled = false;
    // Whether the browser actually changed the subtree. If it did, React's view
    // of these children is stale and the node has to be remounted on settle;
    // if it did not, clicking text purely to select it stays free.
    let dirty = false;

    const settle = (mode: 'commit' | 'revert') => {
      if (settled) return;
      settled = true;

      if (mode === 'commit') {
        // Sanitised on the way in as well as the way out: this is what normalises
        // whatever the browser's formatting commands emitted (Chrome's <b>,
        // Safari's styled spans) down to the inline subset the document stores.
        const value = normaliseSlotHtml(el.innerHTML);
        if (value !== beforeValue) setProp(editing.nodeId, editing.key, value);
      }
      // Revert writes nothing at all. Assigning `textContent` here used to
      // replace the text node React tracks, after which later prop changes to
      // this node silently stopped rendering; letting React rebuild from the
      // unchanged prop is both simpler and correct.

      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('input', onInput);
      el.setAttribute('contenteditable', 'false');

      /*
       * Remount the edited node when the browser touched its children.
       *
       * The session mutates a subtree React owns. Typing shift+Enter makes Chrome
       * append a `<br>` and a text node React never created; ⌘A then Delete
       * removes the node React tracks. Either way React's next update leaves
       * orphans behind — duplicated lines, or a heading collapsed to 0px that can
       * never be clicked again. Bumping a key forces a clean rebuild.
       *
       * Skipped when the replacement session targets the same node: that
       * session's own settle bumps later, and remounting now would hand it an
       * element about to be discarded.
       */
      if (dirty && useEditor.getState().editing?.nodeId !== editing.nodeId) {
        setRemount((current) => ({ id: editing.nodeId, n: (current?.n ?? 0) + 1 }));
      }
    };

    const onInput = () => {
      dirty = true;
    };

    const onBlur = () => {
      // Focus moved into the canvas link popover, not away from the text. Its
      // input has to be focusable to be typed into, and ending the session here
      // would unmount the toolbar mid-interaction and drop the selection.
      if (useEditor.getState().linkPopoverOpen) return;
      settle('commit');
      endEdit();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle('revert');
        // `settle` already removed the blur listener, so this cannot commit.
        el.blur();
        endEdit();
        focusShell();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        settle('commit');
        el.blur();
        endEdit();
        focusShell();
      }
    };

    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('input', onInput);

    // Committing here — not calling `endEdit` — is deliberate: the session is
    // ending because `editing` already moved on, and clearing it would cancel
    // the session that is replacing this one.
    return () => settle('commit');
  }, [editing, frame, setProp, endEdit, focusShell]);

  /* ---------------- render ---------------- */

  const selectedLabel = selectedId && doc.nodes[selectedId] ? nodeLabel(doc, doc.nodes[selectedId]) : '';

  // Action row shown on the selected element. Built here because the canvas is
  // where the geometry lives; the overlay only draws it.
  const selectedNode = selectedId ? doc.nodes[selectedId] : undefined;
  const siblings = selectedNode?.parent ? doc.nodes[selectedNode.parent]?.children ?? [] : [];
  const at = selectedId ? siblings.indexOf(selectedId) : -1;
  const mutable = selectedId ? canMutate(doc.nodes, dropRules, selectedId) : false;

  const actions: SelectionActions | undefined = selectedId
    ? {
        selectParent,
        moveUp: () => reorderSibling(selectedId, -1),
        moveDown: () => reorderSibling(selectedId, 1),
        duplicate: () => duplicate(selectedId),
        remove: () => remove(selectedId),
        canGoUp: Boolean(selectedNode?.parent),
        canMoveUp: mutable && at > 0,
        canMoveDown: mutable && at >= 0 && at < siblings.length - 1,
        canMutate: mutable,
      }
    : undefined;

  return (
    <div
      className="cv"
      ref={viewportRef}
      // Focusable so `focusShell` can bring keyboard focus back out of the frame.
      tabIndex={-1}
      data-dragging={drag?.active ? 'true' : undefined}
    >
      <div
        className="cv-stage"
        style={{
          width: `${preset.width}px`,
          height: `${frameHeight}px`,
          transform: `scale(${effectiveZoom})`,
        }}
      >
        <Frame
          width={preset.width}
          height={frameHeight}
          css={css}
          title={`${page.name} preview`}
          onReady={(el) => {
            frameRef.current = el;
            setFrame(el);
            setFrameError(null);
          }}
          onUnavailable={setFrameError}
        >
          <RenderPage ctx={ctx} rootId={page.rootId} />
        </Frame>

        {frameError ? (
          <div className="cv-frameerror" role="alert">
            <strong>The canvas could not load</strong>
            <p>{frameError}</p>
          </div>
        ) : null}

        <InlineToolbar
          frame={frame}
          active={editing !== null}
          zoom={effectiveZoom}
          onRangeChange={setRangeActive}
        />

        <ContextPanel
          rect={selectedRect}
          frameSize={{ width: preset.width, height: frameHeight }}
          zoom={effectiveZoom}
          suppressed={rangeActive}
        />

        <Overlay
          frame={frame}
          selectedId={selectedId}
          hoverId={drag?.active ? null : hoverId}
          selectedLabel={selectedLabel}
          version={doc.updatedAt}
          drop={drag?.active ? drag.target : null}
          dragPoint={drag?.active && !drag.target ? drag.point : null}
          rejection={drag?.rejection}
          zoom={effectiveZoom}
          actions={actions}
          editing={editing !== null}
          onSelectedRect={setSelectedRect}
        />
      </div>
    </div>
  );
}

/**
 * Canonical form of a slot's contents, used on both sides of the change test.
 *
 * Sanitising both sides is what makes the comparison meaningful: the browser
 * rewrites markup as the user types and formats, and only the normalised form is
 * stable. `trim()` alone was never enough either — a non-breaking space is
 * whitespace to a reader but not to `trim`, and U+200B is not whitespace at all.
 */
function normaliseSlotHtml(html: string): string {
  return sanitizeInline(html)
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .trim();
}

/**
 * Put the caret at a point inside `el`.
 *
 * `caretPositionFromPoint` is the standard; WebKit still ships the older
 * `caretRangeFromPoint`. Returns false when neither is available or the point
 * maps outside `el`, so the caller can fall back to selecting the whole slot.
 */
function placeCaret(
  frameDoc: Document,
  frameWin: Window,
  el: HTMLElement,
  at: Point,
): boolean {
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const doc = frameDoc as CaretDoc;

  let range: Range | null = null;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(at.x, at.y);
    if (position) {
      range = frameDoc.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    range = doc.caretRangeFromPoint(at.x, at.y);
  }

  // A point just outside the text would otherwise drop the caret into a sibling.
  if (!range || !el.contains(range.startContainer)) return false;

  const selection = frameWin.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

/** Frame coordinates → client coordinates, for the shared drag threshold test. */
function screenPointFromFrame(frame: HTMLIFrameElement, client: Point): Point {
  const rect = frame.getBoundingClientRect();
  const scaleX = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
  const scaleY = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
  return { x: rect.left + client.x * scaleX, y: rect.top + client.y * scaleY };
}
