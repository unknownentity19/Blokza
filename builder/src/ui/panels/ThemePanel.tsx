/**
 * Design tokens.
 *
 * Colours and fonts set here are emitted as CSS custom properties, and the
 * inspector offers them by name. That indirection is what makes a rebrand a
 * one-field change instead of a search across every element — and it is why the
 * default component styles reference `var(--color-brand)` rather than a hex.
 */

import { Collapsible, Field, Icon } from '../common';
import { useEditor } from '../../store/editor';
import { LengthControl, SelectControl, TextControl } from '../inspector/controls';
import { options } from '../../registry/helpers';
import { PALETTES } from '../../registry/palettes';

const FONT_STACKS = options(
  ['"Inter", system-ui, -apple-system, sans-serif', 'Inter'],
  ['"Urbanist", system-ui, sans-serif', 'Urbanist'],
  ['"Manrope", system-ui, sans-serif', 'Manrope'],
  ['"Fraunces", Georgia, serif', 'Fraunces'],
  ['"Playfair Display", Georgia, serif', 'Playfair Display'],
  ['Georgia, "Times New Roman", serif', 'Georgia'],
  ['system-ui, -apple-system, sans-serif', 'System sans'],
  ['ui-monospace, "JetBrains Mono", Menlo, monospace', 'Monospace'],
);

export function ThemePanel() {
  const theme = useEditor((s) => s.doc.theme);
  const setThemeColor = useEditor((s) => s.setThemeColor);
  const addThemeColor = useEditor((s) => s.addThemeColor);
  const removeThemeColor = useEditor((s) => s.removeThemeColor);
  const setThemeFont = useEditor((s) => s.setThemeFont);
  const setThemeScalar = useEditor((s) => s.setThemeScalar);
  const setCustomCss = useEditor((s) => s.setCustomCss);
  const applyPalette = useEditor((s) => s.applyPalette);

  return (
    <div className="ui-panel">
      <header className="ui-panel__head">
        <h2>Theme</h2>
        <span className="ui-panel__sub">Applies to every page</span>
      </header>

      <div className="ui-panel__scroll">
        <Collapsible title="Palette" id="theme-palette">
          <div className="ui-palettes">
            {PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                className="ui-palette"
                onClick={() => applyPalette(palette.id)}
                title={`Apply the ${palette.label} palette to every page`}
              >
                <span className="ui-palette__chips">
                  {palette.preview.map((colour, index) => (
                    <span key={index} style={{ background: colour }} />
                  ))}
                </span>
                <span className="ui-palette__label">{palette.label}</span>
              </button>
            ))}
          </div>
          <p className="ui-field__hint">
            Presets overwrite the colours below. Anything using a token restyles itself, so this is
            safe on a page you have already built.
          </p>
        </Collapsible>

        <Collapsible title="Colours" id="theme-colors" defaultOpen={false}>
          <div className="ui-tokens">
            {theme.colors.map((token, index) => (
              <div className="ui-token" key={`${token.name}-${index}`}>
                <span className="ui-color__swatch" style={{ background: token.value }}>
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(token.value) ? token.value : '#7a5fe5'}
                    aria-label={`${token.name} colour`}
                    onChange={(event) => setThemeColor(index, { value: event.target.value })}
                  />
                </span>
                <input
                  className="ui-input ui-token__name"
                  value={token.name}
                  aria-label="Token name"
                  onChange={(event) => setThemeColor(index, { name: event.target.value })}
                />
                <input
                  className="ui-input is-mono ui-token__value"
                  value={token.value}
                  aria-label="Token value"
                  onChange={(event) => setThemeColor(index, { value: event.target.value })}
                />
                <button
                  type="button"
                  className="ui-minibtn is-icon is-danger"
                  title={`Remove ${token.name}`}
                  onClick={() => removeThemeColor(index)}
                >
                  <Icon path="M6 6l12 12M18 6L6 18" size={12} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="ui-minibtn" onClick={addThemeColor}>
            <Icon path="M12 5v14M5 12h14" size={13} strokeWidth={2} /> Add colour
          </button>
          <p className="ui-field__hint">
            Used as <code>var(--color-name)</code>. Renaming a token does not update elements already
            using the old name.
          </p>
        </Collapsible>

        <Collapsible title="Type" id="theme-type">
          <Field label="Headings">
            <SelectControl
              value={theme.fonts.heading}
              options={FONT_STACKS}
              allowEmpty={false}
              onCommit={(value) => value && setThemeFont('heading', value)}
            />
          </Field>
          <Field label="Body">
            <SelectControl
              value={theme.fonts.body}
              options={FONT_STACKS}
              allowEmpty={false}
              onCommit={(value) => value && setThemeFont('body', value)}
            />
          </Field>
          <Field label="Mono">
            <SelectControl
              value={theme.fonts.mono}
              options={FONT_STACKS}
              allowEmpty={false}
              onCommit={(value) => value && setThemeFont('mono', value)}
            />
          </Field>
        </Collapsible>

        <Collapsible title="Shape" id="theme-shape">
          <Field label="Radius" hint="var(--radius)">
            <LengthControl
              value={theme.radius}
              units={['px', 'rem', '%']}
              min={0}
              onCommit={(value) => setThemeScalar('radius', value ?? '0px')}
            />
          </Field>
          <Field label="Content width" hint="var(--max-width), used by Container.">
            <LengthControl
              value={theme.maxWidth}
              units={['px', 'rem', '%']}
              min={0}
              onCommit={(value) => setThemeScalar('maxWidth', value ?? '1180px')}
            />
          </Field>
        </Collapsible>

        <Collapsible title="Custom CSS" id="theme-css" defaultOpen={false}>
          <Field
            label=""
            hint="Appended to the generated stylesheet, on the canvas and in the export."
            wide
          >
            <TextControl
              multiline
              rows={8}
              monospace
              value={theme.customCss ?? ''}
              placeholder={'.my-class {\n  letter-spacing: -0.02em;\n}'}
              onCommit={setCustomCss}
            />
          </Field>
        </Collapsible>
      </div>
    </div>
  );
}
