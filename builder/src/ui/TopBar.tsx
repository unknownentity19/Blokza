/**
 * Top bar: project identity, device and zoom, history, publish.
 */

import { useState } from 'react';
import { Icon, IconButton, Segmented } from './common';
import { useEditor } from '../store/editor';
import { DEVICES, ZOOM_STEPS, deviceById } from '../core/devices';
import type { DeviceId, ViewId } from '../core/types';

export function TopBar() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectPage = useEditor((s) => s.selectPage);
  const setSiteName = useEditor((s) => s.setSiteName);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const device = useEditor((s) => s.device);
  const setDevice = useEditor((s) => s.setDevice);
  const zoom = useEditor((s) => s.zoom);
  const zoomToFit = useEditor((s) => s.zoomToFit);
  const setZoom = useEditor((s) => s.setZoom);
  const setZoomToFit = useEditor((s) => s.setZoomToFit);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const setPreview = useEditor((s) => s.setPreview);
  const toast = useEditor((s) => s.toast);

  const [publishing, setPublishing] = useState(false);
  const preset = deviceById(device);

  const publish = async () => {
    setPublishing(true);
    try {
      // Loaded on demand: the export pulls in JSZip and React's server renderer,
      // neither of which should delay the editor's first paint.
      const { downloadSiteZip } = await import('../core/zip');
      const result = await downloadSiteZip(doc);
      toast(`Exported ${result.files} files (${formatBytes(result.bytes)}) to ${result.filename}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed', 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <header className="tb">
      <div className="tb__left">
        <a className="tb__back" href="/" title="Back to cilbs.dev">
          <Icon path="M15 6l-6 6 6 6" size={16} strokeWidth={2} />
        </a>
        <div className="tb__id">
          <input
            className="tb__name"
            value={doc.name}
            onChange={(event) => setSiteName(event.target.value)}
            aria-label="Project name"
            spellCheck={false}
          />
          <select
            className="tb__page"
            value={currentPageId}
            onChange={(event) => selectPage(event.target.value)}
            aria-label="Current page"
          >
            {doc.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name} · {page.path}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tb__center">
        <Segmented<ViewId>
          value={view}
          ariaLabel="Workspace"
          options={[
            { value: 'design', label: 'Design', title: 'Design the current page' },
            { value: 'flow', label: 'Site map', title: 'Arrange pages and the links between them' },
          ]}
          onChange={setView}
        />

        {view === 'flow' ? null : (
        <Segmented<DeviceId>
          value={device}
          ariaLabel="Device preview"
          options={DEVICES.map((item) => ({
            value: item.id,
            label: item.label,
            icon: item.icon,
            title: `${item.label} · ${item.width}px`,
          }))}
          onChange={setDevice}
        />
        )}

        {view === 'flow' ? null : (
        <div className="tb__zoom">
          <span className="tb__zoomw">{preset.width}px</span>
          <IconButton
            icon="M5 12h14"
            label="Zoom out"
            size={14}
            onClick={() => useEditor.getState().stepZoom(-1)}
          />
          <select
            className="tb__zoomsel"
            value={zoomToFit ? 'fit' : String(zoom)}
            aria-label="Zoom level"
            onChange={(event) => {
              if (event.target.value === 'fit') setZoomToFit(true);
              else setZoom(Number(event.target.value));
            }}
          >
            <option value="fit">Fit</option>
            {ZOOM_STEPS.map((step) => (
              <option key={step} value={step}>
                {Math.round(step * 100)}%
              </option>
            ))}
          </select>
          <IconButton
            icon="M12 5v14M5 12h14"
            label="Zoom in"
            size={14}
            onClick={() => useEditor.getState().stepZoom(1)}
          />
        </div>
        )}
      </div>

      <div className="tb__right">
        <IconButton
          icon="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"
          label="Undo"
          hint="⌘Z"
          size={16}
          disabled={!canUndo}
          onClick={undo}
        />
        <IconButton
          icon="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"
          label="Redo"
          hint="⌘⇧Z"
          size={16}
          disabled={!canRedo}
          onClick={redo}
        />
        <span className="tb__sep" />
        <button type="button" className="tb__ghost" onClick={() => setPreview(true)}>
          <Icon path="M6 4l14 8-14 8z" size={13} /> Preview
        </button>
        <button type="button" className="tb__publish" onClick={publish} disabled={publishing}>
          {publishing ? 'Packaging…' : 'Publish'}
        </button>
      </div>
    </header>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
