/**
 * CSS shared by more than one component type.
 *
 * `compileCss` de-duplicates component chunks by content, so a constant listed
 * on several definitions is emitted once. That is what lets a form with a
 * submit button but no link button still get the button styles.
 */

export const BUTTON_CSS = `.c-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 13px 24px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.c-button svg { width: 1.1em; height: 1.1em; flex: none; }
.c-button--primary { background-color: var(--color-brand); color: var(--color-brand-ink, #ffffff); }
.c-button--primary:hover { background-color: var(--color-brand-dark); color: var(--color-brand-ink, #ffffff); }
.c-button--secondary { background-color: transparent; border-color: var(--color-line); color: var(--color-ink); }
.c-button--secondary:hover { border-color: var(--color-brand); color: var(--color-brand); }
.c-button--ghost { background-color: var(--color-brand-soft); color: var(--color-brand-dark); }
.c-button--ghost:hover { background-color: var(--color-brand); color: var(--color-brand-ink, #ffffff); }
.c-button--link { padding: 0; background: none; color: var(--color-brand); text-decoration: underline; text-underline-offset: 3px; }`;

export const FORM_CONTROL_CSS = `.c-input label, .c-textarea label, .c-select label, .c-checkbox label { display: block; font-size: 14px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }
.c-input input, .c-textarea textarea, .c-select select {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius);
  background: var(--color-surface);
  font-size: 15px;
  color: var(--color-ink);
}
.c-input input:focus, .c-textarea textarea:focus, .c-select select:focus { outline: 2px solid var(--color-brand); outline-offset: 1px; }
.c-input input::placeholder, .c-textarea textarea::placeholder { color: var(--color-muted); opacity: 0.7; }
.c-textarea textarea { resize: vertical; min-height: 120px; }
.c-checkbox { display: flex; align-items: flex-start; gap: 10px; }
.c-checkbox input { width: 18px; height: 18px; margin: 2px 0 0; flex: none; accent-color: var(--color-brand); }
.c-checkbox label { margin: 0; font-weight: 500; color: var(--color-muted); }`;
