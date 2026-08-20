/**
 * Global keyboard shortcuts.
 *
 * The guard matters more than the list: a shortcut that fires while the user is
 * typing in an inspector field — deleting the selected element when they meant to
 * delete a character — is worse than having no shortcut at all. So every binding
 * is skipped when focus is in a text field, and the canvas's inline editor is
 * treated the same way.
 */

import { useEffect } from 'react';
import { useEditor } from '../store/editor';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export function useKeyboard(onHelp: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useEditor.getState();
      const mod = event.metaKey || event.ctrlKey;

      // The canvas's inline editor lives in the iframe, so it never reaches this
      // handler; the store flag covers the case where focus was moved manually.
      if (state.editing) return;
      if (isTypingTarget(event.target)) {
        // Undo/redo still work inside fields, but the browser's own text undo
        // should win there, so they are deliberately not intercepted.
        return;
      }

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        state.duplicate();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        state.copy();
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        state.paste();
        return;
      }
      if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        state.setPreview(!state.previewOpen);
        return;
      }

      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          if (state.selectedId) {
            event.preventDefault();
            state.remove();
          }
          break;
        case 'Escape':
          if (state.previewOpen) state.setPreview(false);
          else if (state.selectedId) state.select(null);
          break;
        case 'Enter':
          // Enter steps into the selection, matching how nested selection works
          // in every design tool: Enter goes down, Escape/Backspace goes up.
          if (state.selectedId) {
            const child = state.doc.nodes[state.selectedId]?.children[0];
            if (child) {
              event.preventDefault();
              state.select(child);
            }
          }
          break;
        case 'ArrowUp':
          if (state.selectedId && event.altKey) {
            event.preventDefault();
            state.reorderSibling(state.selectedId, -1);
          } else if (state.selectedId && event.shiftKey) {
            event.preventDefault();
            state.selectParent();
          }
          break;
        case 'ArrowDown':
          if (state.selectedId && event.altKey) {
            event.preventDefault();
            state.reorderSibling(state.selectedId, 1);
          }
          break;
        case '?':
          onHelp();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onHelp]);
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '⌘Z / ⌘⇧Z', action: 'Undo / redo' },
  { keys: '⌘D', action: 'Duplicate selection' },
  { keys: '⌘C / ⌘V', action: 'Copy / paste element' },
  { keys: '⌫', action: 'Delete selection' },
  { keys: 'Esc', action: 'Discard the edit, deselect, or close preview' },
  { keys: 'Enter', action: 'Select first child' },
  { keys: '⇧↑', action: 'Select parent' },
  { keys: '⌥↑ / ⌥↓', action: 'Move within its parent' },
  { keys: '⌘P', action: 'Toggle preview' },
  { keys: 'Click', action: 'Select, and edit text in place' },
  { keys: 'Double-click', action: 'Select all the text in a slot' },
  { keys: '⌘ + scroll', action: 'Zoom the canvas' },
  { keys: 'Drag the dot', action: 'On a site-map card, wire it to another page' },
  { keys: '?', action: 'This list' },
];
