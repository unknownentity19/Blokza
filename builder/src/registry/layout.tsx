/**
 * Layout primitives.
 *
 * These carry no visual opinion beyond sensible defaults — everything they do
 * is expressed as style declarations the user can then change in the inspector.
 * That is the difference between this and the old editor's "hero" block: a
 * section here is a real box, not a template with holes in it.
 */

import type { ComponentDef, RenderProps } from '../core/types';
import { EmptySlot, options, str } from './helpers';

const SEMANTIC_TAGS = ['section', 'div', 'header', 'footer', 'main', 'aside', 'nav', 'article'] as const;
type SemanticTag = (typeof SEMANTIC_TAGS)[number];

function tagOf(p: RenderProps, fallback: SemanticTag): SemanticTag {
  const value = str(p.props, 'tag');
  return (SEMANTIC_TAGS as readonly string[]).includes(value) ? (value as SemanticTag) : fallback;
}

const TAG_FIELD = {
  key: 'tag',
  label: 'HTML tag',
  type: 'select' as const,
  help: 'Only affects the exported markup, not the layout.',
  options: options(
    ['section', '<section>'],
    ['div', '<div>'],
    ['header', '<header>'],
    ['footer', '<footer>'],
    ['main', '<main>'],
    ['aside', '<aside>'],
    ['nav', '<nav>'],
    ['article', '<article>'],
  ),
};

export const pageRoot: ComponentDef = {
  type: 'page-root',
  label: 'Page',
  group: 'layout',
  icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z',
  container: true,
  fixed: true,
  defaultStyles: {
    base: {
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--color-canvas)',
    },
  },
  css: `.c-page-root { isolation: isolate; }`,
  render: (p) => <div {...p.attrs}>{p.children}<EmptySlot p={p} label="Start your page" /></div>,
};

export const section: ComponentDef = {
  type: 'section',
  label: 'Section',
  group: 'layout',
  hint: 'Full-width band. The outermost building block of a page.',
  icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM3 12h18',
  container: true,
  allowParents: ['page-root'],
  fields: [TAG_FIELD],
  defaults: { tag: 'section' },
  defaultStyles: {
    base: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      paddingTop: '96px',
      paddingRight: '24px',
      paddingBottom: '96px',
      paddingLeft: '24px',
    },
    tablet: { paddingTop: '72px', paddingBottom: '72px' },
    mobile: { paddingTop: '56px', paddingBottom: '56px', paddingRight: '20px', paddingLeft: '20px' },
  },
  render: (p) => {
    const Tag = tagOf(p, 'section');
    return <Tag {...p.attrs}>{p.children}<EmptySlot p={p} /></Tag>;
  },
};

export const container: ComponentDef = {
  type: 'container',
  label: 'Container',
  group: 'layout',
  hint: 'Centres content and caps its width.',
  icon: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z',
  container: true,
  fields: [TAG_FIELD],
  defaults: { tag: 'div' },
  defaultStyles: {
    base: {
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      width: '100%',
      maxWidth: 'var(--max-width)',
      marginRight: 'auto',
      marginLeft: 'auto',
    },
  },
  render: (p) => {
    const Tag = tagOf(p, 'div');
    return <Tag {...p.attrs}>{p.children}<EmptySlot p={p} /></Tag>;
  },
};

export const stack: ComponentDef = {
  type: 'stack',
  label: 'Stack',
  group: 'layout',
  hint: 'Vertical flex column with a gap.',
  icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM21 9H3M21 15H3',
  container: true,
  fields: [TAG_FIELD],
  defaults: { tag: 'div' },
  defaultStyles: {
    base: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' },
  },
  render: (p) => {
    const Tag = tagOf(p, 'div');
    return <Tag {...p.attrs}>{p.children}<EmptySlot p={p} /></Tag>;
  },
};

export const row: ComponentDef = {
  type: 'row',
  label: 'Row',
  group: 'layout',
  hint: 'Horizontal flex row. Wraps to a column on mobile.',
  icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM9 3v18M15 3v18',
  container: true,
  fields: [TAG_FIELD],
  defaults: { tag: 'div' },
  defaultStyles: {
    base: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '16px',
      width: '100%',
    },
    mobile: { flexDirection: 'column', alignItems: 'stretch' },
  },
  render: (p) => {
    const Tag = tagOf(p, 'div');
    return <Tag {...p.attrs}>{p.children}<EmptySlot p={p} /></Tag>;
  },
};

export const grid: ComponentDef = {
  type: 'grid',
  label: 'Grid',
  group: 'layout',
  hint: 'CSS grid. Drops to two columns on tablet, one on mobile.',
  icon: 'M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1zM15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1zM15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1zM4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z',
  container: true,
  fields: [TAG_FIELD],
  defaults: { tag: 'div' },
  defaultStyles: {
    base: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '24px',
      width: '100%',
    },
    tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: '16px' },
  },
  render: (p) => {
    const Tag = tagOf(p, 'div');
    return <Tag {...p.attrs}>{p.children}<EmptySlot p={p} /></Tag>;
  },
};

export const card: ComponentDef = {
  type: 'card',
  label: 'Card',
  group: 'layout',
  hint: 'Padded surface with a border and radius.',
  icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM3 9h18',
  container: true,
  defaultStyles: {
    base: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      paddingTop: '28px',
      paddingRight: '28px',
      paddingBottom: '28px',
      paddingLeft: '28px',
      backgroundColor: 'var(--color-surface)',
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: 'var(--color-line)',
      borderRadius: 'var(--radius)',
    },
  },
  render: (p) => <div {...p.attrs}>{p.children}<EmptySlot p={p} /></div>,
};

export const spacer: ComponentDef = {
  type: 'spacer',
  label: 'Spacer',
  group: 'layout',
  hint: 'Fixed vertical gap.',
  icon: 'M12 2v20M0 0m8 18 4 4 4-4M0 0m8 6 4-4 4 4',
  defaultStyles: { base: { width: '100%', height: '48px', flexShrink: '0' } },
  css: `.c-spacer { pointer-events: auto; }`,
  render: (p) => <div {...p.attrs} aria-hidden="true" />,
};

export const divider: ComponentDef = {
  type: 'divider',
  label: 'Divider',
  group: 'layout',
  hint: 'Horizontal rule.',
  icon: 'M3 12h18',
  defaultStyles: {
    base: {
      width: '100%',
      height: '0px',
      borderStyle: 'solid',
      borderTopWidth: '1px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderColor: 'var(--color-line)',
      flexShrink: '0',
    },
  },
  render: (p) => <div {...p.attrs} role="separator" />,
};

/**
 * Stands in for a shared section on a page.
 *
 * It has no children of its own — `RenderNode` swaps in the shared master's tree
 * instead. Registered all the same so the layers panel, the drop rules and the
 * inspector have a label and an icon to show.
 */
export const shared: ComponentDef = {
  type: 'shared',
  label: 'Shared section',
  group: 'layout',
  hint: 'One copy of a section, used on several pages.',
  icon: 'M4 6h16M4 12h16M4 18h16M8 3v18',
  allowParents: ['page-root'],
  defaults: { sharedId: '' },
  render: (p) => <div {...p.attrs} />,
};

export const LAYOUT_COMPONENTS = [
  shared,
  pageRoot,
  section,
  container,
  stack,
  row,
  grid,
  card,
  spacer,
  divider,
];
