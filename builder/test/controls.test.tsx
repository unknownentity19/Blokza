/**
 * Control-level regression tests.
 *
 * The placeholder on a select carries the *inherited* value, which is raw CSS.
 * Rendered verbatim it produced menus reading "row / Across / Down" — the same
 * value twice, once in machine spelling. Only rendering the control catches it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SelectControl } from '../src/ui/inspector/controls';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function optionLabels(placeholder: string | undefined): string[] {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <SelectControl
        value={undefined}
        placeholder={placeholder}
        options={[
          { value: 'row', label: 'Across' },
          { value: 'column', label: 'Down' },
        ]}
        onCommit={() => {}}
      />,
    );
  });
  return [...host.querySelectorAll('option')].map((option) => option.textContent ?? '');
}

describe('SelectControl placeholder', () => {
  it('shows the option label for an inherited raw CSS value', () => {
    const labels = optionLabels('row');
    expect(labels).toEqual(['Across', 'Across', 'Down']);
    expect(labels).not.toContain('row');
  });

  it('falls back to the raw placeholder when no option matches it', () => {
    expect(optionLabels('1.5')).toEqual(['1.5', 'Across', 'Down']);
  });

  it('uses the empty label when there is no placeholder at all', () => {
    expect(optionLabels(undefined)).toEqual(['Not set', 'Across', 'Down']);
  });
});
