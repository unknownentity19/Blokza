/**
 * The insert panel: templates and primitives.
 *
 * Two tabs on purpose. **Sections** are pre-composed trees for getting a page
 * started; **Elements** are the primitives everything is actually made of. The
 * important difference from the old editor is that a section is not a black box
 * — dropping "Hero · split" gives you a Section holding a Container holding a
 * Row, all of which select, restyle and come apart like anything you built by
 * hand.
 *
 * Every card can be either clicked (insert at a sensible place) or dragged (drop
 * exactly where you want it).
 */

import { useMemo, useState } from 'react';
import { beginDragFromChrome } from '../../canvas/dragSource';
import { Icon } from '../common';
import { useEditor } from '../../store/editor';
import { allComponents } from '../../registry/registry';
import { templatesByCategory, type Template } from '../../registry/templates';
import type { ComponentDef, ComponentGroup } from '../../core/types';

const GROUP_LABEL: Record<ComponentGroup, string> = {
  layout: 'Layout',
  content: 'Content',
  media: 'Media',
  form: 'Forms',
  advanced: 'Advanced',
};

const GROUP_ORDER: ComponentGroup[] = ['layout', 'content', 'media', 'form', 'advanced'];

export function InsertPanel() {
  const [tab, setTab] = useState<'sections' | 'elements'>('sections');
  const [query, setQuery] = useState('');

  const insertComponent = useEditor((s) => s.insertComponent);
  const insertTemplate = useEditor((s) => s.insertTemplate);

  const sections = useMemo(() => (tab === 'sections' ? templatesByCategory(query) : []), [tab, query]);

  const elements = useMemo(() => {
    if (tab !== 'elements') return [];
    const q = query.trim().toLowerCase();
    const matches = allComponents().filter(
      (component) =>
        !component.fixed &&
        (!q ||
          component.label.toLowerCase().includes(q) ||
          component.type.includes(q) ||
          (component.hint ?? '').toLowerCase().includes(q)),
    );
    return GROUP_ORDER.map((group) => ({
      group,
      items: matches.filter((component) => component.group === group),
    })).filter((bucket) => bucket.items.length > 0);
  }, [tab, query]);

  const empty =
    (tab === 'sections' && sections.length === 0) || (tab === 'elements' && elements.length === 0);

  return (
    <div className="ui-panel">
      <div className="ui-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sections'}
          className={tab === 'sections' ? 'is-on' : ''}
          onClick={() => {
            setTab('sections');
            setQuery('');
          }}
        >
          Sections
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'elements'}
          className={tab === 'elements' ? 'is-on' : ''}
          onClick={() => {
            setTab('elements');
            setQuery('');
          }}
        >
          Elements
        </button>
      </div>

      <div className="ui-search">
        <Icon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" size={14} />
        <input
          type="search"
          value={query}
          placeholder={tab === 'sections' ? 'Search sections' : 'Search elements'}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search"
        />
      </div>

      <div className="ui-panel__scroll">
        {empty ? <p className="ui-panel__empty">No matches for “{query}”.</p> : null}

        {sections.map((bucket) => (
          <section className="ui-group" key={bucket.category}>
            <h3>{bucket.category}</h3>
            <div className="ui-cards">
              {bucket.templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onInsert={() => insertTemplate(template)}
                />
              ))}
            </div>
          </section>
        ))}

        {elements.map((bucket) => (
          <section className="ui-group" key={bucket.group}>
            <h3>{GROUP_LABEL[bucket.group]}</h3>
            <div className="ui-tiles">
              {bucket.items.map((component) => (
                <ElementTile
                  key={component.type}
                  component={component}
                  onInsert={() => insertComponent(component.type)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template, onInsert }: { template: Template; onInsert: () => void }) {
  return (
    <button
      type="button"
      className="ui-card"
      title={template.hint}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // The payload names the template's root component type so drop
        // validation checks the element that will actually be inserted; the tree
        // itself rides along and is expanded on release. A press that does not
        // travel far enough to be a drag calls `onTap` instead — see
        // `beginDragFromChrome` for why there is no `onClick` here.
        beginDragFromChrome({ kind: 'new', componentType: template.tree.type }, event, {
          template,
          onTap: onInsert,
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onInsert();
        }
      }}
    >
      <span className="ui-card__label">{template.label}</span>
      <span
        className="ui-card__thumb"
        // Authored wireframe markup from `templates.ts`, never user input.
        dangerouslySetInnerHTML={{
          __html: `<svg viewBox="0 0 120 64" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">${template.thumb}</svg>`,
        }}
      />
    </button>
  );
}

function ElementTile({ component, onInsert }: { component: ComponentDef; onInsert: () => void }) {
  return (
    <button
      type="button"
      className="ui-tile"
      title={component.hint ?? component.label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        beginDragFromChrome({ kind: 'new', componentType: component.type }, event, {
          onTap: onInsert,
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onInsert();
        }
      }}
    >
      <Icon path={component.icon} size={17} />
      <span>{component.label}</span>
    </button>
  );
}
