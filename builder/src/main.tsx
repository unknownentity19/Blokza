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
import { TEMPLATES } from './registry/templates';
import { PALETTES } from './registry/palettes';

// Development handle for driving the editor from the console (and from the
// browser-automation checks used while building it). Never shipped: Vite strips
// the branch from the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__altask = { useEditor, TEMPLATES, PALETTES };
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from the document');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
