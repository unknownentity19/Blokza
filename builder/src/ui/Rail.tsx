/**
 * Left icon rail: switches the side panel, and toggles it closed when the same
 * icon is pressed again (so the canvas can have the full width).
 */

import { Icon } from './common';
import { useEditor } from '../store/editor';
import type { LeftPanelId } from '../core/types';

// Imported rather than written as a path so Vite emits it into the bundle's
// own assets folder with a content hash. A literal `/assets/...` would break
// the editor opened from disk, which is the whole reason `base` is relative.
import brandGlyph from '../../../assets/images/brand-glyph.png';

const ITEMS: { id: LeftPanelId; label: string; icon: string }[] = [
  { id: 'insert', label: 'Insert', icon: 'M5 12h14M12 5v14' },
  { id: 'layers', label: 'Layers', icon: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
  { id: 'pages', label: 'Pages', icon: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5' },
  { id: 'theme', label: 'Theme', icon: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8zM13 6.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M17 10.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M6 12.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0M8 7.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0' },
  { id: 'cloud', label: 'Cloud', icon: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' },
  { id: 'settings', label: 'Settings', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

export function Rail({ onHelp }: { onHelp: () => void }) {
  const panel = useEditor((s) => s.leftPanel);
  const setPanel = useEditor((s) => s.setLeftPanel);

  return (
    <nav className="rail" aria-label="Editor panels">
      <a className="rail__brand" href="/" title="BLOKZA">
        {/* The same mark the marketing nav carries, at the same height. What
            used to sit here was a tiled chevron identical to the one the demo
            templates give their fictional brands — the editor was wearing one
            of its own sample sites' logos. */}
        <img src={brandGlyph} width={22} height={28} alt="" />
        <span className="sr-only">BLOKZA home</span>
      </a>

      <div className="rail__group">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail__btn ${panel === item.id ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === item.id ? null : item.id)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={panel === item.id}
          >
            <Icon path={item.icon} size={19} />
          </button>
        ))}
      </div>

      <div className="rail__bottom">
        <button type="button" className="rail__btn" onClick={onHelp} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
          <Icon path="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17h.01" size={19} />
        </button>
      </div>
    </nav>
  );
}
