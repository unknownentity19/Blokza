/**
 * The inspector panel.
 *
 * The header is the important part: it tells you *which layer you are editing*
 * before you change anything. Editing on the Mobile device writes a mobile
 * override; arming Hover writes a hover rule. Without that banner, per-breakpoint
 * styling is a trap — you set something on mobile, it does not appear on desktop,
 * and nothing explained why.
 */

import { Collapsible, EmptyState, Field, Icon, Segmented } from '../common';
import { useEditor } from '../../store/editor';
import { breakpointForDevice } from '../../core/devices';
import { nodeLabel } from '../../core/factory';
import { getComponent } from '../../registry/registry';
import { ancestorsOf } from '../../core/tree';
import { BREAKPOINT_LABEL, type ComponentGroup, type InspectorTabId } from '../../core/types';
import { ContentTab } from './ContentTab';
import { StyleTab } from './StyleTab';
import { TextControl, ToggleControl } from './controls';
import { useStyleAccess } from './useStyle';

const TABS: { value: InspectorTabId; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'style', label: 'Style' },
  { value: 'advanced', label: 'Settings' },
];

/**
 * Which tab to open for a component the user has just selected.
 *
 * Layout primitives exist to be styled; everything else exists to hold content.
 * Opening on the wrong one costs a click on the single most common action there
 * is — clicking a link and pointing it at a page.
 */
function preferredTab(group: ComponentGroup | undefined): InspectorTabId {
  return group === 'layout' || group === undefined ? 'style' : 'content';
}

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const pinnedTab = useEditor((s) => s.inspectorTab);
  const tabPinnedFor = useEditor((s) => s.tabPinnedFor);
  const setTab = useEditor((s) => s.setInspectorTab);
  const device = useEditor((s) => s.device);
  const styleState = useEditor((s) => s.styleState);
  const setStyleState = useEditor((s) => s.setStyleState);
  const select = useEditor((s) => s.select);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const setInspectorOpen = useEditor((s) => s.setInspectorOpen);

  // Every hook runs before any early return below — including `useStyleAccess`,
  // which is a hook and must not be skipped when the panel is collapsed or empty.
  const access = useStyleAccess();

  const node = selectedId ? doc.nodes[selectedId] : undefined;
  const def = node ? getComponent(node.type) : undefined;
  const breakpoint = breakpointForDevice(device);

  // A tab the user picked for *this* node wins; otherwise open where the useful
  // controls are for the kind of thing they just selected.
  const tab: InspectorTabId =
    tabPinnedFor === selectedId ? pinnedTab : preferredTab(def?.group);

  // Collapsed to a strip. Below ~940px the panels overlay the canvas, so without
  // this there is no way to see what you are editing.
  if (!inspectorOpen) {
    return (
      <aside className="ui-inspector is-collapsed" aria-label="Properties">
        <button
          type="button"
          className="ui-inspector__reopen"
          onClick={() => setInspectorOpen(true)}
          title="Show properties"
          aria-label="Show properties"
          aria-expanded={false}
        >
          <Icon path="M15 6l-6 6 6 6" size={14} strokeWidth={2} />
        </button>
      </aside>
    );
  }

  if (!node || !def) {
    return (
      <aside className="ui-inspector" aria-label="Properties">
        <div className="ui-inspector__bare">
          <button
            type="button"
            className="ui-inspector__collapse"
            onClick={() => setInspectorOpen(false)}
            title="Hide properties"
            aria-label="Hide properties"
          >
            <Icon path="M9 6l6 6-6 6" size={14} strokeWidth={2} />
          </button>
        </div>
        <EmptyState
          title="Nothing selected"
          body="Click an element on the canvas, or pick one from Layers, to edit it."
          icon="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"
        />
      </aside>
    );
  }

  const trail = [...ancestorsOf(doc.nodes, node.id)].reverse();

  return (
    <aside className="ui-inspector" aria-label="Properties">
      <header className="ui-inspector__head">
        <nav className="ui-crumbs" aria-label="Element path">
          {trail.map((id) => (
            <button key={id} type="button" onClick={() => select(id)}>
              {nodeLabel(doc, doc.nodes[id])}
            </button>
          ))}
          <strong>{nodeLabel(doc, node)}</strong>
        </nav>

        <div className="ui-inspector__meta">
          <span className="ui-chip">{def.label}</span>
          <button
            type="button"
            className="ui-inspector__collapse"
            onClick={() => setInspectorOpen(false)}
            title="Hide properties"
            aria-label="Hide properties"
            aria-expanded
          >
            <Icon path="M9 6l6 6-6 6" size={14} strokeWidth={2} />
          </button>
          <div className="ui-statetoggle">
            <button
              type="button"
              className={`ui-statebtn ${styleState === null ? 'is-on' : ''}`}
              onClick={() => setStyleState(null)}
            >
              Normal
            </button>
            <button
              type="button"
              className={`ui-statebtn ${styleState === 'hover' ? 'is-on' : ''}`}
              onClick={() => setStyleState('hover')}
              title="Edit styles that apply on hover"
            >
              Hover
            </button>
          </div>
        </div>

        {tab === 'style' ? (
          <p className={`ui-layerbar ${access.isOverrideLayer ? 'is-override' : ''}`}>
            <Icon
              path={
                styleState === 'hover'
                  ? 'M4 12l6 6 10-14'
                  : 'M3 5h18v11H3zM8 20h8'
              }
              size={13}
            />
            {styleState === 'hover' ? (
              <>Editing <b>hover</b> styles</>
            ) : breakpoint === 'base' ? (
              <>Editing <b>all breakpoints</b></>
            ) : (
              <>
                Editing <b>{BREAKPOINT_LABEL[breakpoint]}</b> only
              </>
            )}
            {access.modifiedKeys.length ? (
              <button
                type="button"
                className="ui-layerbar__reset"
                onClick={() => access.reset(access.modifiedKeys)}
                title={
                  access.isOverrideLayer
                    ? `Remove all ${access.modifiedKeys.length} overrides on this layer`
                    : `Restore ${access.modifiedKeys.length} changed properties to the component defaults`
                }
              >
                Reset {access.modifiedKeys.length}
              </button>
            ) : null}
          </p>
        ) : null}

        <Segmented value={tab} options={TABS} onChange={setTab} ariaLabel="Inspector section" compact />
      </header>

      <div className="ui-inspector__body">
        {tab === 'content' ? <ContentTab /> : null}
        {tab === 'style' ? <StyleTab /> : null}
        {tab === 'advanced' ? <AdvancedTab /> : null}
      </div>
    </aside>
  );
}

function AdvancedTab() {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const rename = useEditor((s) => s.rename);
  const toggleFlag = useEditor((s) => s.toggleFlag);
  const setAnchor = useEditor((s) => s.setAnchor);
  const duplicate = useEditor((s) => s.duplicate);
  const remove = useEditor((s) => s.remove);
  const wrapInContainer = useEditor((s) => s.wrapInContainer);
  const shareSection = useEditor((s) => s.shareSection);
  const unshareSection = useEditor((s) => s.unshareSection);

  const node = selectedId ? doc.nodes[selectedId] : undefined;
  if (!node) return null;
  const def = getComponent(node.type);

  return (
    <div className="ui-panel__pad">
      <Collapsible title="Element" id="adv-element">
        <Field label="Name" hint="Shown in the Layers panel. Does not affect the export.">
          <TextControl
            value={node.name ?? ''}
            placeholder={def?.label ?? node.type}
            onCommit={(value) => rename(node.id, value)}
          />
        </Field>
        <Field
          label="Anchor"
          hint={
            node.anchorId
              ? `Link to this element with #${node.anchorId}`
              : 'Give this element an id so links can jump to it, e.g. "pricing".'
          }
        >
          <TextControl
            value={node.anchorId ?? ''}
            placeholder="pricing"
            onCommit={(value) => setAnchor(node.id, value)}
          />
        </Field>
        <Field label="Hidden" hint="Hidden elements stay in the document but are left out of the export.">
          <ToggleControl
            value={node.hidden === true}
            label="Hidden"
            onCommit={() => toggleFlag(node.id, 'hidden')}
          />
        </Field>
        <Field label="Locked" hint="Locked elements cannot be selected on the canvas, dragged, or deleted.">
          <ToggleControl
            value={node.locked === true}
            label="Locked"
            onCommit={() => toggleFlag(node.id, 'locked')}
          />
        </Field>
      </Collapsible>

      <Collapsible title="Across pages" id="adv-shared">
        {node.type === 'shared' ? (
          <>
            <p className="ui-field__hint">
              This section is shared. Editing it here changes it on every page that
              uses it.
            </p>
            <div className="ui-btnrow">
              <button type="button" className="ui-btn" onClick={() => unshareSection(node.id)}>
                <Icon path="M9 15l-2 2a4 4 0 0 1-5-5l2-2M15 9l2-2a4 4 0 0 1 5 5l-2 2M4 4l16 16" size={14} />
                Give this page its own copy
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ui-field__hint">
              Share a nav bar or footer once and every page uses the same copy —
              edit it in one place instead of keeping them in step by hand.
            </p>
            <div className="ui-btnrow">
              <button type="button" className="ui-btn" onClick={() => shareSection(node.id)}>
                <Icon path="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" size={14} />
                Share across pages
              </button>
            </div>
          </>
        )}
      </Collapsible>

      <Collapsible title="Actions" id="adv-actions">
        <div className="ui-btnrow">
          <button type="button" className="ui-btn" onClick={() => duplicate(node.id)}>
            <Icon path="M8 8h12v12H8zM4 16V4h12" size={14} /> Duplicate
          </button>
          <button type="button" className="ui-btn" onClick={() => wrapInContainer(node.id)}>
            <Icon path="M4 4h16v16H4zM8 8h8v8H8z" size={14} /> Wrap in stack
          </button>
          <button type="button" className="ui-btn is-danger" onClick={() => remove(node.id)}>
            <Icon path="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" size={14} /> Delete
          </button>
        </div>
      </Collapsible>

      <Collapsible title="Debug" id="adv-debug" defaultOpen={false}>
        <Field label="Type">
          <code className="ui-code">{node.type}</code>
        </Field>
        <Field label="CSS class" hint="The generated selector this element's styles are written to.">
          <code className="ui-code">.n-{node.id}</code>
        </Field>
        <Field label="Children">
          <code className="ui-code">{node.children.length}</code>
        </Field>
      </Collapsible>
    </div>
  );
}
