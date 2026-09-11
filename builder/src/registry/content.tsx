/**
 * Text and interactive content primitives.
 */

import type { ComponentDef, RenderProps } from '../core/types';
import { EmptySlot, RichHtml, cls, editSlot, list, num, options, str, textHtml } from './helpers';
import { iconPath, ICON_NAMES } from './icons';
import { BUTTON_CSS } from './shared-css';

const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
type HeadingLevel = (typeof HEADING_LEVELS)[number];

function levelOf(p: RenderProps): HeadingLevel {
  const value = str(p.props, 'level', 'h2');
  return (HEADING_LEVELS as readonly string[]).includes(value) ? (value as HeadingLevel) : 'h2';
}

export const heading: ComponentDef = {
  type: 'heading',
  label: 'Heading',
  group: 'content',
  hint: 'Semantic heading, h1 through h6.',
  icon: 'M6 12h12M6 20V4M18 20V4',
  inlineEditable: ['text'],
  fields: [
    { key: 'text', label: 'Text', type: 'textarea', placeholder: 'Write a heading' },
    {
      key: 'level',
      label: 'Level',
      type: 'select',
      help: 'Use one h1 per page so screen readers and search engines can find the title.',
      options: options(['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4'], ['h5', 'H5'], ['h6', 'H6']),
    },
  ],
  defaults: { text: 'A headline that earns attention', level: 'h2' },
  defaultStyles: {
    base: { fontSize: '44px', fontWeight: '700', letterSpacing: '-0.03em', color: 'var(--color-ink)' },
    tablet: { fontSize: '36px' },
    mobile: { fontSize: '29px' },
  },
  render: (p) => {
    const Tag = levelOf(p);
    return (
      <Tag {...p.attrs} {...editSlot(p, 'text')} {...textHtml(p, 'text')} />
    );
  },
};

export const text: ComponentDef = {
  type: 'text',
  label: 'Text',
  group: 'content',
  hint: 'Paragraph of body copy.',
  icon: 'M21 5H3M15 12H3M17 19H3',
  inlineEditable: ['text'],
  fields: [{ key: 'text', label: 'Text', type: 'textarea', placeholder: 'Write something' }],
  defaults: {
    text: 'Explain the idea in one or two clear sentences. Concrete beats clever.',
  },
  defaultStyles: {
    base: { fontSize: '17px', lineHeight: '1.65', color: 'var(--color-muted)', maxWidth: '62ch' },
    mobile: { fontSize: '16px' },
  },
  render: (p) => (
    <p {...p.attrs} {...editSlot(p, 'text')} {...textHtml(p, 'text')} />
  ),
};

export const richtext: ComponentDef = {
  type: 'richtext',
  label: 'Rich text',
  group: 'content',
  hint: 'Formatted copy — headings, lists, links.',
  icon: 'M15 5h6M15 12h6M3 19h18M0 0m3 12 3.553-7.724a.5.5 0 0 1 .894 0L11 12M3.92 10h6.16',
  fields: [
    {
      key: 'html',
      label: 'Content',
      type: 'richtext',
      help: 'Bold, italic, links and lists are kept. Scripts and styles are stripped.',
    },
  ],
  defaults: {
    html: '<p>Rich text supports <strong>bold</strong>, <em>italic</em>, <a href="#">links</a> and lists.</p><ul><li>First point</li><li>Second point</li></ul>',
  },
  defaultStyles: {
    base: { fontSize: '17px', lineHeight: '1.7', color: 'var(--color-muted)', maxWidth: '68ch' },
  },
  css: `.c-richtext > span { display: block; }
.c-richtext p + p { margin-top: 1em; }
.c-richtext ul, .c-richtext ol { margin: 1em 0; padding-left: 1.2em; }
.c-richtext ul { list-style: disc; }
.c-richtext ol { list-style: decimal; }
.c-richtext li + li { margin-top: 0.4em; }
.c-richtext a { color: var(--color-brand); text-decoration: underline; }
.c-richtext h2, .c-richtext h3, .c-richtext h4 { margin: 1.4em 0 0.5em; color: var(--color-ink); }
.c-richtext blockquote { margin: 1.2em 0; padding-left: 1em; border-left: 3px solid var(--color-line); }
.c-richtext code { font-family: var(--font-mono); font-size: 0.92em; }`,
  render: (p) => (
    <div {...p.attrs}>
      <RichHtml html={str(p.props, 'html')} />
    </div>
  ),
};

const LINK_FIELDS = [
  { key: 'label', label: 'Label', type: 'text' as const, placeholder: 'Click me' },
  { key: 'href', label: 'Link', type: 'link' as const, placeholder: '/pricing or https://…' },
  {
    key: 'target',
    label: 'Opens in',
    type: 'select' as const,
    options: options(['', 'Same tab'], ['_blank', 'New tab']),
  },
];

export const button: ComponentDef = {
  type: 'button',
  label: 'Button',
  group: 'content',
  hint: 'Primary call to action.',
  icon: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
  inlineEditable: ['label'],
  fields: [
    ...LINK_FIELDS,
    {
      key: 'variant',
      label: 'Style',
      type: 'select',
      options: options(['primary', 'Primary'], ['secondary', 'Secondary'], ['ghost', 'Ghost'], ['link', 'Text link']),
    },
    {
      key: 'icon',
      label: 'Trailing icon',
      type: 'icon',
      help: 'Leave empty for no icon.',
    },
  ],
  defaults: { label: 'Get started', href: '#', variant: 'primary', icon: '' },
  defaultStyles: { base: { width: 'fit-content', maxWidth: '100%' } },
  css: BUTTON_CSS,
  render: (p) => {
    const variant = str(p.props, 'variant', 'primary');
    const icon = str(p.props, 'icon');
    const target = str(p.props, 'target');
    return (
      <a
        {...p.attrs}
        className={cls(p, `c-button--${variant.replace(/[^a-z]/gi, '') || 'primary'}`)}
        href={p.resolveHref(p.props.href)}
        {...(target === '_blank' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        <span {...editSlot(p, 'label')} {...textHtml(p, 'label')} />
        {icon ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={iconPath(icon)} />
          </svg>
        ) : null}
      </a>
    );
  },
};

export const link: ComponentDef = {
  type: 'link',
  label: 'Link',
  group: 'content',
  hint: 'Inline text link.',
  icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  inlineEditable: ['label'],
  fields: LINK_FIELDS,
  defaults: { label: 'Learn more', href: '#' },
  defaultStyles: { base: { color: 'var(--color-brand)', fontWeight: '500', width: 'fit-content' } },
  render: (p) => {
    const target = str(p.props, 'target');
    return (
      <a
        {...p.attrs}
        href={p.resolveHref(p.props.href)}
        {...(target === '_blank' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...editSlot(p, 'label')} {...textHtml(p, 'label')} />
    );
  },
};

export const badge: ComponentDef = {
  type: 'badge',
  label: 'Badge',
  group: 'content',
  hint: 'Small pill of label text.',
  icon: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z',
  inlineEditable: ['text'],
  fields: [{ key: 'text', label: 'Text', type: 'text', placeholder: 'New' }],
  defaults: { text: 'New' },
  defaultStyles: {
    base: {
      display: 'inline-flex',
      alignItems: 'center',
      // `inline-flex` is not enough: as a flex *item* it would still be stretched
      // by the parent's default `align-items: stretch`. An explicit width wins
      // over stretch, and unlike `align-self` it does not disturb vertical
      // alignment when the parent happens to be a row.
      width: 'fit-content',
      maxWidth: '100%',
      paddingTop: '6px',
      paddingRight: '13px',
      paddingBottom: '6px',
      paddingLeft: '13px',
      backgroundColor: 'var(--color-brand-soft)',
      color: 'var(--color-brand-dark)',
      borderRadius: '999px',
      fontSize: '13px',
      fontWeight: '600',
      letterSpacing: '0.01em',
    },
  },
  render: (p) => (
    <span {...p.attrs} {...editSlot(p, 'text')} {...textHtml(p, 'text')} />
  ),
};

export const quote: ComponentDef = {
  type: 'quote',
  label: 'Quote',
  group: 'content',
  hint: 'Pull quote with attribution.',
  icon: 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
  inlineEditable: ['text', 'author', 'role'],
  fields: [
    { key: 'text', label: 'Quote', type: 'textarea' },
    { key: 'author', label: 'Author', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
  ],
  defaults: {
    text: 'We replaced three tools with this and shipped the rebrand in a week.',
    author: 'Dana Okafor',
    role: 'Head of Design, Northwind',
  },
  defaultStyles: {
    base: { display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '58ch' },
  },
  css: `.c-quote blockquote { font-size: 22px; line-height: 1.5; color: var(--color-ink); }
.c-quote footer { font-size: 14px; color: var(--color-muted); }
.c-quote cite { display: block; font-style: normal; font-weight: 600; color: var(--color-ink); }`,
  render: (p) => (
    <figure {...p.attrs}>
      <blockquote {...editSlot(p, 'text')} {...textHtml(p, 'text')} />
      <footer>
        <cite {...editSlot(p, 'author')} {...textHtml(p, 'author')} />
        <span {...editSlot(p, 'role')} {...textHtml(p, 'role')} />
      </footer>
    </figure>
  ),
};

export const bulletList: ComponentDef = {
  type: 'list',
  label: 'List',
  group: 'content',
  hint: 'Bulleted, numbered, or checkmark list.',
  icon: 'M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13',
  fields: [
    {
      key: 'marker',
      label: 'Marker',
      type: 'select',
      options: options(['check', 'Checkmark'], ['bullet', 'Bullet'], ['number', 'Numbered'], ['none', 'None']),
    },
    {
      key: 'items',
      label: 'Items',
      type: 'list',
      itemFields: [{ key: 'text', label: 'Text', type: 'text' }],
      itemDefaults: { text: 'New item' },
    },
  ],
  defaults: {
    marker: 'check',
    items: [
      { text: 'Unlimited pages and projects' },
      { text: 'Responsive breakpoints built in' },
      { text: 'Export clean HTML and CSS' },
    ],
  },
  defaultStyles: {
    base: { display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--color-muted)', fontSize: '16px' },
  },
  css: `.c-list li { display: flex; align-items: flex-start; gap: 10px; }
.c-list svg { width: 18px; height: 18px; flex: none; margin-top: 2px; color: var(--color-brand); }
.c-list--bullet li::before { content: ""; width: 6px; height: 6px; flex: none; margin-top: 9px; border-radius: 999px; background: currentColor; }
.c-list--number { counter-reset: sb-list; }
.c-list--number li { counter-increment: sb-list; }
.c-list--number li::before { content: counter(sb-list) "."; flex: none; font-variant-numeric: tabular-nums; color: var(--color-brand); font-weight: 600; }`,
  render: (p) => {
    const marker = str(p.props, 'marker', 'check');
    const items = list(p.props, 'items');
    const Tag = marker === 'number' ? 'ol' : 'ul';
    return (
      <Tag {...p.attrs} className={cls(p, `c-list--${marker.replace(/[^a-z]/gi, '') || 'check'}`)}>
        {items.length === 0 && p.mode === 'canvas' ? <EmptySlot p={p} label="Add list items" /> : null}
        {items.map((_item, index) => (
          <li key={index}>
            {marker === 'check' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : null}
            <span
              {...editSlot(p, `items.${index}.text`)}
              {...textHtml(p, `items.${index}.text`)}
            />
          </li>
        ))}
      </Tag>
    );
  },
};

export const icon: ComponentDef = {
  type: 'icon',
  label: 'Icon',
  group: 'content',
  hint: 'Single stroke icon.',
  icon: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
  fields: [
    { key: 'name', label: 'Icon', type: 'icon' },
    { key: 'strokeWidth', label: 'Stroke', type: 'range', min: 1, max: 3, step: 0.1 },
  ],
  defaults: { name: 'sparkle', strokeWidth: 1.8 },
  defaultStyles: {
    base: { width: '28px', height: '28px', color: 'var(--color-brand)', flexShrink: '0' },
  },
  render: (p) => (
    <svg
      {...p.attrs}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={String(num(p.props, 'strokeWidth', 1.8))}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPath(str(p.props, 'name', 'sparkle'))} />
    </svg>
  ),
};

export const ICON_OPTIONS = ICON_NAMES;

export const CONTENT_COMPONENTS = [
  heading,
  text,
  richtext,
  button,
  link,
  badge,
  quote,
  bulletList,
  icon,
];
