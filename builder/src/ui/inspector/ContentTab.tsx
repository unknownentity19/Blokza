/**
 * The content tab: the selected component's own fields, driven by its `fields`
 * schema so a new component gets a working inspector for free.
 */

import { useState } from 'react';
import { Field, Icon, EmptyState } from '../common';
import { useEditor } from '../../store/editor';
import { anchorsOnPage } from '../../core/doc';
import { ColorControl, LengthControl, SelectControl, TextControl, ToggleControl } from './controls';
import { ICON_NAMES, iconPath } from '../../registry/icons';
import { getComponent } from '../../registry/registry';
import type { FieldDef, SBNode } from '../../core/types';

export function ContentTab() {
  const node = useEditor((s) => (s.selectedId ? s.doc.nodes[s.selectedId] : undefined));
  const def = node ? getComponent(node.type) : undefined;

  if (!node || !def) return null;
  if (!def.fields?.length) {
    return (
      <EmptyState
        title="No content settings"
        body={`${def.label} is a layout element — style it, or select something inside it.`}
        icon="M4 6h16M4 12h16M4 18h10"
      />
    );
  }

  return (
    <div className="ui-panel__pad">
      {def.fields
        .filter((field) => visible(field, node))
        .map((field) => (
          <FieldEditor key={field.key} field={field} node={node} path={field.key} />
        ))}
    </div>
  );
}

function visible(field: FieldDef, node: SBNode): boolean {
  if (!field.showWhen) return true;
  return field.showWhen.equals.includes(node.props[field.showWhen.key]);
}

export function FieldEditor({ field, node, path }: { field: FieldDef; node: SBNode; path: string }) {
  const setProp = useEditor((s) => s.setProp);
  const tokens = useEditor((s) => s.doc.theme.colors);

  const raw = readPath(node.props, path);
  const asString = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
  const write = (value: unknown, coalesce = false) => setProp(node.id, path, value, coalesce);

  switch (field.type) {
    case 'textarea':
    case 'richtext':
    case 'code':
      return (
        <Field label={field.label} hint={field.help} wide>
          <TextControl
            multiline
            rows={field.type === 'textarea' ? 3 : 6}
            monospace={field.type !== 'textarea'}
            value={asString}
            placeholder={field.placeholder}
            onCommit={(value) => write(value)}
          />
        </Field>
      );

    case 'link':
      return <LinkField field={field} value={asString} onWrite={(value) => write(value)} />;

    case 'url':
    case 'image':
      return (
        <Field label={field.label} hint={field.help} wide>
          <TextControl value={asString} placeholder={field.placeholder} onCommit={(value) => write(value)} />
        </Field>
      );

    case 'number':
    case 'range':
      return (
        <Field label={field.label} hint={field.help}>
          {field.type === 'range' ? (
            <div className="ui-rangerow">
              <input
                type="range"
                min={field.min ?? 0}
                max={field.max ?? 10}
                step={field.step ?? 1}
                value={Number(raw ?? field.min ?? 0)}
                onChange={(event) => write(Number(event.target.value), true)}
                aria-label={field.label}
              />
              <span className="ui-rangerow__value">{String(raw ?? '')}</span>
            </div>
          ) : (
            <LengthControl
              value={asString}
              units={['']}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              onCommit={(value, coalesce) => write(value === null ? undefined : Number.parseFloat(value), coalesce)}
            />
          )}
        </Field>
      );

    case 'color':
      return (
        <Field label={field.label} hint={field.help}>
          <ColorControl
            value={asString}
            tokens={tokens}
            onCommit={(value, coalesce) => write(value ?? '', coalesce)}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={field.label} hint={field.help}>
          <SelectControl
            value={asString}
            options={field.options ?? []}
            allowEmpty={false}
            onCommit={(value) => write(value ?? '')}
          />
        </Field>
      );

    case 'toggle':
      return (
        <Field label={field.label} hint={field.help}>
          <ToggleControl value={raw === true} label={field.label} onCommit={(value) => write(value)} />
        </Field>
      );

    case 'icon':
      return (
        <Field label={field.label} hint={field.help} wide>
          <div className="ui-iconpick">
            <button
              type="button"
              className={`ui-iconpick__cell ${asString === '' ? 'is-on' : ''}`}
              title="None"
              onClick={() => write('')}
            >
              <Icon path="M6 6l12 12M18 6L6 18" size={14} />
            </button>
            {ICON_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className={`ui-iconpick__cell ${asString === name ? 'is-on' : ''}`}
                title={name}
                onClick={() => write(name)}
              >
                <Icon path={iconPath(name)} size={16} />
              </button>
            ))}
          </div>
        </Field>
      );

    case 'list':
      return <ListEditor field={field} node={node} path={path} />;

    default:
      return (
        <Field label={field.label} hint={field.help}>
          <TextControl value={asString} placeholder={field.placeholder} onCommit={(value) => write(value)} />
        </Field>
      );
  }
}

/**
 * Repeatable list field.
 *
 * Items are edited in place through the same `FieldEditor`, addressed by path
 * (`items.2.text`), which is also the address inline canvas editing uses — so
 * both routes write to exactly the same place.
 */
function ListEditor({ field, node, path }: { field: FieldDef; node: SBNode; path: string }) {
  const setProp = useEditor((s) => s.setProp);
  const raw = readPath(node.props, path);
  const items = Array.isArray(raw) ? raw : [];

  const replace = (next: unknown[]) => setProp(node.id, path, next);

  return (
    <div className="ui-list">
      <div className="ui-list__head">
        <span className="ui-field__label">{field.label}</span>
        <button
          type="button"
          className="ui-minibtn"
          onClick={() => replace([...items, { ...(field.itemDefaults ?? {}) }])}
        >
          <Icon path="M12 5v14M5 12h14" size={13} strokeWidth={2} /> Add
        </button>
      </div>

      {items.length === 0 ? <p className="ui-field__hint">No items yet.</p> : null}

      {items.map((_, index) => (
        <div className="ui-list__row" key={index}>
          <div className="ui-list__fields">
            {(field.itemFields ?? []).map((itemField) => (
              <FieldEditor
                key={itemField.key}
                field={itemField}
                node={node}
                path={`${path}.${index}.${itemField.key}`}
              />
            ))}
          </div>
          <div className="ui-list__actions">
            <button
              type="button"
              className="ui-minibtn is-icon"
              title="Move up"
              disabled={index === 0}
              onClick={() => replace(swap(items, index, index - 1))}
            >
              <Icon path="M12 19V5M5 12l7-7 7 7" size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="ui-minibtn is-icon"
              title="Move down"
              disabled={index === items.length - 1}
              onClick={() => replace(swap(items, index, index + 1))}
            >
              <Icon path="M12 5v14M19 12l-7 7-7-7" size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="ui-minibtn is-icon is-danger"
              title="Remove"
              onClick={() => replace(items.filter((__, i) => i !== index))}
            >
              <Icon path="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  const temp = next[a];
  next[a] = next[b];
  next[b] = temp;
  return next;
}

/** Read `a.0.b` out of a props object. */
function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Where a link points.
 *
 * One dropdown of the site's own pages, because that is what a link in a nav bar
 * almost always is. The previous version put a URL text box first with a small
 * "Page…" select beside it, which made the common case the hidden one — you had
 * to know the select was there. A URL field only appears once you ask for one.
 *
 * Adding a page makes it available here immediately: the options come straight
 * from the document.
 */
function LinkField({
  field,
  value,
  onWrite,
}: {
  field: FieldDef;
  value: string;
  onWrite: (value: string) => void;
}) {
  const pages = useEditor((s) => s.doc.pages);
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const matched = pages.find((page) => page.path === value);
  // In-page targets, so a long page can have its own navigation.
  const anchors = anchorsOnPage(doc, currentPageId);
  const matchedAnchor = value.startsWith('#') ? value.slice(1) : undefined;

  // "External" has to be sticky: choosing it before typing anything would
  // otherwise snap the control straight back to "No link".
  const [wantsUrl, setWantsUrl] = useState(false);
  const isUrl =
    wantsUrl ||
    (value !== '' && !matched && !anchors.some((a) => `#${a.anchorId}` === value));

  return (
    <Field label={field.label} hint={field.help} wide>
      <select
        className="ui-input ui-select"
        value={
          matched
            ? matched.path
            : matchedAnchor && anchors.some((a) => a.anchorId === matchedAnchor)
              ? `#${matchedAnchor}`
              : isUrl
                ? '__url'
                : ''
        }
        aria-label={field.label}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '__url') {
            setWantsUrl(true);
            return;
          }
          setWantsUrl(false);
          onWrite(next);
        }}
      >
        <option value="">No link</option>
        <optgroup label="Pages in this site">
          {pages.map((page) => (
            <option key={page.id} value={page.path}>
              {page.name} — {page.path}
            </option>
          ))}
        </optgroup>
        {anchors.length ? (
          <optgroup label="On this page">
            {anchors.map((anchor) => (
              <option key={anchor.id} value={`#${anchor.anchorId}`}>
                #{anchor.anchorId}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value="__url">External URL or #anchor…</option>
      </select>

      {isUrl ? (
        <div className="ui-linkurl">
          <TextControl
            value={value}
            placeholder="https://example.com or #pricing"
            onCommit={onWrite}
          />
        </div>
      ) : null}
    </Field>
  );
}
