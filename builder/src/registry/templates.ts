/**
 * Section templates.
 *
 * A template is not a component: it expands into a tree of the same primitives
 * a user could have assembled by hand. That is the whole point — the old editor
 * shipped a "hero" block whose internals were unreachable, so the moment you
 * wanted a third button you were stuck. Here a hero is a section holding a
 * container holding a row, and every piece of it selects, styles, and deletes
 * like anything else.
 *
 * Thumbnails are authored wireframes (never user input) drawn in a 120×64 box.
 */

import type { NodeStyles, PresetChild } from '../core/types';

export interface Template {
  id: string;
  label: string;
  category: string;
  hint?: string;
  /** Inner SVG markup for the palette wireframe, viewBox="0 0 120 64". */
  thumb: string;
  tree: PresetChild;
}

/* ---------- tree builders ---------- */

function n(
  type: string,
  props?: Record<string, unknown>,
  styles?: NodeStyles,
  children?: PresetChild[],
): PresetChild {
  const node: PresetChild = { type };
  if (props) node.props = props;
  if (styles) node.styles = styles;
  if (children) node.children = children;
  return node;
}

const section = (styles: NodeStyles | undefined, children: PresetChild[], props?: Record<string, unknown>) =>
  n('section', props, styles, children);
const container = (styles: NodeStyles | undefined, children: PresetChild[]) =>
  n('container', undefined, styles, children);
const stack = (styles: NodeStyles | undefined, children: PresetChild[]) =>
  n('stack', undefined, styles, children);
const row = (styles: NodeStyles | undefined, children: PresetChild[]) =>
  n('row', undefined, styles, children);
const grid = (styles: NodeStyles | undefined, children: PresetChild[]) =>
  n('grid', undefined, styles, children);
const card = (styles: NodeStyles | undefined, children: PresetChild[]) =>
  n('card', undefined, styles, children);

const h = (text: string, level: string, styles?: NodeStyles) => n('heading', { text, level }, styles);
const p = (text: string, styles?: NodeStyles) => n('text', { text }, styles);
const btn = (label: string, variant = 'primary', href = '#') => n('button', { label, href, variant });
const badge = (text: string) => n('badge', { text });
const icon = (name: string, styles?: NodeStyles) => n('icon', { name }, styles);
const img = (styles?: NodeStyles) => n('image', { src: '', alt: '' }, styles);
const items = (...texts: string[]) => texts.map((text) => ({ text }));

/* ---------- reusable style fragments ---------- */

const EYEBROW: NodeStyles = {
  base: {
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-brand)',
  },
};
const H1: NodeStyles = {
  base: { fontSize: '60px', fontWeight: '700', letterSpacing: '-0.035em', color: 'var(--color-ink)' },
  tablet: { fontSize: '46px' },
  mobile: { fontSize: '34px' },
};
const H2: NodeStyles = {
  base: { fontSize: '42px', fontWeight: '700', letterSpacing: '-0.03em', color: 'var(--color-ink)' },
  tablet: { fontSize: '34px' },
  mobile: { fontSize: '28px' },
};
const H3: NodeStyles = { base: { fontSize: '20px', fontWeight: '650', color: 'var(--color-ink)' } };
const H4: NodeStyles = {
  base: { fontSize: '13px', fontWeight: '650', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink)' },
};
const LEAD: NodeStyles = {
  base: { fontSize: '19px', lineHeight: '1.6', color: 'var(--color-muted)', maxWidth: '56ch' },
  mobile: { fontSize: '17px' },
};
const STAT: NodeStyles = {
  base: { fontSize: '46px', fontWeight: '700', letterSpacing: '-0.03em', color: 'var(--color-brand)' },
  mobile: { fontSize: '34px' },
};
const MEDIA: NodeStyles = {
  base: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius)' },
};

/* ---------- thumbnails ---------- */

const T = {
  heroSplit: '<rect x="6" y="10" width="50" height="44" rx="3"/><rect x="62" y="10" width="52" height="44" rx="3" class="fill"/><line x1="12" y1="20" x2="46" y2="20"/><line x1="12" y1="28" x2="40" y2="28"/><rect x="12" y="38" width="22" height="8" rx="2" class="fill"/>',
  heroCenter: '<line x1="34" y1="16" x2="86" y2="16"/><line x1="24" y1="26" x2="96" y2="26"/><line x1="34" y1="34" x2="86" y2="34"/><rect x="42" y="42" width="16" height="8" rx="2" class="fill"/><rect x="62" y="42" width="16" height="8" rx="2"/>',
  featureGrid: '<line x1="40" y1="10" x2="80" y2="10"/><rect x="6" y="20" width="32" height="34" rx="3"/><rect x="44" y="20" width="32" height="34" rx="3"/><rect x="82" y="20" width="32" height="34" rx="3"/>',
  featureAlt: '<rect x="6" y="12" width="50" height="40" rx="3" class="fill"/><line x1="64" y1="20" x2="108" y2="20"/><line x1="64" y1="30" x2="100" y2="30"/><line x1="64" y1="38" x2="92" y2="38"/><line x1="64" y1="46" x2="96" y2="46"/>',
  logos: '<line x1="46" y1="14" x2="74" y2="14"/><rect x="8" y="28" width="18" height="10" rx="2"/><rect x="32" y="28" width="18" height="10" rx="2"/><rect x="56" y="28" width="18" height="10" rx="2"/><rect x="80" y="28" width="18" height="10" rx="2"/><rect x="104" y="28" width="8" height="10" rx="2"/>',
  stats: '<rect x="6" y="18" width="24" height="28" rx="3"/><rect x="34" y="18" width="24" height="28" rx="3"/><rect x="62" y="18" width="24" height="28" rx="3"/><rect x="90" y="18" width="24" height="28" rx="3"/>',
  testimonial: '<rect x="6" y="14" width="32" height="36" rx="3"/><rect x="44" y="14" width="32" height="36" rx="3"/><rect x="82" y="14" width="32" height="36" rx="3"/><line x1="12" y1="24" x2="30" y2="24"/><line x1="50" y1="24" x2="68" y2="24"/><line x1="88" y1="24" x2="106" y2="24"/>',
  pricing: '<rect x="8" y="12" width="32" height="42" rx="3"/><rect x="44" y="8" width="32" height="48" rx="3" class="fill"/><rect x="80" y="12" width="32" height="42" rx="3"/>',
  faq: '<rect x="14" y="12" width="92" height="12" rx="3"/><rect x="14" y="28" width="92" height="12" rx="3"/><rect x="14" y="44" width="92" height="12" rx="3"/>',
  cta: '<rect x="6" y="12" width="108" height="40" rx="4" class="fill"/><line x1="30" y1="26" x2="90" y2="26"/><rect x="48" y="34" width="24" height="9" rx="3"/>',
  contact: '<line x1="8" y1="16" x2="46" y2="16"/><line x1="8" y1="26" x2="40" y2="26"/><line x1="8" y1="34" x2="44" y2="34"/><rect x="62" y="10" width="52" height="10" rx="2"/><rect x="62" y="24" width="52" height="10" rx="2"/><rect x="62" y="38" width="52" height="16" rx="2"/>',
  navbar: '<rect x="6" y="22" width="108" height="20" rx="4"/><circle cx="16" cy="32" r="3"/><line x1="26" y1="32" x2="44" y2="32"/><line x1="50" y1="32" x2="66" y2="32"/><line x1="72" y1="32" x2="84" y2="32"/><rect x="92" y="27" width="16" height="10" rx="3" class="fill"/>',
  footer: '<rect x="6" y="8" width="108" height="48" rx="4"/><line x1="14" y1="18" x2="34" y2="18"/><line x1="46" y1="18" x2="66" y2="18"/><line x1="78" y1="18" x2="98" y2="18"/><line x1="14" y1="26" x2="30" y2="26"/><line x1="46" y1="26" x2="62" y2="26"/><line x1="78" y1="26" x2="94" y2="26"/><line x1="14" y1="44" x2="106" y2="44"/>',
  gallery: '<rect x="6" y="10" width="34" height="22" rx="2"/><rect x="44" y="10" width="34" height="22" rx="2"/><rect x="82" y="10" width="32" height="22" rx="2"/><rect x="6" y="36" width="34" height="20" rx="2"/><rect x="44" y="36" width="34" height="20" rx="2"/><rect x="82" y="36" width="32" height="20" rx="2"/>',
};

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const TEMPLATES: Template[] = [
  {
    id: 'navbar',
    label: 'Nav bar',
    category: 'Navigation',
    hint: 'Logo, links and a call to action.',
    thumb: T.navbar,
    tree: section(
      {
        base: {
          paddingTop: '18px',
          paddingBottom: '18px',
          borderStyle: 'solid',
          borderBottomWidth: '1px',
          borderTopWidth: '0px',
          borderRightWidth: '0px',
          borderLeftWidth: '0px',
          borderColor: 'var(--color-line)',
          backgroundColor: 'var(--color-surface)',
        },
      },
      [
        container({ base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '24px' } }, [
          // `row` collapses to a column on mobile, which is right for page
          // layout and wrong for a nav bar: it stacked the brand above the links
          // and turned a 60px bar into a tall block. These groups are inline
          // clusters, so they stay horizontal at every width.
          row({ base: { width: 'auto', gap: '32px' }, mobile: { flexDirection: 'row', alignItems: 'center', gap: '16px' } }, [
            h('BLOKZA', 'h3', { base: { fontSize: '19px', fontWeight: '700', letterSpacing: '-0.02em' } }),
            row({ base: { width: 'auto', gap: '26px' }, mobile: { display: 'none' } }, [
              n('link', { label: 'Product', href: '/' }),
              n('link', { label: 'Pricing', href: '/' }),
              n('link', { label: 'Docs', href: '/' }),
            ]),
          ]),
          row({ base: { width: 'auto', gap: '12px' }, mobile: { flexDirection: 'row', alignItems: 'center', width: 'auto' } }, [
            // A secondary text link is the first thing to go when space is tight.
            n('link', { label: 'Sign in', href: '/' }, { mobile: { display: 'none' } }),
            btn('Start free', 'primary'),
          ]),
        ]),
      ],
      { tag: 'header' },
    ),
  },
  {
    id: 'hero-split',
    label: 'Hero · split',
    category: 'Hero',
    hint: 'Copy on the left, image on the right.',
    thumb: T.heroSplit,
    tree: section({ base: { paddingTop: '110px', paddingBottom: '110px' } }, [
      container(undefined, [
        row({ base: { gap: '64px', alignItems: 'center' }, tablet: { gap: '40px' }, mobile: { gap: '32px' } }, [
          stack({ base: { gap: '22px', flexBasis: '52%', flexGrow: '1' } }, [
            badge('New · v3'),
            h('Design the page. Ship the site.', 'h1', H1),
            p(
              'Drag real layout primitives, style them per breakpoint, and export clean HTML and CSS. No lock-in, no runtime.',
              LEAD,
            ),
            row({ base: { width: 'auto', gap: '12px' } }, [btn('Start building'), btn('See a demo', 'secondary')]),
          ]),
          img({ base: { ...MEDIA.base, flexBasis: '48%', aspectRatio: '5 / 4' } }),
        ]),
      ]),
    ]),
  },
  {
    id: 'hero-center',
    label: 'Hero · centred',
    category: 'Hero',
    hint: 'Big centred statement with two actions.',
    thumb: T.heroCenter,
    tree: section({ base: { paddingTop: '128px', paddingBottom: '128px' } }, [
      container({ base: { alignItems: 'center', maxWidth: '900px' } }, [
        stack({ base: { gap: '24px', alignItems: 'center', textAlign: 'center' } }, [
          badge('Trusted by 4,000 teams'),
          h('Everything you need to launch, nothing you do not.', 'h1', H1),
          p('One editor, real breakpoints, and an export you can host anywhere.', {
            base: { ...LEAD.base, textAlign: 'center' },
          }),
          row({ base: { width: 'auto', gap: '12px', justifyContent: 'center' } }, [
            btn('Get started free'),
            btn('Talk to us', 'secondary'),
          ]),
        ]),
      ]),
    ]),
  },
  {
    id: 'logos',
    label: 'Logo strip',
    category: 'Social proof',
    hint: 'Row of customer logos.',
    thumb: T.logos,
    tree: section({ base: { paddingTop: '52px', paddingBottom: '52px', backgroundColor: 'var(--color-surface)' } }, [
      container({ base: { alignItems: 'center', gap: '28px' } }, [
        p('Powering marketing sites at', {
          base: { fontSize: '13px', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', textAlign: 'center' },
        }),
        row({ base: { gap: '48px', justifyContent: 'center', flexWrap: 'wrap' }, mobile: { flexDirection: 'row', gap: '28px' } }, [
          img({ base: { width: '104px', height: '28px', objectFit: 'contain', opacity: '0.55' } }),
          img({ base: { width: '104px', height: '28px', objectFit: 'contain', opacity: '0.55' } }),
          img({ base: { width: '104px', height: '28px', objectFit: 'contain', opacity: '0.55' } }),
          img({ base: { width: '104px', height: '28px', objectFit: 'contain', opacity: '0.55' } }),
          img({ base: { width: '104px', height: '28px', objectFit: 'contain', opacity: '0.55' } }),
        ]),
      ]),
    ]),
  },
  {
    id: 'feature-grid',
    label: 'Feature grid',
    category: 'Features',
    hint: 'Three cards with icon, title and copy.',
    thumb: T.featureGrid,
    tree: section(undefined, [
      container({ base: { gap: '52px' } }, [
        stack({ base: { gap: '16px', alignItems: 'center', textAlign: 'center', maxWidth: '640px', marginRight: 'auto', marginLeft: 'auto' } }, [
          p('Why teams switch', EYEBROW),
          h('Built for the way you actually work', 'h2', H2),
        ]),
        grid(undefined, [
          card(undefined, [icon('bolt'), h('Fast by default', 'h3', H3), p('Static output, no framework tax. Pages load in milliseconds.')]),
          card(undefined, [icon('layers'), h('Real breakpoints', 'h3', H3), p('Style desktop, tablet and mobile independently — and see it reflow.')]),
          card(undefined, [icon('code'), h('Clean export', 'h3', H3), p('Readable HTML and one stylesheet. Host it anywhere you like.')]),
        ]),
      ]),
    ]),
  },
  {
    id: 'feature-alt',
    label: 'Feature · media',
    category: 'Features',
    hint: 'Image beside a titled list.',
    thumb: T.featureAlt,
    tree: section(undefined, [
      container(undefined, [
        row({ base: { gap: '64px', alignItems: 'center' }, mobile: { gap: '32px' } }, [
          img({ base: { ...MEDIA.base, flexBasis: '50%' } }),
          stack({ base: { gap: '20px', flexBasis: '50%', flexGrow: '1' } }, [
            p('Responsive', EYEBROW),
            h('One document, every screen', 'h2', H2),
            p('Set a value on desktop and it cascades down. Override it on mobile and only mobile changes.'),
            n('list', { marker: 'check', items: items('Per-breakpoint overrides', 'Hover states without code', 'Design tokens for colour and type') }),
          ]),
        ]),
      ]),
    ]),
  },
  {
    id: 'stats',
    label: 'Stats',
    category: 'Social proof',
    hint: 'Four headline numbers.',
    thumb: T.stats,
    tree: section({ base: { paddingTop: '72px', paddingBottom: '72px' } }, [
      container(undefined, [
        grid({ base: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }, mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } }, [
          stack({ base: { gap: '6px' } }, [h('4,000+', 'h3', STAT), p('Sites shipped')]),
          stack({ base: { gap: '6px' } }, [h('120ms', 'h3', STAT), p('Median load time')]),
          stack({ base: { gap: '6px' } }, [h('99.99%', 'h3', STAT), p('Uptime last year')]),
          stack({ base: { gap: '6px' } }, [h('0', 'h3', STAT), p('Lines of build config')]),
        ]),
      ]),
    ]),
  },
  {
    id: 'testimonials',
    label: 'Testimonials',
    category: 'Social proof',
    hint: 'Three quote cards.',
    thumb: T.testimonial,
    tree: section(undefined, [
      container({ base: { gap: '48px' } }, [
        h('What people say', 'h2', { base: { ...H2.base, textAlign: 'center' } }),
        grid(undefined, [
          card(undefined, [n('quote', { text: 'We replaced three tools with this and shipped the rebrand in a week.', author: 'Dana Okafor', role: 'Head of Design, Northwind' })]),
          card(undefined, [n('quote', { text: 'The export is the first one I have not had to rewrite before shipping.', author: 'Samir Haddad', role: 'Engineering lead, Fathom' })]),
          card(undefined, [n('quote', { text: 'Our marketing team ships pages without filing a single ticket now.', author: 'Lena Fischer', role: 'CMO, Brightline' })]),
        ]),
      ]),
    ]),
  },
  {
    id: 'pricing',
    label: 'Pricing',
    category: 'Conversion',
    hint: 'Three tiers with a highlighted plan.',
    thumb: T.pricing,
    tree: section(undefined, [
      container({ base: { gap: '48px' } }, [
        stack({ base: { gap: '14px', alignItems: 'center', textAlign: 'center' } }, [
          h('Simple pricing', 'h2', H2),
          p('Every plan includes unlimited pages and the full export.', { base: { ...LEAD.base, textAlign: 'center' } }),
        ]),
        grid(undefined, [
          card({ base: { gap: '18px' } }, [
            h('Starter', 'h3', H3),
            h('$0', 'h3', STAT),
            p('For one project and a weekend of momentum.'),
            n('list', { marker: 'check', items: items('1 project', '3 pages', 'BLOKZA subdomain') }),
            btn('Start free', 'secondary'),
          ]),
          card({ base: { gap: '18px', borderColor: 'var(--color-brand)', borderWidth: '2px' } }, [
            badge('Most popular'),
            h('Studio', 'h3', H3),
            h('$24', 'h3', STAT),
            p('For freelancers and small teams shipping client work.'),
            n('list', { marker: 'check', items: items('Unlimited projects', 'Custom domains', 'HTML and CSS export') }),
            btn('Choose Studio'),
          ]),
          card({ base: { gap: '18px' } }, [
            h('Team', 'h3', H3),
            h('$79', 'h3', STAT),
            p('For teams who need review and shared design tokens.'),
            n('list', { marker: 'check', items: items('Everything in Studio', 'Shared components', 'Priority support') }),
            btn('Contact sales', 'secondary'),
          ]),
        ]),
      ]),
    ]),
  },
  {
    id: 'faq',
    label: 'FAQ',
    category: 'Content',
    hint: 'Stacked question and answer cards.',
    thumb: T.faq,
    tree: section(undefined, [
      container({ base: { maxWidth: '820px', gap: '40px' } }, [
        h('Questions, answered', 'h2', { base: { ...H2.base, textAlign: 'center' } }),
        stack({ base: { gap: '14px' } }, [
          card({ base: { gap: '8px', paddingTop: '22px', paddingBottom: '22px' } }, [
            h('Do I own the output?', 'h3', H3),
            p('Yes. Export gives you plain HTML, one stylesheet and your assets. Host it anywhere.'),
          ]),
          card({ base: { gap: '8px', paddingTop: '22px', paddingBottom: '22px' } }, [
            h('Can I edit the exported code?', 'h3', H3),
            p('It is readable, indented and framework-free, so yes — though changes will not flow back into the editor.'),
          ]),
          card({ base: { gap: '8px', paddingTop: '22px', paddingBottom: '22px' } }, [
            h('Does it work without JavaScript?', 'h3', H3),
            p('The exported site does. Layout and styling are pure CSS; only the editor itself needs JavaScript.'),
          ]),
        ]),
      ]),
    ]),
  },
  {
    id: 'gallery',
    label: 'Gallery',
    category: 'Content',
    hint: 'Grid of images.',
    thumb: T.gallery,
    tree: section(undefined, [
      container({ base: { gap: '32px' } }, [
        h('Selected work', 'h2', H2),
        grid({ base: { gap: '16px' } }, [
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
          img({ base: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius)' } }),
        ]),
      ]),
    ]),
  },
  {
    id: 'cta',
    label: 'Call to action',
    category: 'Conversion',
    hint: 'Boxed closing pitch.',
    thumb: T.cta,
    tree: section(undefined, [
      container(undefined, [
        card(
          {
            base: {
              alignItems: 'center',
              textAlign: 'center',
              gap: '20px',
              paddingTop: '64px',
              paddingBottom: '64px',
              backgroundColor: 'var(--color-brand-soft)',
              borderColor: 'transparent',
            },
          },
          [
            h('Ready to build something?', 'h2', H2),
            p('Start with a blank page or drop in a template. Free while you are figuring it out.', {
              base: { ...LEAD.base, textAlign: 'center' },
            }),
            btn('Open the editor'),
          ],
        ),
      ]),
    ]),
  },
  {
    id: 'contact',
    label: 'Contact',
    category: 'Conversion',
    hint: 'Copy beside a working form.',
    thumb: T.contact,
    tree: section(undefined, [
      container(undefined, [
        row({ base: { gap: '64px', alignItems: 'flex-start' }, mobile: { gap: '36px' } }, [
          stack({ base: { gap: '18px', flexBasis: '46%', flexGrow: '1' } }, [
            p('Contact', EYEBROW),
            h('Tell us what you are building', 'h2', H2),
            p('We answer every message within one business day.'),
            n('list', { marker: 'none', items: items('hello@blokza.com', '+1 (555) 019-4477') }),
          ]),
          n('form', { name: 'contact', method: 'post', netlify: true }, { base: { flexBasis: '50%', maxWidth: 'none' } }, [
            n('input', { label: 'Name', type: 'text', placeholder: 'Ada Lovelace', required: true }),
            n('input', { label: 'Email', type: 'email', placeholder: 'you@company.com', required: true }),
            n('textarea', { label: 'Message', placeholder: 'What are you working on?', rows: 5 }),
            n('submit', { label: 'Send message', variant: 'primary' }),
          ]),
        ]),
      ]),
    ]),
  },
  {
    id: 'footer',
    label: 'Footer',
    category: 'Navigation',
    hint: 'Link columns plus a legal line.',
    thumb: T.footer,
    tree: section(
      {
        base: {
          paddingTop: '72px',
          paddingBottom: '40px',
          backgroundColor: 'var(--color-surface)',
          borderStyle: 'solid',
          borderTopWidth: '1px',
          borderRightWidth: '0px',
          borderBottomWidth: '0px',
          borderLeftWidth: '0px',
          borderColor: 'var(--color-line)',
        },
      },
      [
        container({ base: { gap: '48px' } }, [
          grid({ base: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '40px' }, mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } }, [
            stack({ base: { gap: '12px' } }, [
              h('Product', 'h4', H4),
              n('list', { marker: 'none', items: items('Builder', 'Templates', 'Export', 'Changelog') }),
            ]),
            stack({ base: { gap: '12px' } }, [
              h('Company', 'h4', H4),
              n('list', { marker: 'none', items: items('About', 'Careers', 'Blog', 'Contact') }),
            ]),
            stack({ base: { gap: '12px' } }, [
              h('Resources', 'h4', H4),
              n('list', { marker: 'none', items: items('Docs', 'Guides', 'Community', 'Status') }),
            ]),
            stack({ base: { gap: '12px' } }, [
              h('Legal', 'h4', H4),
              n('list', { marker: 'none', items: items('Privacy', 'Terms', 'Security', 'DPA') }),
            ]),
          ]),
          n('divider'),
          row({ base: { justifyContent: 'space-between', gap: '16px' } }, [
            p('© 2026 BLOKZA. All rights reserved.', { base: { fontSize: '14px' } }),
            row({ base: { width: 'auto', gap: '20px' }, mobile: { flexDirection: 'row', alignItems: 'center', width: 'auto' } }, [
              n('link', { label: 'Privacy', href: '/' }),
              n('link', { label: 'Terms', href: '/' }),
            ]),
          ]),
        ]),
      ],
      { tag: 'footer' },
    ),
  },
];

const CATEGORY_ORDER = ['Navigation', 'Hero', 'Features', 'Social proof', 'Conversion', 'Content'];

export function templatesByCategory(query = ''): { category: string; templates: Template[] }[] {
  const q = query.trim().toLowerCase();
  const match = (t: Template) =>
    !q ||
    t.label.toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q) ||
    (t.hint ?? '').toLowerCase().includes(q);

  const buckets = new Map<string, Template[]>();
  for (const template of TEMPLATES) {
    if (!match(template)) continue;
    const bucket = buckets.get(template.category) ?? [];
    bucket.push(template);
    buckets.set(template.category, bucket);
  }

  const ordered = [...buckets.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );
  return ordered.map((category) => ({ category, templates: buckets.get(category) as Template[] }));
}
