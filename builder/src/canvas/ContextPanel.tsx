/**
 * The controls for whatever is selected, floating next to it on the canvas.
 *
 * The side inspector is complete but it is not where the eye is: editing a
 * heading meant looking at the canvas, moving to a panel on the far right,
 * finding the right tab, and coming back. For the common edits that round trip
 * is the whole cost of the interaction.
 *
 * So the controls come to the element. This panel shows the component's own
 * content fields — the same schema the inspector renders, so a new component is
 * covered automatically — plus a short row of the style properties that
 * particular kind of element is usually adjusted by. Everything else stays one
 * click away in the full inspector.
 *
 * It lives in the parent document, positioned from the selection's frame-space
 * rectangle, and opts back into pointer events inside the overlay layer.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { Icon } from '../ui/common';
import { FieldEditor } from '../ui/inspector/ContentTab';
import { ColorControl, LengthControl, SelectControl } from '../ui/inspector/controls';
import { useStyleAccess } from '../ui/inspector/useStyle';
import { options } from '../registry/helpers';
import { getComponent } from '../registry/registry';
import { countSharedInstances, sharedContaining } from '../core/doc';
import { nodeLabel } from '../core/factory';
import { useEditor } from '../store/editor';
import type { ComponentGroup, Rect, StyleKey } from '../core/types';

/** How many content fields to show before deferring to the full inspector. */
const MAX_FIELDS = 4;
const PANEL_WIDTH = 244;
const GAP = 14;

export interface ContextPanelProps {
  /** Selection rectangle in frame coordinates. */
  rect: Rect | null;
  /** Frame size, so the panel can be kept on screen. */
  frameSize: { width: number; height: number };
  zoom: number;
  /** Hidden while a text range is selected — the format toolbar owns that moment. */
  suppressed: boolean;
}

/**
 * The style controls worth surfacing for each kind of component.
 *
 * Chosen by what people actually reach for: a box is adjusted by its spacing and
 * background, text by its size, colour and alignment. Deliberately short — this
 * is the shortcut, not a replacement for the inspector.
 */
const QUICK_STYLES: Record<ComponentGroup, StyleKey[]> = {
  layout: ['paddingTop', 'paddingBottom', 'backgroundColor', 'gap'],
  content: ['fontSize', 'color', 'textAlign'],
  media: ['width', 'borderRadius', 'objectFit'],
  form: ['width', 'color'],
  advanced: ['width', 'color'],
};

/**
 * Per-type overrides, where the group is too coarse.
 *
 * A Section is adjusted by its padding and background; a Row is adjusted by which
 * way it runs and how its children line up. Both are "layout", so offering the
 * same four controls for each would waste the panel on the wrong ones.
 */
const QUICK_STYLES_BY_TYPE: Record<string, StyleKey[]> = {
  row: ['flexDirection', 'gap', 'alignItems', 'justifyContent'],
  stack: ['gap', 'alignItems', 'paddingTop', 'backgroundColor'],
  grid: ['gridTemplateColumns', 'gap', 'alignItems'],
  card: ['paddingTop', 'backgroundColor', 'borderRadius', 'gap'],
  spacer: ['height'],
  divider: ['borderTopWidth', 'borderColor'],
  icon: ['width', 'color'],
  badge: ['fontSize', 'color', 'backgroundColor'],
};

/**
 * Content fields that are plumbing rather than content.
 *
 * `tag` only changes the exported element name. It matters, but not enough to
 * occupy the panel that is meant to answer "what can I change here?" — a Section
 * whose only offered control was its HTML tag looked broken.
 */
const PLUMBING_FIELDS = new Set(['tag']);

const ALIGN_OPTIONS = options(['left', 'Left'], ['center', 'Centre'], ['right', 'Right']);
const FIT_OPTIONS = options(['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Fill']);
const DIRECTION_OPTIONS = options(['row', 'Across'], ['column', 'Down']);
const ITEMS_OPTIONS = options(
  ['stretch', 'Stretch'],
  ['flex-start', 'Start'],
  ['center', 'Centre'],
  ['flex-end', 'End'],
);
const JUSTIFY_OPTIONS = options(
  ['flex-start', 'Start'],
  ['center', 'Centre'],
  ['flex-end', 'End'],
  ['space-between', 'Space between'],
);

export function ContextPanel({ rect, frameSize, zoom, suppressed }: ContextPanelProps) {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const setInspectorOpen = useEditor((s) => s.setInspectorOpen);
  const setInspectorTab = useEditor((s) => s.setInspectorTab);
  const shareSection = useEditor((s) => s.shareSection);
  const currentPageId = useEditor((s) => s.currentPageId);
  const access = useStyleAccess();

  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // Measured so the panel can flip above the selection when it would overflow.
  useLayoutEffect(() => {
    if (panelRef.current) setHeight(panelRef.current.offsetHeight);
  }, [selectedId, collapsed, doc]);

  const node = selectedId ? doc.nodes[selectedId] : undefined;
  const def = node ? getComponent(node.type) : undefined;
  if (!node || !def || !rect || suppressed) return null;

  /*
   * Placed to the right of the selection where there is room, otherwise to the
   * left, otherwise overlapping its edge — anything is better than a panel that
   * has drifted off the visible canvas.
   */
  const scaled = PANEL_WIDTH / zoom;
  const spaceRight = frameSize.width - (rect.left + rect.width);
  const left =
    spaceRight > scaled + GAP
      ? rect.left + rect.width + GAP / zoom
      : rect.left > scaled + GAP
        ? rect.left - scaled - GAP / zoom
        : Math.max(GAP, frameSize.width - scaled - GAP);

  const scaledHeight = height / zoom;
  const top = Math.max(
    GAP,
    Math.min(rect.top, Math.max(GAP, frameSize.height - scaledHeight - GAP)),
  );

  /*
   * Sharing is offered here because it could not be found anywhere else. It
   * lives in the inspector too, three levels down — panel, Settings tab, a
   * collapsed "Across pages" group — and building a seven-page site without
   * noticing it is the default outcome. Editing a nav bar seven times is the
   * single largest cost in a multi-page site, so the offer belongs on the thing
   * itself, next to the page count it applies to.
   */
  const shared = sharedContaining(doc, node.id);
  const pageRootId = doc.pages.find((page) => page.id === currentPageId)?.rootId;
  const canShare = !shared && node.parent === pageRootId && doc.pages.length > 1;
  const sharedPageCount = shared ? countSharedInstances(doc, shared.id) : 0;

  const offered = (def.fields ?? []).filter((field) => !PLUMBING_FIELDS.has(field.key));
  const fields = offered.slice(0, MAX_FIELDS);
  const hiddenFieldCount = (def.fields ?? []).length - fields.length;
  const quick = QUICK_STYLES_BY_TYPE[node.type] ?? QUICK_STYLES[def.group] ?? [];

  const styleControl = (key: StyleKey) => {
    const own = access.own(key) ?? '';
    const inherited = access.effective(key);
    switch (key) {
      case 'backgroundColor':
      case 'color':
        return (
          <ColorControl
            value={own}
            inherited={inherited}
            tokens={doc.theme.colors}
            onCommit={(value, coalesce) => access.set(key, value, coalesce)}
          />
        );
      case 'textAlign':
        return (
          <SelectControl
            value={own}
            placeholder={inherited ?? 'Left'}
            options={ALIGN_OPTIONS}
            onCommit={(value) => access.set(key, value)}
          />
        );
      case 'flexDirection':
        return (
          <SelectControl
            value={own}
            placeholder={inherited ?? 'Across'}
            options={DIRECTION_OPTIONS}
            onCommit={(value) => access.set(key, value)}
          />
        );
      case 'alignItems':
        return (
          <SelectControl
            value={own}
            placeholder={inherited ?? 'Stretch'}
            options={ITEMS_OPTIONS}
            onCommit={(value) => access.set(key, value)}
          />
        );
      case 'justifyContent':
        return (
          <SelectControl
            value={own}
            placeholder={inherited ?? 'Start'}
            options={JUSTIFY_OPTIONS}
            onCommit={(value) => access.set(key, value)}
          />
        );
      case 'gridTemplateColumns':
      case 'borderColor':
        return key === 'borderColor' ? (
          <ColorControl
            value={own}
            inherited={inherited}
            tokens={doc.theme.colors}
            onCommit={(value, coalesce) => access.set(key, value, coalesce)}
          />
        ) : (
          <SelectControl
            value={own}
            placeholder={inherited ?? '3 columns'}
            options={options(
              ['repeat(2, minmax(0, 1fr))', '2 columns'],
              ['repeat(3, minmax(0, 1fr))', '3 columns'],
              ['repeat(4, minmax(0, 1fr))', '4 columns'],
            )}
            onCommit={(value) => access.set(key, value)}
          />
        );
      case 'objectFit':
        return (
          <SelectControl
            value={own}
            placeholder={inherited ?? 'Cover'}
            options={FIT_OPTIONS}
            onCommit={(value) => access.set(key, value)}
          />
        );
      default:
        return (
          <LengthControl
            value={own}
            inherited={inherited}
            onCommit={(value, coalesce) => access.set(key, value, coalesce)}
          />
        );
    }
  };

  const label: Record<string, string> = {
    paddingTop: 'Padding',
    paddingBottom: 'Pad btm',
    backgroundColor: 'Fill',
    gap: 'Gap',
    fontSize: 'Size',
    color: 'Colour',
    textAlign: 'Align',
    width: 'Width',
    height: 'Height',
    borderRadius: 'Radius',
    borderTopWidth: 'Thickness',
    borderColor: 'Colour',
    objectFit: 'Fit',
    flexDirection: 'Flow',
    alignItems: 'Align',
    justifyContent: 'Spread',
    gridTemplateColumns: 'Columns',
  };

  return (
    <div
      ref={panelRef}
      className="cx"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${PANEL_WIDTH}px`,
        transform: `scale(${1 / zoom})`,
      }}
      // Clicking the panel must not reach the canvas underneath and reselect.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="cx__head">
        <span className="cx__name" title={nodeLabel(doc, node)}>
          {nodeLabel(doc, node)}
        </span>
        <button
          type="button"
          className="cx__fold"
          onClick={() => setCollapsed((open) => !open)}
          title={collapsed ? 'Show controls' : 'Hide controls'}
          aria-expanded={!collapsed}
        >
          <Icon path={collapsed ? 'M6 9l6 6 6-6' : 'M18 15l-6-6-6 6'} size={13} strokeWidth={2} />
        </button>
      </header>

      {collapsed ? null : (
        <div className="cx__body">
          {fields.length ? (
            <div className="cx__group">
              {fields.map((field) => (
                <FieldEditor key={field.key} field={field} node={node} path={field.key} />
              ))}
            </div>
          ) : null}

          {quick.length ? (
            <div className="cx__group cx__group--style">
              <span className="cx__legend">
                {access.isOverrideLayer ? `Style · ${access.layer} only` : 'Style'}
              </span>
              <div className="cx__styles">
                {quick.map((key) => (
                  <label className="cx__row" key={key}>
                    <span>{label[key] ?? key}</span>
                    {styleControl(key)}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {shared ? (
            <p className="cx__note">
              <Icon path="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" size={12} />
              Shared — this edit changes {sharedPageCount === 1 ? 'the page' : `all ${sharedPageCount} pages`} using “{shared.name}”.
            </p>
          ) : canShare ? (
            <button
              type="button"
              className="cx__share"
              onClick={() => shareSection(node.id)}
              title={`Use this section on all ${doc.pages.length} pages and edit it in one place`}
            >
              <Icon path="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" size={12} />
              Use on all {doc.pages.length} pages
            </button>
          ) : null}

          <button
            type="button"
            className="cx__more"
            onClick={() => {
              setInspectorOpen(true);
              setInspectorTab('style');
            }}
          >
            All settings
            {hiddenFieldCount ? ` · ${hiddenFieldCount} more field${hiddenFieldCount > 1 ? 's' : ''}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
