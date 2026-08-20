/**
 * Inspector input controls.
 *
 * Three behaviours are shared by all of them, because they are what makes an
 * inspector feel solid rather than fighty:
 *
 *  1. **Local draft state while focused.** The input keeps its own value until
 *     blur or Enter, so the store re-rendering the canvas mid-keystroke can
 *     never yank the caret or reformat what is being typed.
 *  2. **Coalesced history.** Typing produces one undo step, not one per key.
 *  3. **Inherited values as placeholders.** An empty field shows what the node
 *     inherits from a wider breakpoint, so nothing is ever a mystery.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../common';
import { useFieldId } from '../fieldContext';
import { LENGTH_UNITS } from './units';
import type { FieldOption, StyleKey } from '../../core/types';
import type { StyleAccess } from './useStyle';

/* ------------------------------------------------------------------ */
/* Text                                                               */
/* ------------------------------------------------------------------ */

export interface TextControlProps {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  /** Called on every keystroke, for props that should update live. */
  onInput?: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  monospace?: boolean;
  disabled?: boolean;
  /**
   * Render as a password field.
   *
   * Also sets the autocomplete hint, so a password manager offers to fill and
   * save it rather than treating the field as an ordinary text box.
   */
  password?: boolean;
  autoComplete?: string;
}

export function TextControl({
  value,
  placeholder,
  onCommit,
  onInput,
  multiline,
  rows = 3,
  monospace,
  disabled,
  password,
  autoComplete,
}: TextControlProps) {
  const id = useFieldId();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  // Adopt external changes only while unfocused, so an edit in progress wins.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focused.current = false;
    if (draft !== value) onCommit(draft);
  };

  const shared = {
    id,
    className: `ui-input ${monospace ? 'is-mono' : ''}`,
    value: draft,
    placeholder,
    disabled,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: commit,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      onInput?.(event.target.value);
    },
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={rows}
        onKeyDown={(event) => {
          // Enter inserts a newline here; Escape reverts.
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <input
      {...shared}
      type={password ? 'password' : 'text'}
      autoComplete={autoComplete ?? (password ? 'current-password' : undefined)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Number + unit                                                      */
/* ------------------------------------------------------------------ */

const NUMBER_UNIT = /^(-?\d*\.?\d+)\s*(px|%|rem|em|vw|vh|ch|fr|deg|s|ms)?$/i;
/** Values that are keywords rather than measurements. */
const KEYWORDS = new Set(['auto', 'none', 'inherit', 'initial', 'unset', 'fit-content', 'max-content', 'min-content']);

export interface LengthControlProps {
  value: string | undefined;
  /** Inherited value, shown as the placeholder when `value` is unset. */
  inherited?: string | undefined;
  units?: string[];
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: string | null, coalesce?: boolean) => void;
  /** Prefix glyph, e.g. the side letter in the spacing box. */
  affix?: ReactNode;
  compact?: boolean;
  /**
   * Hide the unit dropdown and edit the whole value as text (`24px`, `5%`,
   * `auto`). Used where there is no room for a select — the spacing box — without
   * giving up any expressiveness, since the unit is just typed.
   */
  hideUnit?: boolean;
  /** Accessible name, needed when there is no visible label. */
  ariaLabel?: string;
}

/**
 * A measurement field.
 *
 * Anything it cannot parse as `<number><unit>` — `calc(...)`, `var(--x)`,
 * `clamp(...)` — is kept as free text rather than destroyed, because those are
 * exactly the values a competent user reaches for and silently mangling them
 * would be worse than not offering the field at all.
 */
export function LengthControl({
  value,
  inherited,
  units = LENGTH_UNITS,
  min,
  max,
  step = 1,
  onCommit,
  affix,
  compact,
  hideUnit,
  ariaLabel,
}: LengthControlProps) {
  const id = useFieldId();
  const raw = value ?? '';
  const parsed = NUMBER_UNIT.exec(raw.trim());
  const isKeyword = KEYWORDS.has(raw.trim());
  const freeform = raw !== '' && !parsed && !isKeyword;

  const [draft, setDraft] = useState(raw);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(raw);
  }, [raw]);

  const unit = parsed?.[2] ?? (isKeyword ? raw.trim() : units[0]);
  const numberPart = parsed ? parsed[1] : '';

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };

  const commitNumber = (next: string, coalesce = false) => {
    const trimmed = next.trim();
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    if (KEYWORDS.has(trimmed)) {
      onCommit(trimmed, coalesce);
      return;
    }
    const asNumber = Number(trimmed);
    if (!Number.isFinite(asNumber)) {
      // Not a number and not a keyword: leave the stored value alone and snap
      // the field back, rather than writing something that will not parse.
      setDraft(raw);
      return;
    }
    onCommit(`${clamp(asNumber)}${unit === 'auto' ? 'px' : unit}`, coalesce);
  };

  /* Scrub: dragging the affix changes the value, like every design tool. */
  const scrub = useRef<{ startX: number; startValue: number } | null>(null);
  const onScrubDown = (event: React.PointerEvent) => {
    if (freeform || isKeyword) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scrub.current = { startX: event.clientX, startValue: Number(numberPart || 0) };
  };
  const onScrubMove = (event: React.PointerEvent) => {
    if (!scrub.current) return;
    const delta = Math.round((event.clientX - scrub.current.startX) / 2) * step;
    const next = clamp(scrub.current.startValue + delta);
    setDraft(String(next));
    onCommit(`${next}${unit === 'auto' ? 'px' : unit}`, true);
  };
  const onScrubUp = (event: React.PointerEvent) => {
    if (scrub.current) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    scrub.current = null;
  };

  if (hideUnit) {
    const commitRaw = (next: string) => {
      const trimmed = next.trim();
      if (trimmed === '') {
        onCommit(null);
        return;
      }
      if (KEYWORDS.has(trimmed)) {
        onCommit(trimmed);
        return;
      }
      // A bare number keeps whatever unit was already there (px by default), so
      // typing "32" over "24px" does the obvious thing.
      const bare = Number(trimmed);
      if (Number.isFinite(bare)) {
        onCommit(`${clamp(bare)}${unit === 'auto' ? 'px' : unit}`);
        return;
      }
      const withUnit = NUMBER_UNIT.exec(trimmed);
      if (withUnit) {
        onCommit(`${clamp(Number(withUnit[1]))}${withUnit[2] ?? 'px'}`);
        return;
      }
      // calc(), var(), clamp(): pass through untouched.
      onCommit(trimmed);
    };

    return (
      <div className={`ui-len is-bare ${compact ? 'is-compact' : ''}`}>
        <input
          id={id}
          className="ui-input ui-len__num"
          value={draft}
          placeholder={inherited ?? '0'}
          aria-label={ariaLabel}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (draft !== raw) commitRaw(draft);
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitRaw(draft);
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(raw);
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              const current = NUMBER_UNIT.exec(draft.trim());
              if (!current) return;
              event.preventDefault();
              const amount = (event.shiftKey ? 10 : 1) * step * (event.key === 'ArrowUp' ? 1 : -1);
              const next = clamp(Number(current[1]) + amount);
              const nextUnit = current[2] ?? 'px';
              setDraft(`${next}${nextUnit}`);
              onCommit(`${next}${nextUnit}`, true);
            }
          }}
        />
      </div>
    );
  }

  if (freeform) {
    return (
      <div className={`ui-len is-free ${compact ? 'is-compact' : ''}`}>
        <input
          id={id}
          className="ui-input is-mono"
          value={draft}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (draft !== raw) onCommit(draft.trim() === '' ? null : draft.trim());
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" className="ui-len__clear" onClick={() => onCommit(null)} title="Clear">
          <Icon path="M6 6l12 12M18 6L6 18" size={12} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className={`ui-len ${compact ? 'is-compact' : ''}`}>
      {affix ? (
        <span
          className="ui-len__affix"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          title="Drag to change"
        >
          {affix}
        </span>
      ) : null}
      <input
        id={id}
        className="ui-input ui-len__num"
        value={isKeyword ? '' : draft}
        placeholder={isKeyword ? unit : (inherited ?? '')}
        inputMode="decimal"
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commitNumber(draft);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitNumber(draft);
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(raw);
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const base = Number(draft === '' ? (numberPart || 0) : draft);
            if (!Number.isFinite(base)) return;
            const amount = (event.shiftKey ? 10 : 1) * step * (event.key === 'ArrowUp' ? 1 : -1);
            const next = clamp(base + amount);
            setDraft(String(next));
            onCommit(`${next}${unit === 'auto' ? 'px' : unit}`, true);
          }
        }}
      />
      <select
        className="ui-len__unit"
        value={unit}
        aria-label="Unit"
        onChange={(event) => {
          const nextUnit = event.target.value;
          if (KEYWORDS.has(nextUnit)) onCommit(nextUnit);
          else if (numberPart || draft) onCommit(`${clamp(Number(draft || numberPart || 0))}${nextUnit}`);
          else onCommit(`0${nextUnit}`);
        }}
      >
        {units.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Select / toggle / colour                                           */
/* ------------------------------------------------------------------ */

export function SelectControl({
  value,
  options,
  onCommit,
  placeholder,
  allowEmpty = true,
  emptyLabel = 'Not set',
}: {
  value: string | undefined;
  options: FieldOption[];
  onCommit: (value: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const id = useFieldId();
  /*
   * The placeholder usually carries the *inherited* value, which is raw CSS —
   * `row`, `flex-start`, `cover`. Showing it verbatim next to friendly option
   * labels produced menus like "row / Across / Down". Prefer this option set's
   * own label for that value, and only fall back to the raw string.
   */
  const placeholderLabel =
    placeholder === undefined
      ? emptyLabel
      : (options.find((option) => option.value === placeholder)?.label ?? placeholder);
  return (
    <select
      id={id}
      className="ui-input ui-select"
      value={value ?? ''}
      onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
    >
      {allowEmpty ? <option value="">{placeholderLabel}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ToggleControl({
  value,
  onCommit,
  label,
}: {
  value: boolean;
  onCommit: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`ui-toggle ${value ? 'is-on' : ''}`}
      onClick={() => onCommit(!value)}
      role="switch"
      aria-checked={value}
      aria-label={label}
    >
      <span className="ui-toggle__dot" />
    </button>
  );
}

/**
 * Colour field.
 *
 * The text side accepts anything CSS does — hex, `rgb()`, and crucially
 * `var(--color-brand)` — while the swatch offers the theme tokens first. Editing
 * a token from the theme panel then updates every element using it, which is the
 * whole reason tokens exist.
 */
export function ColorControl({
  value,
  inherited,
  tokens,
  onCommit,
}: {
  value: string | undefined;
  inherited?: string;
  tokens: { name: string; value: string }[];
  onCommit: (value: string | null, coalesce?: boolean) => void;
}) {
  const id = useFieldId();
  const raw = value ?? '';
  const [draft, setDraft] = useState(raw);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(raw);
  }, [raw]);

  const tokenMatch = /^var\(--color-([a-z0-9-]+)\)$/i.exec(raw.trim());
  const resolved = tokenMatch
    ? tokens.find((token) => token.name === tokenMatch[1])?.value ?? '#000000'
    : raw.trim();
  // <input type="color"> only accepts #rrggbb, so anything else falls back.
  const pickerValue = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : '#7a5fe5';

  return (
    <div className="ui-color">
      <span className="ui-color__swatch" style={{ background: resolved || 'transparent' }}>
        <input
          type="color"
          value={pickerValue}
          aria-label="Pick colour"
          onChange={(event) => onCommit(event.target.value, true)}
        />
      </span>
      <input
        id={id}
        className="ui-input is-mono"
        value={draft}
        placeholder={inherited ?? 'inherit'}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          const next = draft.trim();
          if (next !== raw) onCommit(next === '' ? null : next);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(raw);
            event.currentTarget.blur();
          }
        }}
      />
      <select
        className="ui-color__tokens"
        value={tokenMatch ? tokenMatch[1] : ''}
        aria-label="Theme colour"
        onChange={(event) =>
          onCommit(event.target.value ? `var(--color-${event.target.value})` : null)
        }
      >
        <option value="">Custom</option>
        {tokens.map((token) => (
          <option key={token.name} value={token.name}>
            {token.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Style row wrapper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Wraps one style property with its override state: a dot when this breakpoint
 * sets it, click to clear back to the inherited value.
 */
export function StyleRow({
  label,
  access,
  keys,
  children,
  hint,
  wide,
}: {
  label?: string;
  access: StyleAccess;
  keys: StyleKey[];
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  const modified = keys.some((key) => access.isModified(key));
  return (
    <div className={`ui-field ui-styrow ${wide ? 'is-wide' : ''}`}>
      {label ? (
        <span className="ui-field__label">
          {label}
          {modified ? (
            <button
              type="button"
              className={`ui-dot ${access.isOverrideLayer ? 'is-override' : ''}`}
              title={
                access.isOverrideLayer
                  ? `Overridden on ${access.layer} — click to remove the override`
                  : 'Changed — click to restore the default'
              }
              onClick={() => access.reset(keys)}
            />
          ) : null}
        </span>
      ) : null}
      <div className="ui-field__control">{children}</div>
      {hint ? <p className="ui-field__hint">{hint}</p> : null}
    </div>
  );
}
