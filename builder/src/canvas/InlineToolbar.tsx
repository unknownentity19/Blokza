/**
 * The formatting toolbar that follows a text selection on the canvas.
 *
 * It lives in the *parent* document, inside the overlay layer that covers the
 * iframe, and is positioned from the frame selection's own rectangle — the same
 * coordinate trick the selection badge uses. That is why it can float over the
 * page being edited without being part of it.
 *
 * The single most important detail is `onMouseDown={preventDefault}` on every
 * button: without it, pressing a button moves focus out of the frame, which
 * fires the editable element's `blur`, which ends the edit session and destroys
 * the very selection the button was about to format.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '../ui/common';
import { anchorsOnPage } from '../core/doc';
import { safeHref } from '../core/sanitize';
import { useEditor } from '../store/editor';
import type { Rect } from '../core/types';

export interface InlineToolbarProps {
  frame: HTMLIFrameElement | null;
  /** Set while an inline edit session is open. */
  active: boolean;
  zoom: number;
}

interface SelectionState {
  rect: Rect;
  bold: boolean;
  italic: boolean;
  /** Existing href when the selection sits inside a link. */
  href: string | null;
  /**
   * Whether bold/italic can do anything here.
   *
   * On a heading already set to `font-weight: 700` by its own styles, the browser
   * reads the selection as bold and "bold" becomes *un*-bold — which it can only
   * express as an inline style, which the sanitiser strips, so the click appears
   * to do nothing. Offering a control that cannot work is worse than not
   * offering it, so those buttons stand down.
   */
  canBold: boolean;
  canItalic: boolean;
}

/** Command state, read from the frame document. */
function readSelection(frame: HTMLIFrameElement): SelectionState | null {
  const frameDoc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!frameDoc || !win) return null;

  const selection = win.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const host = (range.commonAncestorContainer as Element).nodeType === 1
    ? (range.commonAncestorContainer as Element)
    : range.commonAncestorContainer.parentElement;
  if (!host?.closest('[contenteditable="true"]')) return null;

  // A collapsed caret has nothing to format, and a toolbar that appears on every
  // click would sit in front of the text the user is trying to read.
  if (selection.isCollapsed) return null;

  const box = range.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;

  const anchor = host.closest('a');
  const slot = host.closest('[contenteditable="true"]');
  const slotStyle = slot ? win.getComputedStyle(slot) : null;
  const inheritedWeight = Number(slotStyle?.fontWeight ?? '400');

  return {
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
    bold: safeQuery(frameDoc, 'bold'),
    italic: safeQuery(frameDoc, 'italic'),
    href: anchor ? anchor.getAttribute('href') : null,
    canBold: !Number.isFinite(inheritedWeight) || inheritedWeight < 600,
    canItalic: slotStyle?.fontStyle !== 'italic',
  };
}

function safeQuery(frameDoc: Document, command: string): boolean {
  try {
    return frameDoc.queryCommandState(command);
  } catch {
    return false;
  }
}

export function InlineToolbar({ frame, active, zoom }: InlineToolbarProps) {
  const [state, setState] = useState<SelectionState | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  /** The range to restore before applying a command, since the link field takes focus. */
  const savedRange = useRef<Range | null>(null);

  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const setLinkPopoverOpen = useEditor((s) => s.setLinkPopoverOpen);
  const anchors = anchorsOnPage(doc, currentPageId);

  /** The editable element the saved range lives in, so focus can be returned. */
  const editableHost = useCallback((): HTMLElement | null => {
    const container = savedRange.current?.commonAncestorContainer;
    if (!container) return null;
    const el = container.nodeType === 1 ? (container as Element) : container.parentElement;
    return (el?.closest('[contenteditable="true"]') as HTMLElement | null) ?? null;
  }, []);

  /** Close the popover and hand focus back to the text, so typing resumes. */
  const closeLink = useCallback(
    (refocus: boolean) => {
      setLinkOpen(false);
      setLinkPopoverOpen(false);
      if (refocus) {
        editableHost()?.focus({ preventScroll: true });
        restoreRef.current?.();
      }
    },
    [editableHost, setLinkPopoverOpen],
  );

  /** Indirection so `closeLink` can restore without depending on `restore`. */
  const restoreRef = useRef<(() => void) | null>(null);

  /* Track the frame's selection. `selectionchange` only fires on the document
     that owns the selection, so it has to be bound inside the frame. */
  useEffect(() => {
    const frameDoc = frame?.contentDocument;
    if (!frameDoc || !active) {
      setState(null);
      setLinkOpen(false);
      setLinkPopoverOpen(false);
      return;
    }
    const sync = () => {
      // While the popover is open the frame selection is deliberately parked in
      // `savedRange`; re-reading it would collapse the toolbar out from under it.
      if (useEditor.getState().linkPopoverOpen) return;
      const next = readSelection(frame);
      setState(next);
      if (!next) setLinkOpen(false);
    };
    sync();
    frameDoc.addEventListener('selectionchange', sync);
    frameDoc.addEventListener('mouseup', sync);
    frameDoc.addEventListener('keyup', sync);
    return () => {
      frameDoc.removeEventListener('selectionchange', sync);
      frameDoc.removeEventListener('mouseup', sync);
      frameDoc.removeEventListener('keyup', sync);
    };
  }, [frame, active, setLinkPopoverOpen]);

  const remember = useCallback(() => {
    const selection = frame?.contentWindow?.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  }, [frame]);

  const restore = useCallback(() => {
    const selection = frame?.contentWindow?.getSelection();
    if (!selection || !savedRange.current) return;
    selection.removeAllRanges();
    selection.addRange(savedRange.current);
  }, [frame]);

  restoreRef.current = restore;

  /**
   * Apply a command to the frame's selection.
   *
   * `execCommand` is deprecated and the replacement does not exist; it remains
   * the only broadly-supported way to transform a contenteditable range. The
   * safety net is that whatever it emits is normalised by the sanitiser when the
   * session commits, so browser differences cannot reach the document.
   */
  const run = useCallback(
    (command: string, value?: string) => {
      const frameDoc = frame?.contentDocument;
      if (!frameDoc) return;
      // Commands act on the document's selection, so the editable element has to
      // hold focus again after the popover borrowed it.
      editableHost()?.focus({ preventScroll: true });
      restore();
      try {
        frameDoc.execCommand(command, false, value);
      } catch {
        /* unsupported command: nothing changes */
      }
      // The command mutated the DOM, so re-read what is now selected.
      setState(readSelection(frame as HTMLIFrameElement));
    },
    [frame, restore, editableHost],
  );

  if (!active || !state) return null;

  const scale = 1 / zoom;
  const applyLink = (href: string) => {
    const clean = href.trim();
    if (!clean) {
      run('unlink');
    } else {
      // Internal paths and anchors are stored as written; the export rewrites
      // them, and `safeHref` rejects anything with an unusable scheme.
      run('createLink', clean.startsWith('/') || clean.startsWith('#') ? clean : safeHref(clean));
    }
    closeLink(true);
  };

  return (
    <div
      className="cv-fmt"
      style={{
        top: `${state.rect.top}px`,
        left: `${state.rect.left}px`,
        transform: `scale(${scale})`,
      }}
      // Keep focus in the frame: losing it would blur the editable element,
      // which commits and ends the session.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="cv-fmt__row">
        {state.canBold ? (
          <button
            type="button"
            className={`cv-fmt__btn ${state.bold ? 'is-on' : ''}`}
            title="Bold"
            aria-label="Bold"
            aria-pressed={state.bold}
            onClick={() => run('bold')}
          >
            <strong>B</strong>
          </button>
        ) : null}
        {state.canItalic ? (
          <button
            type="button"
            className={`cv-fmt__btn ${state.italic ? 'is-on' : ''}`}
            title="Italic"
            aria-label="Italic"
            aria-pressed={state.italic}
            onClick={() => run('italic')}
          >
            <em>I</em>
          </button>
        ) : null}

        {state.canBold || state.canItalic ? <span className="cv-fmt__sep" /> : null}

        <button
          type="button"
          className={`cv-fmt__btn ${state.href ? 'is-on' : ''}`}
          title={state.href ? `Linked to ${state.href}` : 'Add a link'}
          aria-label="Add a link"
          onClick={() => {
            if (linkOpen) {
              closeLink(true);
              return;
            }
            remember();
            setLinkValue(state.href ?? '');
            setLinkOpen(true);
            // Set before the field mounts and steals focus, so the blur handler
            // in Canvas already knows to hold the session open.
            setLinkPopoverOpen(true);
          }}
        >
          <Icon
            path="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"
            size={13}
          />
        </button>
        {state.href ? (
          <button
            type="button"
            className="cv-fmt__btn"
            title="Remove the link"
            aria-label="Remove the link"
            onClick={() => run('unlink')}
          >
            <Icon path="M9 15l-2 2a4 4 0 0 1-5-5l2-2M15 9l2-2a4 4 0 0 1 5 5l-2 2M4 4l16 16" size={13} />
          </button>
        ) : null}

        <span className="cv-fmt__sep" />

        <button
          type="button"
          className="cv-fmt__btn"
          title="Clear formatting"
          aria-label="Clear formatting"
          onClick={() => run('removeFormat')}
        >
          <Icon path="M6 6l12 12M18 6L6 18" size={12} />
        </button>
      </div>

      {linkOpen ? (
        <div className="cv-fmt__link" onMouseDown={(event) => event.stopPropagation()}>
          <select
            className="cv-fmt__pages"
            value=""
            aria-label="Link to a page"
            onChange={(event) => {
              if (event.target.value) applyLink(event.target.value);
            }}
          >
            <option value="">Choose a page…</option>
            {doc.pages.map((page) => (
              <option key={page.id} value={page.path}>
                {page.name}
              </option>
            ))}
            {anchors.length
              ? anchors.map((anchor) => (
                  <option key={anchor.id} value={`#${anchor.anchorId}`}>
                    #{anchor.anchorId}
                  </option>
                ))
              : null}
          </select>
          <input
            className="cv-fmt__url"
            value={linkValue}
            placeholder="https://example.com"
            aria-label="Link address"
            autoFocus
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink(linkValue);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                closeLink(true);
              }
            }}
          />
          <button type="button" className="cv-fmt__apply" onClick={() => applyLink(linkValue)}>
            Link
          </button>
        </div>
      ) : null}
    </div>
  );
}
