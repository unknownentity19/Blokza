/**
 * The style tab.
 *
 * A generic CSS inspector rather than per-component named fields. The old editor
 * exposed a fixed list like "Accent color" and "Card 2 body" per block type,
 * which meant anything the block's author had not thought of was unreachable.
 * Here every element gets the same closed set of CSS properties (`STYLE_KEYS`),
 * scoped to the current breakpoint and state.
 */

import { Collapsible } from '../common';
import { useEditor } from '../../store/editor';
import { ColorControl, LengthControl, SelectControl, StyleRow, TextControl } from './controls';
import { SIZE_UNITS } from './units';
import { SpacingBox } from './SpacingBox';
import { useStyleAccess } from './useStyle';
import { options } from '../../registry/helpers';
import type { StyleKey } from '../../core/types';

const FONT_OPTIONS = options(
  ['var(--font-body)', 'Theme · body'],
  ['var(--font-heading)', 'Theme · heading'],
  ['var(--font-mono)', 'Theme · mono'],
  ['"Inter", system-ui, sans-serif', 'Inter'],
  ['"Urbanist", system-ui, sans-serif', 'Urbanist'],
  ['"Fraunces", Georgia, serif', 'Fraunces'],
  ['"Playfair Display", Georgia, serif', 'Playfair Display'],
  ['"Manrope", system-ui, sans-serif', 'Manrope'],
  ['ui-monospace, "JetBrains Mono", monospace', 'JetBrains Mono'],
  ['Georgia, serif', 'Georgia'],
  ['system-ui, sans-serif', 'System'],
);

const WEIGHTS = options(
  ['300', '300 · Light'],
  ['400', '400 · Regular'],
  ['500', '500 · Medium'],
  ['600', '600 · Semibold'],
  ['700', '700 · Bold'],
  ['800', '800 · Extrabold'],
  ['900', '900 · Black'],
);

const ALIGN_ICONS = [
  { value: 'left', icon: 'M3 6h18M3 12h10M3 18h14', title: 'Left' },
  { value: 'center', icon: 'M3 6h18M7 12h10M5 18h14', title: 'Centre' },
  { value: 'right', icon: 'M3 6h18M11 12h10M7 18h14', title: 'Right' },
  { value: 'justify', icon: 'M3 6h18M3 12h18M3 18h18', title: 'Justify' },
];

const JUSTIFY = options(
  ['flex-start', 'Start'],
  ['center', 'Centre'],
  ['flex-end', 'End'],
  ['space-between', 'Space between'],
  ['space-around', 'Space around'],
  ['space-evenly', 'Space evenly'],
);

const ALIGN_ITEMS = options(
  ['stretch', 'Stretch'],
  ['flex-start', 'Start'],
  ['center', 'Centre'],
  ['flex-end', 'End'],
  ['baseline', 'Baseline'],
);

export function StyleTab() {
  const access = useStyleAccess();
  const tokens = useEditor((s) => s.doc.theme.colors);
  const { node } = access;

  if (!node) return null;

  /** Shorthand: a length row bound to one property. */
  const len = (label: string, key: StyleKey, units?: string[], min?: number) => (
    <StyleRow label={label} access={access} keys={[key]}>
      <LengthControl
        value={access.own(key) ?? ''}
        inherited={access.effective(key)}
        units={units}
        min={min}
        onCommit={(value, coalesce) => access.set(key, value, coalesce)}
      />
    </StyleRow>
  );

  const sel = (label: string, key: StyleKey, opts: { value: string; label: string }[], hint?: string) => (
    <StyleRow label={label} access={access} keys={[key]} hint={hint}>
      <SelectControl
        value={access.own(key) ?? ''}
        placeholder={access.effective(key) ?? 'Not set'}
        options={opts}
        onCommit={(value) => access.set(key, value)}
      />
    </StyleRow>
  );

  const colour = (label: string, key: StyleKey) => (
    <StyleRow label={label} access={access} keys={[key]}>
      <ColorControl
        value={access.own(key) ?? ''}
        inherited={access.effective(key)}
        tokens={tokens}
        onCommit={(value, coalesce) => access.set(key, value, coalesce)}
      />
    </StyleRow>
  );

  const display = access.effective('display');
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  return (
    <>
      <Collapsible title="Layout" id="sty-layout">
        {sel('Display', 'display', options(
          ['block', 'Block'],
          ['flex', 'Flex'],
          ['grid', 'Grid'],
          ['inline-flex', 'Inline flex'],
          ['inline-block', 'Inline block'],
          ['inline', 'Inline'],
          ['none', 'None'],
        ))}

        {isFlex ? (
          <>
            {sel('Direction', 'flexDirection', options(
              ['row', 'Row'],
              ['column', 'Column'],
              ['row-reverse', 'Row reverse'],
              ['column-reverse', 'Column reverse'],
            ))}
            {sel('Justify', 'justifyContent', JUSTIFY)}
            {sel('Align', 'alignItems', ALIGN_ITEMS)}
            {sel('Wrap', 'flexWrap', options(['nowrap', 'No wrap'], ['wrap', 'Wrap'], ['wrap-reverse', 'Wrap reverse']))}
          </>
        ) : null}

        {isGrid ? (
          <>
            <StyleRow label="Columns" access={access} keys={['gridTemplateColumns']} hint="e.g. repeat(3, minmax(0, 1fr))">
              <TextControl
                value={access.own('gridTemplateColumns') ?? ''}
                placeholder={access.effective('gridTemplateColumns') ?? ''}
                monospace
                onCommit={(value) => access.set('gridTemplateColumns', value || null)}
              />
            </StyleRow>
            {sel('Align', 'alignItems', ALIGN_ITEMS)}
          </>
        ) : null}

        {isFlex || isGrid ? (
          <>
            {len('Gap', 'gap')}
            <div className="ui-grid2">
              {len('Row gap', 'rowGap')}
              {len('Col gap', 'columnGap')}
            </div>
            {sel('Align rows', 'alignContent', options(
              ['stretch', 'Stretch'],
              ['flex-start', 'Start'],
              ['center', 'Centre'],
              ['flex-end', 'End'],
              ['space-between', 'Space between'],
              ['space-around', 'Space around'],
            ))}
          </>
        ) : null}

        {isGrid
          ? sel('Auto flow', 'gridAutoFlow', options(
              ['row', 'Row'],
              ['column', 'Column'],
              ['row dense', 'Row dense'],
              ['column dense', 'Column dense'],
            ))
          : null}

      </Collapsible>

      {/*
        How the element behaves as a *child* of its parent, rather than how it
        lays out its own children. Seven controls that are almost always "Not
        set" used to sit directly under Layout, so the first thing anyone saw on
        selecting a section was a wall of empty flex and grid fields. They are
        still one click away, and they still apply whatever this element's own
        display is — which is why they are outside the flex/grid branches above.
      */}
      <Collapsible title="Inside its parent" id="sty-child" defaultOpen={false}>
        {len('Grow', 'flexGrow', ['', 'px'])}
        {sel('Self align', 'alignSelf', options(
          ['auto', 'Auto'],
          ['flex-start', 'Start'],
          ['center', 'Centre'],
          ['flex-end', 'End'],
          ['stretch', 'Stretch'],
        ))}
        {len('Order', 'order', ['', 'px'])}
        <div className="ui-grid2">
          {len('Shrink', 'flexShrink', ['', 'px'])}
          {/* The property that actually controls a column's width inside a row —
              previously whitelisted but with no control anywhere. */}
          {len('Basis', 'flexBasis', SIZE_UNITS)}
        </div>
        <div className="ui-grid2">
          <StyleRow label="Col span" access={access} keys={['gridColumn']}>
            <TextControl
              value={access.own('gridColumn') ?? ''}
              placeholder={access.effective('gridColumn') ?? 'auto'}
              monospace
              onCommit={(value) => access.set('gridColumn', value || null)}
            />
          </StyleRow>
          <StyleRow label="Row span" access={access} keys={['gridRow']}>
            <TextControl
              value={access.own('gridRow') ?? ''}
              placeholder={access.effective('gridRow') ?? 'auto'}
              monospace
              onCommit={(value) => access.set('gridRow', value || null)}
            />
          </StyleRow>
        </div>
        <p className="ui-field__hint">
          Span controls apply when this element sits in a grid — e.g. <code>span 2</code>.
        </p>
      </Collapsible>

      <Collapsible title="Spacing" id="sty-spacing">
        <SpacingBox access={access} />
      </Collapsible>

      <Collapsible title="Size" id="sty-size">
        <div className="ui-grid2">
          {len('Width', 'width', SIZE_UNITS)}
          {len('Height', 'height', SIZE_UNITS)}
          {len('Min W', 'minWidth', SIZE_UNITS)}
          {len('Min H', 'minHeight', SIZE_UNITS)}
          {len('Max W', 'maxWidth', SIZE_UNITS)}
          {len('Max H', 'maxHeight', SIZE_UNITS)}
        </div>
        <StyleRow label="Ratio" access={access} keys={['aspectRatio']} hint="e.g. 16 / 9">
          <TextControl
            value={access.own('aspectRatio') ?? ''}
            placeholder={access.effective('aspectRatio') ?? 'auto'}
            monospace
            onCommit={(value) => access.set('aspectRatio', value || null)}
          />
        </StyleRow>
        {sel('Overflow', 'overflow', options(
          ['visible', 'Visible'],
          ['hidden', 'Hidden'],
          ['auto', 'Auto'],
          ['scroll', 'Scroll'],
          ['clip', 'Clip'],
        ))}
        {sel('Box sizing', 'boxSizing', options(
          ['border-box', 'Border box'],
          ['content-box', 'Content box'],
        ))}
        {sel('Fit', 'objectFit', options(
          ['cover', 'Cover'],
          ['contain', 'Contain'],
          ['fill', 'Fill'],
          ['none', 'None'],
          ['scale-down', 'Scale down'],
        ))}
        <StyleRow label="Fit pos" access={access} keys={['objectPosition']} hint="Where a cropped image sits, e.g. center top">
          <TextControl
            value={access.own('objectPosition') ?? ''}
            placeholder={access.effective('objectPosition') ?? 'center'}
            monospace
            onCommit={(value) => access.set('objectPosition', value || null)}
          />
        </StyleRow>
      </Collapsible>

      <Collapsible title="Typography" id="sty-type">
        {sel('Font', 'fontFamily', FONT_OPTIONS, 'Theme fonts follow the values set in the Theme panel.')}
        <div className="ui-grid2">
          {len('Size', 'fontSize', ['px', 'rem', 'em', '%'])}
          {len('Height', 'lineHeight', ['', 'px', 'rem', 'em', '%'])}
        </div>
        {sel('Weight', 'fontWeight', WEIGHTS)}
        {len('Tracking', 'letterSpacing', ['em', 'px', 'rem'])}

        <StyleRow label="Align" access={access} keys={['textAlign']}>
          <div className="ui-seg is-compact" role="group" aria-label="Text align">
            {ALIGN_ICONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`ui-seg__btn ${access.effective('textAlign') === option.value ? 'is-on' : ''}`}
                title={option.title}
                aria-label={option.title}
                onClick={() =>
                  access.set('textAlign', access.own('textAlign') === option.value ? null : option.value)
                }
              >
                <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d={option.icon} />
                </svg>
              </button>
            ))}
          </div>
        </StyleRow>

        {sel('Transform', 'textTransform', options(
          ['none', 'None'],
          ['uppercase', 'Uppercase'],
          ['lowercase', 'Lowercase'],
          ['capitalize', 'Capitalise'],
        ))}
        {sel('Style', 'fontStyle', options(['normal', 'Normal'], ['italic', 'Italic']))}
        {sel('Wrapping', 'whiteSpace', options(
          ['normal', 'Normal'],
          ['nowrap', 'No wrap'],
          ['pre-wrap', 'Keep line breaks'],
          ['balance', 'Balance lines'],
        ))}
        {sel('Decoration', 'textDecoration', options(
          ['none', 'None'],
          ['underline', 'Underline'],
          ['line-through', 'Strikethrough'],
        ))}
        {colour('Colour', 'color')}
      </Collapsible>

      <Collapsible title="Background" id="sty-bg" defaultOpen={false}>
        {colour('Colour', 'backgroundColor')}
        <StyleRow label="Image" access={access} keys={['backgroundImage']} hint="url(…) or a gradient" wide>
          <TextControl
            value={access.own('backgroundImage') ?? ''}
            placeholder="linear-gradient(…)"
            monospace
            onCommit={(value) => access.set('backgroundImage', value || null)}
          />
        </StyleRow>
        {sel('Size', 'backgroundSize', options(['cover', 'Cover'], ['contain', 'Contain'], ['auto', 'Auto']))}
        {sel('Position', 'backgroundPosition', options(
          ['center', 'Centre'],
          ['top', 'Top'],
          ['bottom', 'Bottom'],
          ['left', 'Left'],
          ['right', 'Right'],
        ))}
        {sel('Clip', 'backgroundClip', options(
          ['border-box', 'Border box'],
          ['padding-box', 'Padding box'],
          ['content-box', 'Content box'],
          ['text', 'Text (gradient text)'],
        ))}
        {sel('Repeat', 'backgroundRepeat', options(
          ['no-repeat', 'No repeat'],
          ['repeat', 'Repeat'],
          ['repeat-x', 'Repeat X'],
          ['repeat-y', 'Repeat Y'],
        ))}
        <StyleRow label="Shorthand" access={access} keys={['background']} hint="Full CSS background, if the fields above are not enough" wide>
          <TextControl
            value={access.own('background') ?? ''}
            placeholder="e.g. linear-gradient(...) center / cover no-repeat"
            monospace
            onCommit={(value) => access.set('background', value || null)}
          />
        </StyleRow>
      </Collapsible>

      <Collapsible title="Border" id="sty-border" defaultOpen={false}>
        {sel('Style', 'borderStyle', options(
          ['solid', 'Solid'],
          ['dashed', 'Dashed'],
          ['dotted', 'Dotted'],
          ['none', 'None'],
        ))}
        {len('Width', 'borderWidth', ['px', 'rem'], 0)}
        <div className="ui-grid2">
          {len('Top', 'borderTopWidth', ['px', 'rem'], 0)}
          {len('Right', 'borderRightWidth', ['px', 'rem'], 0)}
          {len('Bottom', 'borderBottomWidth', ['px', 'rem'], 0)}
          {len('Left', 'borderLeftWidth', ['px', 'rem'], 0)}
        </div>
        {colour('Colour', 'borderColor')}
        <StyleRow label="Radius" access={access} keys={['borderRadius']} hint="One value, or four for individual corners">
          <TextControl
            value={access.own('borderRadius') ?? ''}
            placeholder={access.effective('borderRadius') ?? '0'}
            monospace
            onCommit={(value) => access.set('borderRadius', value || null)}
          />
        </StyleRow>
      </Collapsible>

      <Collapsible title="Effects" id="sty-effects" defaultOpen={false}>
        <StyleRow label="Opacity" access={access} keys={['opacity']}>
          <div className="ui-rangerow">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={Number(access.effective('opacity') ?? 1)}
              onChange={(event) => access.set('opacity', event.target.value, true)}
              aria-label="Opacity"
            />
            <span className="ui-rangerow__value">
              {Math.round(Number(access.effective('opacity') ?? 1) * 100)}%
            </span>
          </div>
        </StyleRow>
        <StyleRow label="Shadow" access={access} keys={['boxShadow']} hint="e.g. 0 12px 30px -10px rgba(0,0,0,.2)" wide>
          <TextControl
            value={access.own('boxShadow') ?? ''}
            placeholder={access.effective('boxShadow') ?? 'none'}
            monospace
            onCommit={(value) => access.set('boxShadow', value || null)}
          />
        </StyleRow>
        <StyleRow label="Transform" access={access} keys={['transform']} hint="e.g. translateY(-4px) scale(1.02)" wide>
          <TextControl
            value={access.own('transform') ?? ''}
            placeholder={access.effective('transform') ?? 'none'}
            monospace
            onCommit={(value) => access.set('transform', value || null)}
          />
        </StyleRow>
        <StyleRow label="Filter" access={access} keys={['filter']} hint="e.g. blur(6px) saturate(1.2)" wide>
          <TextControl
            value={access.own('filter') ?? ''}
            placeholder={access.effective('filter') ?? 'none'}
            monospace
            onCommit={(value) => access.set('filter', value || null)}
          />
        </StyleRow>
        <StyleRow label="Text shadow" access={access} keys={['textShadow']} hint="e.g. 0 2px 0 rgba(0,0,0,.25)" wide>
          <TextControl
            value={access.own('textShadow') ?? ''}
            placeholder={access.effective('textShadow') ?? 'none'}
            monospace
            onCommit={(value) => access.set('textShadow', value || null)}
          />
        </StyleRow>
        <StyleRow label="Backdrop" access={access} keys={['backdropFilter']} hint="e.g. blur(12px) — frosted glass over what is behind" wide>
          <TextControl
            value={access.own('backdropFilter') ?? ''}
            placeholder={access.effective('backdropFilter') ?? 'none'}
            monospace
            onCommit={(value) => access.set('backdropFilter', value || null)}
          />
        </StyleRow>
        {sel('Blend', 'mixBlendMode', options(
          ['normal', 'Normal'],
          ['multiply', 'Multiply'],
          ['screen', 'Screen'],
          ['overlay', 'Overlay'],
          ['difference', 'Difference'],
          ['luminosity', 'Luminosity'],
        ))}
        {sel('Cursor', 'cursor', options(
          ['auto', 'Auto'],
          ['pointer', 'Pointer'],
          ['default', 'Default'],
          ['not-allowed', 'Not allowed'],
          ['grab', 'Grab'],
          ['text', 'Text'],
        ))}
        <StyleRow label="Transition" access={access} keys={['transition']} hint="e.g. all 0.2s ease" wide>
          <TextControl
            value={access.own('transition') ?? ''}
            placeholder={access.effective('transition') ?? 'none'}
            monospace
            onCommit={(value) => access.set('transition', value || null)}
          />
        </StyleRow>
      </Collapsible>

      <Collapsible title="Position" id="sty-position" defaultOpen={false}>
        {sel('Position', 'position', options(
          ['static', 'Static'],
          ['relative', 'Relative'],
          ['absolute', 'Absolute'],
          ['fixed', 'Fixed'],
          ['sticky', 'Sticky'],
        ))}
        <div className="ui-grid2">
          {len('Top', 'top')}
          {len('Right', 'right')}
          {len('Bottom', 'bottom')}
          {len('Left', 'left')}
        </div>
        {len('Z-index', 'zIndex', ['', 'px'])}
      </Collapsible>
    </>
  );
}
