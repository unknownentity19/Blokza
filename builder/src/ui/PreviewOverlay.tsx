/**
 * Full-screen preview.
 *
 * Renders the *export* output, not the canvas: a single self-contained HTML
 * document with the stylesheet inlined, loaded via `srcDoc`. That makes the
 * preview a genuine check on what publishing will produce — if a style only
 * works because of editor chrome, this is where it shows.
 */

import { useEffect, useState } from 'react';
import { Icon, IconButton, Segmented } from './common';
import { useEditor } from '../store/editor';
import { DEVICES, deviceById } from '../core/devices';
import type { DeviceId } from '../core/types';

export function PreviewOverlay() {
  const open = useEditor((s) => s.previewOpen);
  const setPreview = useEditor((s) => s.setPreview);
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectPage = useEditor((s) => s.selectPage);
  const editorDevice = useEditor((s) => s.device);

  const [device, setDevice] = useState<DeviceId>(editorDevice);
  useEffect(() => {
    if (open) setDevice(editorDevice);
  }, [open, editorDevice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setPreview]);

  // Built asynchronously because the renderer is a lazy chunk. `stale` keeps the
  // previous frame on screen while a rebuild is in flight, so editing with the
  // preview open does not flash white on every keystroke.
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (!open) {
      setHtml('');
      return;
    }
    let cancelled = false;
    void import('../core/export').then(({ buildStandalonePage }) => {
      if (!cancelled) setHtml(buildStandalonePage(doc, currentPageId));
    });
    return () => {
      cancelled = true;
    };
  }, [open, doc, currentPageId]);

  if (!open) return null;
  const preset = deviceById(device);
  const full = device === 'desktop';

  return (
    <div className="pv" role="dialog" aria-modal="true" aria-label="Preview">
      <header className="pv__bar">
        <div className="pv__left">
          <strong>Preview</strong>
          <select
            className="ui-input ui-select"
            value={currentPageId}
            onChange={(event) => selectPage(event.target.value)}
            aria-label="Page"
          >
            {doc.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
          </select>
        </div>

        <Segmented<DeviceId>
          value={device}
          ariaLabel="Preview width"
          options={DEVICES.map((item) => ({
            value: item.id,
            label: item.label,
            icon: item.icon,
            title: `${item.label} · ${item.width}px`,
          }))}
          onChange={setDevice}
        />

        <div className="pv__right">
          <span className="pv__note">
            <Icon path="M12 8v4M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" size={13} />
            Exported output
          </span>
          <IconButton icon="M6 6l12 12M18 6L6 18" label="Close preview" onClick={() => setPreview(false)} />
        </div>
      </header>

      <div className="pv__stage">
        <iframe
          key={`${device}-${currentPageId}`}
          className="pv__frame"
          title="Preview"
          srcDoc={html || '<!doctype html><title>Loading</title>'}
          style={full ? undefined : { width: `${preset.width}px`, maxWidth: '100%' }}
          sandbox="allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
