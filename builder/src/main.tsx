/**
 * Entry point.
 *
 * The registry import must come before anything renders — component definitions
 * are registered as a side effect of importing it, and the store's initial
 * `load()` needs them to migrate a legacy document.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './registry';
import './styles/app.css';
import { App } from './ui/App';
import { useEditor } from './store/editor';
import { startCloudSync } from './store/account';
import { TEMPLATES } from './registry/templates';
import { PALETTES } from './registry/palettes';

// Development handle for driving the editor from the console (and from the
// browser-automation checks used while building it). Never shipped: Vite strips
// the branch from the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cilbs = { useEditor, TEMPLATES, PALETTES };

  // `?seed=demo` rebuilds a seven-page site through the ordinary editor
  // actions, so the UI can be reviewed and screenshotted at a realistic size
  // instead of on the three-section page that hides every interesting bug.
  const params = new URLSearchParams(window.location.search);
  if (params.get('seed') === 'demo') {
    const select = params.get('select') === 'section' ? 'section' : undefined;
    void import('./dev/seedDemo').then(({ seedDemo }) => seedDemo(select ? { select } : {}));
  }
}

// Only does anything once a site is bound to an account; otherwise it is a
// single comparison per edit.
startCloudSync();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from the document');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
