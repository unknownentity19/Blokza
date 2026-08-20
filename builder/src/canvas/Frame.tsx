/**
 * The device frame.
 *
 * The page under construction is rendered inside a real `<iframe>` sized to the
 * device width, and React portals the node tree into that document. This is the
 * decision the rest of the canvas is built around:
 *
 *   - `@media (max-width: 767px)` fires because the iframe genuinely is 390px
 *     wide. The previous editor resized a div inside a 1440px viewport, so
 *     responsive styles could never take effect and the mobile preview was a
 *     lie.
 *   - `vh`, `position: sticky` and `100%` heights resolve against the device
 *     viewport rather than the editor's.
 *   - Nothing the user writes can inherit or collide with the editor's own CSS,
 *     in either direction.
 *
 * The iframe is left on `about:blank` and populated directly, which keeps it
 * same-origin (needed for hit-testing) and avoids a load round-trip.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400..900&family=Urbanist:wght@400;500;600;700;800&family=Playfair+Display:wght@400;600;700&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

export interface FrameProps {
  width: number;
  height: number;
  /** Compiled stylesheet for the document being edited. */
  css: string;
  title: string;
  onReady?: (frame: HTMLIFrameElement) => void;
  /** Called when the frame's document never becomes reachable. */
  onUnavailable?: (reason: string) => void;
  children: ReactNode;
}

export function Frame({ width, height, css, title, onReady, onUnavailable, children }: FrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Prepare the iframe document once. `about:blank` already has html/head/body,
  // so this only has to add the pieces we own.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;

    let cancelled = false;
    // Bounded. An unbounded retry turned "the frame is not reachable" into a
    // silent busy loop at animation-frame rate, which is indistinguishable from
    // a hung editor and gives nobody anything to debug.
    let attempts = 0;
    const MAX_ATTEMPTS = 120;

    const setup = () => {
      if (cancelled) return;
      const frameDoc = frame.contentDocument;
      if (!frameDoc?.body) {
        attempts += 1;
        if (attempts <= MAX_ATTEMPTS) {
          requestAnimationFrame(setup);
          return;
        }
        onUnavailable?.(
          'The canvas frame could not be reached. This happens when the page ' +
            'cannot access its own iframe — check the browser console for a ' +
            'security or CORS error.',
        );
        return;
      }

      frameDoc.documentElement.setAttribute('lang', 'en');

      if (!frameDoc.head.querySelector('meta[charset]')) {
        const meta = frameDoc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        frameDoc.head.appendChild(meta);
      }
      // Keep any stray link click inside the frame rather than replacing the app.
      if (!frameDoc.head.querySelector('base')) {
        const base = frameDoc.createElement('base');
        base.target = '_self';
        frameDoc.head.appendChild(base);
      }
      if (!frameDoc.head.querySelector('link[data-sb-fonts]')) {
        const link = frameDoc.createElement('link');
        link.rel = 'stylesheet';
        link.href = FONT_HREF;
        link.dataset.sbFonts = '';
        frameDoc.head.appendChild(link);
      }

      let style = frameDoc.head.querySelector<HTMLStyleElement>('style[data-sb-css]');
      if (!style) {
        style = frameDoc.createElement('style');
        style.dataset.sbCss = '';
        frameDoc.head.appendChild(style);
      }
      styleRef.current = style;
      style.textContent = css;

      setBody(frameDoc.body);
      onReady?.(frame);
    };

    setup();
    // Some browsers replace the document on the first real load event.
    frame.addEventListener('load', setup);
    return () => {
      cancelled = true;
      frame.removeEventListener('load', setup);
    };
    // `css` and `onReady` are handled by their own effects; re-running setup on
    // every keystroke would tear the portal down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stylesheet updates are a text assignment, never a remount.
  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = css;
  }, [css]);

  return (
    <>
      <iframe
        ref={ref}
        className="cv-frame"
        title={title}
        style={{ width: `${width}px`, height: `${height}px` }}
        /*
         * Deliberately not sandboxed.
         *
         * The editor's whole model depends on reading and writing this frame's
         * DOM from the parent, which requires same-origin access. `sandbox`
         * defeats that whenever the parent's origin is opaque — opening the built
         * site from disk, most obviously — because `allow-same-origin` can only
         * preserve an origin, and an opaque one stays opaque. The result was a
         * completely dead canvas: `contentDocument` null, portal never mounted.
         *
         * Nothing inside is executable anyway: the document is `about:blank`
         * populated by React from here, we never inject a script, and user HTML
         * goes through `sanitizeHtml`, which drops `<script>` outright.
         * Embedded third-party iframes get their own sandbox there instead.
         */
      />
      {/* Sibling, not a child: the portal mounts into the frame's body, and
          nesting it under <iframe> would imply DOM children an iframe cannot have. */}
      {body ? createPortal(children, body) : null}
    </>
  );
}
