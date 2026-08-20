/**
 * Margin and padding editor.
 *
 * Two nested boxes with a field per side, the way browser dev tools and Figma
 * present it, because spacing is spatial and a list of four labelled inputs
 * makes you translate between the label and the edge every single time.
 *
 * The link toggles are per-box and remembered for the session: setting all four
 * sides together is the common case, and having to click four fields for a
 * symmetric padding is the kind of friction that makes an editor feel cheap.
 */

import { useState } from 'react';
import { Icon } from '../common';
import { LengthControl } from './controls';
import { MARGIN_UNITS, SPACING_UNITS as PADDING_UNITS } from './units';
import type { StyleAccess } from './useStyle';
import type { StyleKey } from '../../core/types';

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
const SIDES: Side[] = ['Top', 'Right', 'Bottom', 'Left'];



function keyFor(box: 'margin' | 'padding', side: Side): StyleKey {
  return `${box}${side}` as StyleKey;
}

export function SpacingBox({ access }: { access: StyleAccess }) {
  const [linked, setLinked] = useState<{ margin: boolean; padding: boolean }>(() => {
    try {
      const stored = sessionStorage.getItem('altask:spacing-linked');
      return stored ? (JSON.parse(stored) as { margin: boolean; padding: boolean }) : { margin: false, padding: false };
    } catch {
      return { margin: false, padding: false };
    }
  });

  const toggleLink = (box: 'margin' | 'padding') => {
    const next = { ...linked, [box]: !linked[box] };
    setLinked(next);
    try {
      sessionStorage.setItem('altask:spacing-linked', JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const write = (box: 'margin' | 'padding', side: Side, value: string | null, coalesce?: boolean) => {
    // Padding cannot be negative — a negative value there is silently ignored by
    // the browser, which looks like the editor dropped the input.
    let next = value;
    if (box === 'padding' && next && next.startsWith('-')) next = '0px';

    if (linked[box]) {
      access.setMany(Object.fromEntries(SIDES.map((s) => [keyFor(box, s), next])));
    } else {
      access.set(keyFor(box, side), next, coalesce);
    }
  };

  const renderSide = (box: 'margin' | 'padding', side: Side) => {
    const key = keyFor(box, side);
    return (
      <div className={`sp-cell sp-cell--${side.toLowerCase()}`} key={`${box}-${side}`}>
        <LengthControl
          hideUnit
          compact
          ariaLabel={`${box} ${side.toLowerCase()}`}
          value={access.own(key) ?? ''}
          inherited={access.effective(key)}
          units={box === 'margin' ? MARGIN_UNITS : PADDING_UNITS}
          min={box === 'padding' ? 0 : undefined}
          onCommit={(value, coalesce) => write(box, side, value, coalesce)}
        />
      </div>
    );
  };

  const boxModified = (box: 'margin' | 'padding') =>
    SIDES.some((side) => access.isModified(keyFor(box, side)));

  const legend = (box: 'margin' | 'padding') => (
    <div className="sp-bar">
      <span className="sp-legend">
        {box}
        {boxModified(box) ? (
          <button
            type="button"
            className={`ui-dot ${access.isOverrideLayer ? 'is-override' : ''}`}
            title={`Reset ${box}`}
            onClick={() => access.reset(SIDES.map((side) => keyFor(box, side)))}
          />
        ) : null}
      </span>
      <button
        type="button"
        className={`sp-link ${linked[box] ? 'is-on' : ''}`}
        onClick={() => toggleLink(box)}
        title={linked[box] ? 'All sides change together' : 'Link all sides'}
        aria-pressed={linked[box]}
      >
        <Icon
          path={
            linked[box]
              ? 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'
              : 'M9 15l-2 2a4 4 0 0 1-5-5l2-2M15 9l2-2a4 4 0 0 1 5 5l-2 2M4 4l16 16'
          }
          size={11}
        />
      </button>
    </div>
  );

  /*
   * Laid out as a 3x3 grid rather than absolutely-positioned inputs: at a 270px
   * panel width absolute boxes overlap each other, and a grid stays legible at
   * any width while keeping the nested-rectangle reading that makes this control
   * worth having.
   */
  return (
    <div className="sp">
      <div className="sp-box sp-box--margin">
        {legend('margin')}
        <div className="sp-ring">
          {renderSide('margin', 'Top')}
          {renderSide('margin', 'Left')}

          <div className="sp-box sp-box--padding">
            {legend('padding')}
            <div className="sp-ring">
              {renderSide('padding', 'Top')}
              {renderSide('padding', 'Left')}
              <div className="sp-core" aria-hidden="true" />
              {renderSide('padding', 'Right')}
              {renderSide('padding', 'Bottom')}
            </div>
          </div>

          {renderSide('margin', 'Right')}
          {renderSide('margin', 'Bottom')}
        </div>
      </div>
    </div>
  );
}
