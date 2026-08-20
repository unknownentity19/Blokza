/**
 * Pages, and the per-page SEO metadata the export needs.
 *
 * A single-page builder is a toy; the moment there are two pages, internal links
 * have to resolve, which is why the `link` field offers page paths and the export
 * rewrites them to real filenames.
 */

import { Collapsible, Field, Icon, IconButton } from '../common';
import { useEditor } from '../../store/editor';
import { TextControl } from '../inspector/controls';
import { pageFileName } from '../../render/RenderNode';
import { countSharedInstances, sharedList } from '../../core/doc';

export function PagesPanel() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectPage = useEditor((s) => s.selectPage);
  const addPage = useEditor((s) => s.addPage);
  const updatePage = useEditor((s) => s.updatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const movePage = useEditor((s) => s.movePage);
  const addSharedToPage = useEditor((s) => s.addSharedToPage);
  const removeSharedEverywhere = useEditor((s) => s.removeSharedEverywhere);

  const page = doc.pages.find((candidate) => candidate.id === currentPageId) ?? doc.pages[0];
  const shared = sharedList(doc);
  const usedOnCurrentPage = new Set(
    doc.nodes[page.rootId].children
      .map((id) => doc.nodes[id])
      .filter((node) => node?.type === 'shared')
      .map((node) => node.props.sharedId as string),
  );

  return (
    <div className="ui-panel">
      <header className="ui-panel__head">
        <h2>Pages</h2>
        <button type="button" className="ui-minibtn" onClick={addPage}>
          <Icon path="M12 5v14M5 12h14" size={13} strokeWidth={2} /> New
        </button>
      </header>

      <div className="ui-panel__scroll">
        <div className="ui-pagelist">
          {doc.pages.map((candidate, index) => (
            <div
              key={candidate.id}
              className={`ui-pagerow ${candidate.id === currentPageId ? 'is-on' : ''}`}
            >
              <button type="button" className="ui-pagerow__main" onClick={() => selectPage(candidate.id)}>
                <Icon
                  path={
                    candidate.path === '/'
                      ? 'M3 11l9-8 9 8M5 10v10h14V10'
                      : 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5'
                  }
                  size={14}
                />
                <span className="ui-pagerow__name">{candidate.name}</span>
                <code>{candidate.path}</code>
              </button>
              <span className="ui-pagerow__actions">
                <IconButton
                  icon="M12 19V5M5 12l7-7 7 7"
                  label="Move up"
                  size={12}
                  disabled={index === 0}
                  onClick={() => movePage(candidate.id, index - 1)}
                />
                <IconButton
                  icon="M8 8h12v12H8zM4 16V4h12"
                  label="Duplicate page"
                  size={12}
                  onClick={() => duplicatePage(candidate.id)}
                />
                <IconButton
                  icon="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
                  label="Delete page"
                  size={12}
                  disabled={doc.pages.length <= 1}
                  onClick={() => deletePage(candidate.id)}
                />
              </span>
            </div>
          ))}
        </div>

        {shared.length ? (
          <Collapsible title="Shared sections" id="page-shared">
            <p className="ui-field__hint">
              One copy, used on the pages you add it to. Editing it anywhere changes
              it everywhere.
            </p>
            <div className="ui-sharedlist">
              {shared.map((entry) => {
                const onThisPage = usedOnCurrentPage.has(entry.id);
                return (
                  <div className="ui-sharedrow" key={entry.id}>
                    <span className="ui-sharedrow__name" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="ui-sharedrow__count">
                      {countSharedInstances(doc, entry.id)}×
                    </span>
                    {onThisPage ? (
                      <span className="ui-sharedrow__on">on this page</span>
                    ) : (
                      <button
                        type="button"
                        className="ui-minibtn"
                        onClick={() => addSharedToPage(entry.id)}
                      >
                        Add here
                      </button>
                    )}
                    <IconButton
                      icon="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
                      label={`Remove ${entry.name} from every page`}
                      size={12}
                      onClick={() => removeSharedEverywhere(entry.id)}
                    />
                  </div>
                );
              })}
            </div>
          </Collapsible>
        ) : null}

        <Collapsible title="Page settings" id="page-settings">
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
          <Field label="Title" hint="The <title> tag and the default social title.">
            <TextControl
              value={page.title}
              placeholder={page.name}
              onCommit={(value) => updatePage(page.id, { title: value })}
            />
          </Field>
          <Field label="Description" hint="Meta description. Aim for 150 characters." wide>
            <TextControl
              multiline
              rows={3}
              value={page.description}
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
        </Collapsible>
      </div>
    </div>
  );
}
