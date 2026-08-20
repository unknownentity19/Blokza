/**
 * Shared editor-chrome primitives.
 *
 * Deliberately small and unstyled-by-prop: everything is driven by classes in
 * `styles/app.css`, so the whole editor can be re-themed in one file.
 */

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useEditor } from '../store/editor';
import { FieldIdContext } from './fieldContext';

export function Icon({ path, size = 18, strokeWidth = 1.7 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export interface IconButtonProps {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
  /** Extra hint appended to the tooltip, e.g. a shortcut. */
  hint?: string;
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  size = 18,
  className = '',
  hint,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`ui-iconbtn ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={hint ? `${label} · ${hint}` : label}
    >
      <Icon path={icon} size={size} />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  compact,
}: {
  value: T | undefined;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <div className={`ui-seg ${compact ? 'is-compact' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`ui-seg__btn ${value === option.value ? 'is-on' : ''}`}
          onClick={() => onChange(option.value)}
          title={option.title ?? option.label}
          aria-label={option.title ?? option.label}
          aria-pressed={value === option.value}
        >
          {option.icon ? <Icon path={option.icon} size={15} /> : option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Collapsible inspector/panel section.
 *
 * Open state is keyed and kept in `sessionStorage` so a section the user closed
 * stays closed while they work, without leaking into the saved document.
 */
export function Collapsible({
  title,
  id,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  id: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const storageKey = `altask:section:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === '1';
    } catch {
      return defaultOpen;
    }
  });

  const toggle = useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      try {
        sessionStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      return next;
    });
  }, [storageKey]);

  return (
    <section className={`ui-section ${open ? 'is-open' : ''}`}>
      <div className="ui-section__head">
        <button type="button" className="ui-section__toggle" onClick={toggle} aria-expanded={open}>
          <Icon path="M9 6l6 6-6 6" size={13} strokeWidth={2} />
          <span>{title}</span>
        </button>
        {right ? <div className="ui-section__right">{right}</div> : null}
      </div>
      {open ? <div className="ui-section__body">{children}</div> : null}
    </section>
  );
}

/** Label + control row. `hint` renders under the control. */
export function Field({
  label,
  children,
  hint,
  wide,
}: {
  label?: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`ui-field ${wide ? 'is-wide' : ''}`}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="ui-field__control">
        <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      </div>
      {hint ? <p className="ui-field__hint">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: string }) {
  return (
    <div className="ui-empty">
      {icon ? <Icon path={icon} size={22} /> : null}
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

/** Toast stack. Auto-dismisses; errors linger longer than confirmations. */
export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.id), toast.kind === 'error' ? 7000 : 5000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`ui-toast is-${toast.kind}`}
          onClick={() => dismiss(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="ui-modal__scrim" onClick={onClose} aria-label="Close" />
      <div className={`ui-modal__box ${wide ? 'is-wide' : ''}`}>
        <header className="ui-modal__head">
          <h2>{title}</h2>
          <IconButton icon="M6 6l12 12M18 6L6 18" label="Close" onClick={onClose} size={16} />
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer ? <footer className="ui-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
