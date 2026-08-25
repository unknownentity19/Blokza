/**
 * Site-level settings, plus the project file in/out.
 *
 * Import and export of the project JSON is the answer to "everything is in
 * localStorage": one file the user owns, that moves between browsers and
 * machines and can be checked into a repo.
 */

import { useRef } from 'react';
import { Collapsible, Field, Icon } from '../common';
import { useEditor } from '../../store/editor';
import { TextControl } from '../inspector/controls';
import { parseProject, serialiseProject, STORAGE_KEY } from '../../core/storage';
import { slugify } from '../../core/ids';
import { download } from '../../core/download';

export function SettingsPanel() {
  const doc = useEditor((s) => s.doc);
  const setSiteName = useEditor((s) => s.setSiteName);
  const setSiteUrl = useEditor((s) => s.setSiteUrl);
  const replaceDoc = useEditor((s) => s.replaceDoc);
  const resetDoc = useEditor((s) => s.resetDoc);
  const toast = useEditor((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const result = parseProject(text);
    if ('error' in result) {
      toast(result.error, 'error');
      return;
    }
    replaceDoc(result.doc, `Opened “${result.doc.name}”`);
  };

  return (
    <div className="ui-panel">
      <header className="ui-panel__head">
        <h2>Settings</h2>
      </header>

      <div className="ui-panel__scroll">
        <Collapsible title="Site" id="set-site">
          <Field label="Name">
            <TextControl value={doc.name} onCommit={setSiteName} />
          </Field>
          <Field label="URL" hint="Used for canonical tags, og:url and the sitemap.">
            <TextControl value={doc.siteUrl} placeholder="https://example.com" onCommit={setSiteUrl} />
          </Field>
        </Collapsible>

        <Collapsible title="Project file" id="set-project">
          <p className="ui-field__hint">
            Your work is saved in this browser automatically. Download the project file to move it
            somewhere else or keep a backup.
          </p>
          <div className="ui-btnrow">
            <button
              type="button"
              className="ui-btn"
              onClick={() =>
                download(
                  `${slugify(doc.name, 'site')}.saaswise.json`,
                  serialiseProject(doc),
                  'application/json',
                )
              }
            >
              <Icon path="M12 3v12M7 10l5 5 5-5M4 21h16" size={14} /> Download project
            </button>
            <button type="button" className="ui-btn" onClick={() => fileRef.current?.click()}>
              <Icon path="M12 21V9M7 14l5-5 5 5M4 3h16" size={14} /> Open project
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.target.value = '';
            }}
          />
        </Collapsible>

        <Collapsible title="Storage" id="set-storage" defaultOpen={false}>
          <Field label="Saved as" hint="Key used in this browser's local storage.">
            <code className="ui-code">{STORAGE_KEY}</code>
          </Field>
          <div className="ui-btnrow">
            <button
              type="button"
              className="ui-btn is-danger"
              onClick={() => {
                // Undoable, so this is a recoverable mistake rather than a cliff.
                resetDoc();
              }}
            >
              <Icon path="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" size={14} /> Start over
            </button>
          </div>
          <p className="ui-field__hint">
            Starting over replaces the document with a blank page. It goes on the undo stack, so ⌘Z
            brings your work back.
          </p>
        </Collapsible>
      </div>
    </div>
  );
}
