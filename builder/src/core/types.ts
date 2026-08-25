/**
 * Core document model for the SAASWISE builder.
 *
 * Design notes
 * ------------
 * 1. Nodes live in a flat, normalised map (`SiteDoc.nodes`) and reference each
 *    other by id. Parent/child links are stored on both sides so that both
 *    "walk down" (rendering, export) and "walk up" (breadcrumb, drop
 *    validation) are O(depth) without scanning the whole document.
 * 2. Styles are *never* written as inline styles. Each node owns a per
 *    breakpoint style bag which is compiled into a scoped stylesheet
 *    (`core/css.ts`). This makes the device preview reflow for real and removes
 *    any possibility of stale style properties leaking between renders.
 * 3. Content props and style props are separate objects. The old editor mixed
 *    them in one bag and distinguished them by an underscore prefix.
 */

import type { ReactNode } from 'react';

import type { Asset } from './assets';

export const DOC_VERSION = 3;

/** Responsive breakpoints, ordered widest → narrowest. */
export const BREAKPOINTS = ['base', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Max-width for each non-base breakpoint, in px. */
export const BREAKPOINT_MAX_WIDTH: Record<Exclude<Breakpoint, 'base'>, number> = {
  tablet: 1023,
  mobile: 767,
};

export const BREAKPOINT_LABEL: Record<Breakpoint, string> = {
  base: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

/** Interaction states that can carry their own style overrides. */
export const STYLE_STATES = ['hover'] as const;
export type StyleState = (typeof STYLE_STATES)[number];

/**
 * Whitelisted CSS properties the inspector can write. Keeping this closed set
 * means the CSS generator can validate every declaration and we never emit
 * arbitrary user strings as property names.
 */
export const STYLE_KEYS = [
  // display + flex/grid
  'display',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignContent',
  'gap',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridAutoFlow',
  'gridColumn',
  'gridRow',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'order',
  // box
  'width',
  'minWidth',
  'maxWidth',
  'height',
  'minHeight',
  'maxHeight',
  'aspectRatio',
  'overflow',
  'boxSizing',
  // spacing
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  // typography
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'whiteSpace',
  'color',
  // background
  'background',
  'backgroundColor',
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',
  'backgroundRepeat',
  'backgroundClip',
  // border
  'borderStyle',
  'borderWidth',
  'borderColor',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  // effects
  'boxShadow',
  'textShadow',
  'opacity',
  'transform',
  'filter',
  'backdropFilter',
  'transition',
  'mixBlendMode',
  // position
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  // media
  'objectFit',
  'objectPosition',
  'cursor',
] as const;

export type StyleKey = (typeof STYLE_KEYS)[number];

const STYLE_KEY_SET: ReadonlySet<string> = new Set(STYLE_KEYS);

export function isStyleKey(key: string): key is StyleKey {
  return STYLE_KEY_SET.has(key);
}

/** A set of CSS declarations. Values are always strings so undo/redo diffs cleanly. */
export type StyleBag = Partial<Record<StyleKey, string>>;

/**
 * Per-node styles. `base` applies everywhere; `tablet` and `mobile` are
 * *overrides* that cascade down from `base`. State bags (`hover`) apply at all
 * breakpoints and win over the breakpoint value.
 */
export interface NodeStyles {
  base?: StyleBag;
  tablet?: StyleBag;
  mobile?: StyleBag;
  hover?: StyleBag;
}

export interface SBNode {
  id: string;
  /** Key into the component registry. */
  type: string;
  /** User-facing label shown in the layers panel. Falls back to the component label. */
  name?: string;
  /** Content properties, validated against the component's field schema. */
  props: Record<string, unknown>;
  styles: NodeStyles;
  /** Ordered child ids. Always an array — empty for leaf nodes. */
  children: string[];
  /** `null` only for a page root. */
  parent: string | null;
  /** Hidden nodes render in the canvas at low opacity and are omitted from export. */
  hidden?: boolean;
  /** Locked nodes cannot be selected by clicking, dragged, or deleted. */
  locked?: boolean;
  /**
   * HTML `id`, so the element can be linked to with `#anchor`.
   *
   * A big site needs in-page navigation and there was no way to express it: the
   * link field could type `#pricing`, but nothing could ever *be* `#pricing`.
   */
  anchorId?: string;
}

export interface Page {
  id: string;
  name: string;
  /** Site-relative path, always starts with `/`. `/` is the home page. */
  path: string;
  title: string;
  description: string;
  socialImage?: string;
  /** Id of the root node for this page (a `page-root` node). */
  rootId: string;
  /**
   * Position on the site-map canvas. Absent until the user drags the card, so a
   * document from before the flow view existed still lays out sensibly.
   */
  x?: number;
  y?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeToken {
  name: string;
  value: string;
}

export interface Theme {
  /** Design tokens exposed to the inspector and emitted as CSS custom properties. */
  colors: ThemeToken[];
  fonts: {
    heading: string;
    body: string;
    mono: string;
  };
  radius: string;
  maxWidth: string;
  /** Extra CSS the user can attach to the whole site. */
  customCss?: string;
}

/**
 * A section shared by several pages.
 *
 * Its tree lives in `SiteDoc.nodes` under `rootId`, detached from any page, and
 * pages reference it through a `shared` node. There is exactly one copy of the
 * markup, which is the point: editing the nav on one page edits it everywhere,
 * instead of leaving six divergent copies to maintain by hand.
 */
export interface SharedSection {
  id: string;
  name: string;
  rootId: string;
}

export interface SiteDoc {
  version: number;
  id: string;
  name: string;
  /** Canonical site origin, used for sitemap + social tags. */
  siteUrl: string;
  favicon?: string;
  pages: Page[];
  nodes: Record<string, SBNode>;
  /** Sections reused across pages. Optional so older documents still load. */
  shared?: SharedSection[];
  /**
   * Uploaded images, by id. Nodes point at these with `asset:<id>` so the bytes
   * are stored once no matter how many places show the image. Optional so
   * documents written before uploads existed still load.
   */
  assets?: Record<string, Asset>;
  theme: Theme;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Component registry types                                            */
/* ------------------------------------------------------------------ */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'url'
  | 'link'
  | 'number'
  | 'range'
  | 'color'
  | 'select'
  | 'toggle'
  | 'image'
  | 'icon'
  | 'code'
  | 'list';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Only show this field when another prop has one of these values. */
  showWhen?: { key: string; equals: unknown[] };
  /** For `list` fields: the schema of a single item. */
  itemFields?: FieldDef[];
  /** For `list` fields: default value for a newly added item. */
  itemDefaults?: Record<string, unknown>;
}

export type ComponentGroup = 'layout' | 'content' | 'media' | 'form' | 'advanced';

/** Props handed to a component's render function. */
export interface RenderProps {
  node: SBNode;
  props: Record<string, unknown>;
  /** Attributes that MUST be spread onto the component's root element. */
  attrs: RootAttrs;
  /** Rendered children (containers only). */
  children?: ReactNode;
  mode: RenderMode;
  /** Resolved absolute href for link-ish props, mapped through page paths. */
  resolveHref: (value: unknown) => string;
  /**
   * Resolves an `asset:<id>` reference to something a browser can load: the
   * stored data URL on the canvas, the exported file path on the way out. A
   * plain URL passes straight through.
   */
  resolveAsset: (value: unknown) => string;
}

export type RenderMode = 'canvas' | 'export';

export interface RootAttrs {
  className: string;
  'data-node-id'?: string;
  'data-node-type'?: string;
  [key: string]: unknown;
}

export interface ComponentDef {
  type: string;
  label: string;
  group: ComponentGroup;
  /** Short description shown in the palette tooltip. */
  hint?: string;
  /** Inline SVG path data or a small JSX icon for the palette card. */
  icon: string;
  /** Can this component hold children? */
  container?: boolean;
  /**
   * Restrict which component types may be dropped inside. `undefined` means
   * "anything except a page root".
   */
  allowChildren?: string[];
  /** Restrict which parents will accept this component. */
  allowParents?: string[];
  /** Cannot be deleted, duplicated, or dragged (page roots). */
  fixed?: boolean;
  /** Default content props. */
  defaults?: Record<string, unknown>;
  /** Default style bag, applied to `styles.base` on insert. */
  defaultStyles?: NodeStyles;
  /** Inspector schema. */
  fields?: FieldDef[];
  /**
   * Static CSS for this component type, emitted once per document when at
   * least one instance exists. Selectors must be prefixed with `.c-<type>`.
   */
  css?: string;
  /** Children created alongside the node when it is inserted. */
  presetChildren?: PresetChild[];
  /** Which prop keys are editable inline on the canvas, keyed by data-edit slot. */
  inlineEditable?: string[];
  render: (p: RenderProps) => ReactNode;
}

export interface PresetChild {
  type: string;
  props?: Record<string, unknown>;
  styles?: NodeStyles;
  children?: PresetChild[];
}

/* ------------------------------------------------------------------ */
/* Drag and drop                                                       */
/* ------------------------------------------------------------------ */

export type DropPosition = 'before' | 'after' | 'inside';

export interface DropTarget {
  /** The node the pointer is over. */
  nodeId: string;
  position: DropPosition;
  /** Resolved insertion point. */
  parentId: string;
  index: number;
  /** Frame-space rectangle for the insertion line. */
  rect: Rect;
  /** `true` when the line is drawn horizontally (i.e. the axis is vertical). */
  horizontal: boolean;
  /** Frame-space box of the receiving parent, outlined while dropping inside. */
  parentRect?: Rect;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type DragPayload =
  | { kind: 'new'; componentType: string }
  | { kind: 'move'; nodeId: string };

/* ------------------------------------------------------------------ */
/* Editor UI state (deliberately excluded from undo history)            */
/* ------------------------------------------------------------------ */

export type DeviceId = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface DevicePreset {
  id: DeviceId;
  label: string;
  width: number;
  height: number;
  /** Which style breakpoint this device maps onto. */
  breakpoint: Breakpoint;
  icon: string;
}

export type LeftPanelId = 'insert' | 'pages' | 'layers' | 'theme' | 'cloud' | 'settings';

/** Which workspace is on screen: the page designer, or the site map. */
export type ViewId = 'design' | 'flow';

export type InspectorTabId = 'content' | 'style' | 'advanced';
