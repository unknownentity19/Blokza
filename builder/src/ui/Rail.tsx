/**
 * Left icon rail: switches the side panel, and toggles it closed when the same
 * icon is pressed again (so the canvas can have the full width).
 */

import { Icon } from './common';
import { useEditor } from '../store/editor';
import type { LeftPanelId } from '../core/types';

const ITEMS: { id: LeftPanelId; label: string; icon: string }[] = [
  { id: 'insert', label: 'Insert', icon: 'M12 5v14M5 12h14' },
  { id: 'layers', label: 'Layers', icon: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5' },
  { id: 'pages', label: 'Pages', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5' },
  { id: 'theme', label: 'Theme', icon: 'M12 3a9 9 0 1 0 0 18 3 3 0 0 0 0-6 3 3 0 0 1 0-6 3 3 0 0 0 0-6zM7 9h.01M7 15h.01M12 7h.01' },
  { id: 'settings', label: 'Settings', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

export function Rail({ onHelp }: { onHelp: () => void }) {
  const panel = useEditor((s) => s.leftPanel);
  const setPanel = useEditor((s) => s.setLeftPanel);

  return (
    <nav className="rail" aria-label="Editor panels">
      <a className="rail__brand" href="/" title="Altask">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M9 22.5L16 9.5l7 13" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Altask home</span>
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
