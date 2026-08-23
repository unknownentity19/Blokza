/**
 * Media primitives.
 */

import type { ComponentDef } from '../core/types';
import { RichHtml, bool, cls, options, str } from './helpers';
import { safeHref } from '../core/sanitize';

/**
 * CSS for the "no image yet" state.
 *
 * This used to be a data-URI SVG with the greys baked in, which meant a dark
 * theme got a bright grey slab — on the canvas *and* in the exported site. A
 * themed element instead: the placeholder follows the palette because it is real
 * markup with real CSS.
 */
const IMAGE_CSS = `.c-image--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-line);
  color: var(--color-muted);
}
.c-image--empty svg { width: 30px; height: 30px; opacity: 0.5; }`;

export const image: ComponentDef = {
  type: 'image',
  label: 'Image',
  group: 'media',
  hint: 'Responsive image with alt text.',
  icon: 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 17l6-5 5 4 3-2 4 3',
  fields: [
    { key: 'src', label: 'Source', type: 'image', placeholder: 'https://… or /assets/photo.jpg' },
    {
      key: 'alt',
      label: 'Alt text',
      type: 'text',
      help: 'Describe the image for screen readers. Leave empty only for decoration.',
    },
    {
      key: 'loading',
      label: 'Loading',
      type: 'select',
      help: 'Lazy is right for anything below the fold.',
      options: options(['lazy', 'Lazy'], ['eager', 'Eager']),
    },
  ],
  defaults: { src: '', alt: '', loading: 'lazy' },
  defaultStyles: {
    base: {
      width: '100%',
      height: 'auto',
      minHeight: '80px',
      objectFit: 'cover',
      borderRadius: 'var(--radius)',
    },
  },
  css: IMAGE_CSS,
  render: (p) => {
    // Through the resolver: an uploaded image is stored as `asset:<id>` and has
    // to become a data URL on the canvas and a file path in the export.
    const src = p.resolveAsset(p.props.src);
    const alt = str(p.props, 'alt');

    // No source yet: a themed box rather than an <img> with a baked-in grey.
    if (!src) {
      return (
        <div
          {...p.attrs}
          className={cls(p, 'c-image--empty')}
          role="img"
          aria-label={alt || 'Image placeholder'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10.5" r="1.5" />
            <path d="M3 17l5-4 4 3 3-2 6 4" />
          </svg>
        </div>
      );
    }

    return (
      <img
        {...p.attrs}
        src={src}
        alt={alt}
        loading={str(p.props, 'loading', 'lazy') === 'eager' ? 'eager' : 'lazy'}
        decoding="async"
        {...(alt ? {} : { role: 'presentation' })}
      />
    );
  },
};

export const video: ComponentDef = {
  type: 'video',
  label: 'Video',
  group: 'media',
  hint: 'Self-hosted video file.',
  icon: 'M3 6h13v12H3zM16 10l5-3v10l-5-3z',
  fields: [
    { key: 'src', label: 'Source', type: 'url', placeholder: 'https://…/clip.mp4' },
    { key: 'poster', label: 'Poster image', type: 'image' },
    { key: 'controls', label: 'Show controls', type: 'toggle' },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle', help: 'Autoplay only works while muted.' },
    { key: 'loop', label: 'Loop', type: 'toggle' },
    { key: 'muted', label: 'Muted', type: 'toggle' },
  ],
  defaults: { src: '', controls: true, autoplay: false, loop: false, muted: true },
  defaultStyles: {
    base: { width: '100%', height: 'auto', borderRadius: 'var(--radius)', backgroundColor: '#0b0b12' },
  },
  render: (p) => {
    const src = str(p.props, 'src');
    const autoplay = bool(p.props, 'autoplay');
    return (
      <video
        {...p.attrs}
        {...(src ? { src: safeHref(src) } : {})}
        {...(() => {
          // The poster is an image field, so it can hold an uploaded asset too.
          const poster = p.resolveAsset(p.props.poster);
          return poster ? { poster } : {};
        })()}
        controls={bool(p.props, 'controls', true)}
        loop={bool(p.props, 'loop')}
        // A muted track is required for autoplay to be allowed by browsers, so
        // turning autoplay on implies muted rather than silently doing nothing.
        muted={bool(p.props, 'muted', true) || autoplay}
        playsInline
        // Never autoplay inside the editor: it would fight the user for attention.
        {...(autoplay && p.mode === 'export' ? { autoPlay: true } : {})}
      />
    );
  },
};

export const embed: ComponentDef = {
  type: 'embed',
  label: 'Embed',
  group: 'media',
  hint: 'Paste an iframe from YouTube, Vimeo, Maps, Calendly…',
  icon: 'M4 5h16v14H4zM4 9h16M9 13h6',
  fields: [
    {
      key: 'html',
      label: 'Embed code',
      type: 'code',
      placeholder: '<iframe src="https://www.youtube.com/embed/…"></iframe>',
      help: 'Scripts and inline styles are removed. Iframes, video and audio are kept.',
    },
  ],
  defaults: { html: '' },
  defaultStyles: { base: { width: '100%' } },
  css: `.c-embed iframe, .c-embed video { width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: var(--radius); }
.c-embed > span { display: block; }`,
  render: (p) => {
    const html = str(p.props, 'html');
    if (!html) {
      return (
        <div {...p.attrs}>
          {p.mode === 'canvas' ? (
            <span className="sb-empty" data-sb-empty="">
              Paste embed code
            </span>
          ) : null}
        </div>
      );
    }
    return (
      <div {...p.attrs}>
        <RichHtml html={html} allowEmbeds />
      </div>
    );
  },
};

export const MEDIA_COMPONENTS = [image, video, embed];
