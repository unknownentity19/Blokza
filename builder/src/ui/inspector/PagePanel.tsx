/**
 * What the properties panel shows when nothing is selected.
 *
 * It used to say "Nothing selected" and leave three hundred pixels blank — the
 * widest single piece of dead space in the editor, on screen for as long as the
 * user was looking at their page rather than clicking it. A page always has
 * settings worth showing, so this shows them: the details that decide what gets
 * published, and the sections on the page as a way to reach them.
 *
 * The title field deserves its own note. Its placeholder is the *effective*
 * title — exactly the string the exporter will write — so leaving the field
 * empty is visibly safe. An earlier version pre-filled the stored value with the
 * page name, which looked identical but went stale on every rename and shipped
 * `<title>Page 4</title>` to production.
 */

import { Field, Icon } from '../common';
import { TextControl } from './controls';
import { defaultPageTitle } from '../../core/doc';
import { nodeLabel } from '../../core/factory';
import { pageFileName } from '../../render/RenderNode';
import { useEditor } from '../../store/editor';

export function PagePanel() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const updatePage = useEditor((s) => s.updatePage);
  const select = useEditor((s) => s.select);
  const setHover = useEditor((s) => s.setHover);
  const setLeftPanel = useEditor((s) => s.setLeftPanel);

  const page = doc.pages.find((candidate) => candidate.id === currentPageId) ?? doc.pages[0];
  const root = doc.nodes[page.rootId];
  const sections = (root?.children ?? []).map((id) => ({ id, label: nodeLabel(doc, doc.nodes[id]) }));

  return (
    <div className="pg">
      <div className="pg__head">
        <span className="pg__eyebrow">Page</span>
        <strong className="pg__name">{page.name}</strong>
        <code className="pg__path">{page.path}</code>
      </div>

      <Field label="Name" hint="Used in the editor and the pages list.">
        <TextControl value={page.name} onCommit={(value) => updatePage(page.id, { name: value })} />
      </Field>

      <Field label="Path" hint={`Exports as ${pageFileName(page.path)}`}>
        <TextControl
          value={page.path}
          placeholder="/about"
          onCommit={(value) => updatePage(page.id, { path: value })}
        />
      </Field>

      <Field label="Title" hint="The browser tab and the search result." wide>
        <TextControl
          value={page.title}
          placeholder={defaultPageTitle(doc, page)}
          onCommit={(value) => updatePage(page.id, { title: value })}
        />
      </Field>

      <Field label="Description" hint="Meta description. Aim for 150 characters." wide>
        <TextControl
          multiline
          rows={3}
          value={page.description}
          placeholder="What someone would read about this page in search results."
          onCommit={(value) => updatePage(page.id, { description: value })}
        />
      </Field>

      <Field label="Social image" hint="Absolute URL used for og:image." wide>
        <TextControl
          value={page.socialImage ?? ''}
          placeholder="https://…/og.png"
          onCommit={(value) => updatePage(page.id, { socialImage: value })}
        />
      </Field>

      <div className="pg__sections">
        <span className="pg__eyebrow">
          {sections.length} {sections.length === 1 ? 'section' : 'sections'}
        </span>
        {sections.length ? (
          <ul className="pg__list">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="pg__item"
                  onClick={() => select(section.id)}
                  onPointerEnter={() => setHover(section.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  <Icon path="M3 5h18v5H3zM3 14h18v5H3z" size={13} />
                  <span>{section.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pg__hint">
            This page is empty.{' '}
            <button type="button" className="pg__link" onClick={() => setLeftPanel('insert')}>
              Add a section
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
}
