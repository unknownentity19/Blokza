/**
 * Mount smoke tests.
 *
 * These exist because a hooks-order mistake — an early `return` placed above a
 * hook — compiles, typechecks, passes every unit test, and then renders a blank
 * page in production. Rendering the real component tree is the only thing that
 * catches it, so each branch that can return early is exercised here.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import '../src/registry';
import { App } from '../src/ui/App';
import { useEditor } from '../src/store/editor';
import { createEmptyDoc, insertSubtree } from '../src/core/doc';
import { spawnComponent } from '../src/core/factory';
import type { InspectorTabId, LeftPanelId } from '../src/core/types';

beforeAll(() => {
  // jsdom has no layout engine, so the canvas's observers need stubs.
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: StubResizeObserver,
  });
  // Tells React it is running inside a test, which is what act() checks for.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom has no layout engine, so every element measures 0x0 and the canvas
  // overlay — which only draws once it has a non-empty rect — would never render.
  // A fixed non-zero rect is enough for the overlay's presence and wiring.
  Element.prototype.getBoundingClientRect = function stubRect(): DOMRect {
    return {
      x: 10, y: 40, top: 40, left: 10, right: 210, bottom: 80,
      width: 200, height: 40, toJSON: () => ({}),
    } as DOMRect;
  };
});

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  // The canvas frame reports itself ready from a requestAnimationFrame callback,
  // so flush pending frames before asserting on anything inside it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // The iframe is a separate realm with its own Element.prototype, so the rect
  // stub installed above does not reach the nodes the overlay measures.
  const frameWindow = (container.querySelector('iframe.cv-frame') as HTMLIFrameElement)
    ?.contentWindow as (Window & typeof globalThis) | null;
  if (frameWindow) {
    frameWindow.Element.prototype.getBoundingClientRect = Element.prototype.getBoundingClientRect;
  }
}

beforeEach(() => {
  const doc = createEmptyDoc('Render test');
  useEditor.setState({
    doc,
    past: [],
    future: [],
    currentPageId: doc.pages[0].id,
    selectedId: null,
    hoverId: null,
    editing: null,
    drag: null,
    toasts: [],
    previewOpen: false,
    leftPanel: 'insert',
    inspectorTab: 'style',
    inspectorOpen: true,
    device: 'desktop',
    styleState: null,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Adds a section with a heading inside and selects the heading. */
function selectAHeading(): string {
  const doc = useEditor.getState().doc;
  const rootId = doc.pages[0].rootId;
  const next = { ...doc, nodes: { ...doc.nodes } };
  const section = spawnComponent('section');
  const heading = spawnComponent('heading');
  if (!section || !heading) throw new Error('spawn failed');
  insertSubtree(next, section.nodes, section.rootId, rootId, 0);
  insertSubtree(next, heading.nodes, heading.rootId, section.rootId, 0);
  act(() => {
    useEditor.setState({ doc: next, selectedId: heading.rootId });
  });
  return heading.rootId;
}

describe('App shell', () => {
  it('mounts with every region present', async () => {
    await mount();
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.querySelector('.tb')).not.toBeNull();
    expect(container.querySelector('.rail')).not.toBeNull();
    expect(container.querySelector('.cv')).not.toBeNull();
    expect(container.querySelector('.ui-inspector')).not.toBeNull();
    expect(container.querySelector('iframe.cv-frame')).not.toBeNull();
  });

  it('renders every side panel without throwing', async () => {
    await mount();
    const panels: LeftPanelId[] = ['insert', 'pages', 'layers', 'theme', 'settings'];
    for (const panel of panels) {
      act(() => {
        useEditor.getState().setLeftPanel(panel);
      });
      expect(container.querySelector('.app__panel')).not.toBeNull();
    }
    act(() => {
      useEditor.getState().setLeftPanel(null);
    });
    expect(container.querySelector('.app__panel')).toBeNull();
  });

  it('renders every inspector tab for a selected node', async () => {
    await mount();
    selectAHeading();
    const tabs: InspectorTabId[] = ['content', 'style', 'advanced'];
    for (const tab of tabs) {
      act(() => {
        useEditor.getState().setInspectorTab(tab);
      });
      expect(container.querySelector('.ui-inspector__body')?.childElementCount).toBeGreaterThan(0);
    }
  });

  it('survives collapsing and reopening the inspector in each state', async () => {
    await mount();
    // Collapsed with nothing selected.
    act(() => useEditor.getState().setInspectorOpen(false));
    expect(container.querySelector('.ui-inspector.is-collapsed')).not.toBeNull();

    act(() => useEditor.getState().setInspectorOpen(true));
    expect(container.querySelector('.ui-inspector.is-collapsed')).toBeNull();

    // Collapsed with a selection — the branch that skipped a hook.
    selectAHeading();
    act(() => useEditor.getState().setInspectorOpen(false));
    expect(container.querySelector('.ui-inspector.is-collapsed')).not.toBeNull();

    act(() => useEditor.getState().setInspectorOpen(true));
    expect(container.querySelector('.ui-crumbs')).not.toBeNull();
  });

  it('switches breakpoint and hover state with a selection', async () => {
    await mount();
    selectAHeading();
    // The layer banner belongs to the Style tab, and a heading opens on Content.
    act(() => useEditor.getState().setInspectorTab('style'));
    for (const device of ['mobile', 'tablet', 'desktop'] as const) {
      act(() => useEditor.getState().setDevice(device));
    }
    act(() => useEditor.getState().setStyleState('hover'));
    expect(container.querySelector('.ui-layerbar')).not.toBeNull();
    act(() => useEditor.getState().setStyleState(null));
  });

  it('opens the inspector on the tab that fits what was selected', async () => {
    await mount();
    const headingId = selectAHeading();
    const sectionId = useEditor.getState().doc.nodes[headingId].parent as string;

    // Content-bearing element → Content, so its text and link fields are there.
    expect(container.querySelector('.ui-inspector .ui-seg__btn.is-on')?.textContent).toBe('Content');

    // Layout element → Style, because that is all a section is for.
    act(() => useEditor.getState().select(sectionId));
    expect(container.querySelector('.ui-inspector .ui-seg__btn.is-on')?.textContent).toBe('Style');

    // A manual choice sticks while the user stays on that element…
    act(() => useEditor.getState().setInspectorTab('content'));
    expect(container.querySelector('.ui-inspector .ui-seg__btn.is-on')?.textContent).toBe('Content');

    // …and is released when they select something else.
    act(() => useEditor.getState().select(headingId));
    act(() => useEditor.getState().select(sectionId));
    expect(container.querySelector('.ui-inspector .ui-seg__btn.is-on')?.textContent).toBe('Style');
  });

  it('shows the selection action row, including delete', async () => {
    await mount();
    selectAHeading();
    const acts = container.querySelectorAll('.cv-act');
    expect(acts.length).toBe(5);
    expect([...acts].map((a) => a.getAttribute('aria-label'))).toEqual([
      'Select parent',
      'Move up',
      'Move down',
      'Duplicate',
      'Delete',
    ]);
  });

  it('deletes the selected element from the action row', async () => {
    await mount();
    const headingId = selectAHeading();
    const del = container.querySelector('.cv-act.is-danger') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    act(() => del.click());
    expect(useEditor.getState().doc.nodes[headingId]).toBeUndefined();
  });

  it('opens and closes the preview overlay', async () => {
    await mount();
    act(() => useEditor.getState().setPreview(true));
    expect(container.querySelector('.pv__frame')).not.toBeNull();
    act(() => useEditor.getState().setPreview(false));
    expect(container.querySelector('.pv')).toBeNull();
  });

  it('shows and dismisses toasts', async () => {
    await mount();
    act(() => useEditor.getState().toast('Hello', 'success'));
    expect(container.querySelector('.ui-toast')?.textContent).toBe('Hello');
    const id = useEditor.getState().toasts[0].id;
    act(() => useEditor.getState().dismissToast(id));
    expect(container.querySelector('.ui-toast')).toBeNull();
  });

  it('renders the layers tree for a nested document', async () => {
    await mount();
    selectAHeading();
    act(() => useEditor.getState().setLeftPanel('layers'));
    const rows = container.querySelectorAll('.ui-tree__row');
    // page root + section + heading
    expect(rows.length).toBe(3);
  });

  it('portals the page into the canvas iframe', async () => {
    await mount();
    const headingId = selectAHeading();
    const frame = container.querySelector('iframe.cv-frame') as HTMLIFrameElement;
    const inFrame = frame.contentDocument?.querySelector(`[data-node-id="${headingId}"]`);
    expect(inFrame).not.toBeNull();
    expect(inFrame?.className).toContain('c-heading');
    // The stylesheet travels with it.
    expect(frame.contentDocument?.querySelector('style[data-sb-css]')?.textContent).toContain('.n-');
  });
});

describe('inspector controls for every component', () => {
  it('renders the content tab for each registered type', async () => {
    const { allComponents } = await import('../src/registry/registry');
    await mount();
    const doc = useEditor.getState().doc;
    const rootId = doc.pages[0].rootId;

    for (const component of allComponents()) {
      if (component.fixed) continue;
      const spawned = spawnComponent(component.type);
      if (!spawned) throw new Error(`no spawn for ${component.type}`);
      const next = { ...useEditor.getState().doc, nodes: { ...useEditor.getState().doc.nodes } };
      // Parent it wherever it is allowed; page root accepts sections, and a
      // section accepts everything else.
      const parentId =
        component.allowParents?.includes('page-root') || component.type === 'section'
          ? rootId
          : (next.nodes[rootId].children[0] ?? rootId);
      insertSubtree(next, spawned.nodes, spawned.rootId, parentId, 0);

      act(() => {
        useEditor.setState({ doc: next, selectedId: spawned.rootId, inspectorTab: 'content' });
      });
      expect(
        container.querySelector('.ui-inspector__body')?.childElementCount,
        `content tab for ${component.type}`,
      ).toBeGreaterThan(0);

      act(() => useEditor.getState().setInspectorTab('style'));
      expect(
        container.querySelectorAll('.ui-section').length,
        `style tab for ${component.type}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('inline editing', () => {
  /** Fire a click as the frame's pointer pipeline sees it. */
  function clickInFrame(el: Element, point = { x: 12, y: 48 }): void {
    const frame = container.querySelector('iframe.cv-frame') as HTMLIFrameElement;
    const win = frame.contentWindow as Window & typeof globalThis;
    for (const type of ['pointerdown', 'pointerup']) {
      el.dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y }),
      );
    }
  }

  function frameEl(nodeId: string): HTMLElement {
    const frame = container.querySelector('iframe.cv-frame') as HTMLIFrameElement;
    const el = frame.contentDocument?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!el) throw new Error(`no element for ${nodeId}`);
    return el;
  }

  it('starts editing on a single click, not a second one', async () => {
    await mount();
    const headingId = selectAHeading();
    // Deselect, so this is genuinely a first click on the element.
    act(() => useEditor.getState().select(null));

    act(() => clickInFrame(frameEl(headingId)));

    expect(useEditor.getState().selectedId).toBe(headingId);
    expect(useEditor.getState().editing).toEqual(
      expect.objectContaining({ nodeId: headingId, key: 'text' }),
    );
  });

  it('does not start editing on an element with no text slot', async () => {
    await mount();
    const headingId = selectAHeading();
    const sectionId = useEditor.getState().doc.nodes[headingId].parent as string;
    act(() => useEditor.getState().select(null));

    act(() => clickInFrame(frameEl(sectionId)));

    expect(useEditor.getState().selectedId).toBe(sectionId);
    expect(useEditor.getState().editing).toBeNull();
  });

  it('commits the previous edit when the user clicks straight to another element', async () => {
    await mount();
    const first = selectAHeading();
    const sectionId = useEditor.getState().doc.nodes[first].parent as string;

    // A second heading to move to.
    const second = (() => {
      act(() => {
        useEditor.getState().select(sectionId);
        useEditor.getState().insertComponent('heading');
      });
      return useEditor.getState().selectedId as string;
    })();

    act(() => useEditor.getState().beginEdit(first, 'text'));
    // Typing, as the browser would: the DOM changes, the prop does not yet.
    frameEl(first).innerText = 'Typed into the first one';
    expect(useEditor.getState().doc.nodes[first].props.text).not.toBe('Typed into the first one');

    // Switching sessions used to drop this text on the floor: the effect cleanup
    // removed the blur listener that was the only thing committing it.
    act(() => useEditor.getState().beginEdit(second, 'text'));

    expect(useEditor.getState().doc.nodes[first].props.text).toBe('Typed into the first one');
    expect(useEditor.getState().editing?.nodeId).toBe(second);
  });

  it('commits when the edit ends normally', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    frameEl(headingId).innerText = 'Committed on end';
    act(() => useEditor.getState().endEdit());
    expect(useEditor.getState().doc.nodes[headingId].props.text).toBe('Committed on end');
  });

  it('leaves the prop alone when nothing was typed', async () => {
    await mount();
    const headingId = selectAHeading();
    const before = useEditor.getState().doc.nodes[headingId].props.text;
    const steps = useEditor.getState().past.length;

    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    act(() => useEditor.getState().endEdit());

    expect(useEditor.getState().doc.nodes[headingId].props.text).toBe(before);
    // An edit session the user abandoned must not litter the undo stack.
    expect(useEditor.getState().past.length).toBe(steps);
  });

  it('clears the contenteditable flag when the session ends', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    expect(frameEl(headingId).getAttribute('contenteditable')).toBe('true');
    act(() => useEditor.getState().endEdit());
    expect(frameEl(headingId).getAttribute('contenteditable')).toBe('false');
  });
});

describe('edit session guards', () => {
  function frameWin(): Window & typeof globalThis {
    const frame = container.querySelector('iframe.cv-frame') as HTMLIFrameElement;
    return frame.contentWindow as Window & typeof globalThis;
  }

  function frameEl2(nodeId: string): HTMLElement {
    const frame = container.querySelector('iframe.cv-frame') as HTMLIFrameElement;
    const el = frame.contentDocument?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!el) throw new Error(`no element for ${nodeId}`);
    return el;
  }

  function press(el: Element, key: string, init: Partial<KeyboardEventInit> = {}): void {
    const win = frameWin();
    el.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  }

  function pointer(el: Element, type: string, point = { x: 12, y: 48 }): void {
    const win = frameWin();
    el.dispatchEvent(
      new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y }),
    );
  }

  function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
    const win = frameWin();
    return new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  }

  it('Escape discards the edit instead of saving it', async () => {
    await mount();
    const headingId = selectAHeading();
    const before = useEditor.getState().doc.nodes[headingId].props.text;
    const steps = useEditor.getState().past.length;

    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    const el = frameEl2(headingId);
    el.textContent = 'Typed by accident';
    // Regression: a frame-level capture handler used to blur first, which
    // committed — so Escape saved the very edit it claims to throw away.
    act(() => press(el, 'Escape'));

    expect(useEditor.getState().doc.nodes[headingId].props.text).toBe(before);
    expect(useEditor.getState().past.length).toBe(steps);
    expect(useEditor.getState().editing).toBeNull();
  });

  it('Enter commits and ends the session', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    const el = frameEl2(headingId);
    el.textContent = 'Kept on Enter';
    act(() => press(el, 'Enter'));

    expect(useEditor.getState().doc.nodes[headingId].props.text).toBe('Kept on Enter');
    expect(useEditor.getState().editing).toBeNull();
  });

  it('shift+Enter neither commits nor ends the session', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    const el = frameEl2(headingId);
    el.textContent = 'Two lines';
    act(() => press(el, 'Enter', { shiftKey: true }));

    expect(useEditor.getState().editing?.nodeId).toBe(headingId);
    expect(useEditor.getState().doc.nodes[headingId].props.text).not.toBe('Two lines');
  });

  it('an aborted gesture is not a click', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().select(null));

    // A touch pan the browser takes over: pointercancel with no movement. This
    // used to open an editor and raise the soft keyboard on someone scrolling.
    act(() => {
      pointer(frameEl2(headingId), 'pointerdown');
      pointer(frameEl2(headingId), 'pointercancel');
    });

    expect(useEditor.getState().editing).toBeNull();
    expect(useEditor.getState().drag).toBeNull();
  });

  it('a bare click on an empty slot writes nothing to history', async () => {
    await mount();
    const headingId = selectAHeading();
    // An empty slot renders a zero-width space so it stays clickable. `trim()`
    // does not strip U+200B, so the change test used to fire on every click.
    act(() => useEditor.getState().setProp(headingId, 'text', ''));
    const steps = useEditor.getState().past.length;
    const stamp = useEditor.getState().doc.updatedAt;

    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    act(() => useEditor.getState().endEdit());

    expect(useEditor.getState().past.length).toBe(steps);
    expect(useEditor.getState().doc.updatedAt).toBe(stamp);
  });

  it('treats a non-breaking space as unchanged', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().setProp(headingId, 'text', 'One\u00a0two'));
    const steps = useEditor.getState().past.length;

    act(() => useEditor.getState().beginEdit(headingId, 'text'));
    act(() => useEditor.getState().endEdit());

    expect(useEditor.getState().past.length).toBe(steps);
  });

  it('does not edit or select a locked node on double-click', async () => {
    await mount();
    const headingId = selectAHeading();
    const sectionId = useEditor.getState().doc.nodes[headingId].parent as string;
    act(() => {
      const doc = useEditor.getState().doc;
      useEditor.setState({
        doc: { ...doc, nodes: { ...doc.nodes, [headingId]: { ...doc.nodes[headingId], locked: true } } },
        selectedId: null,
      });
    });

    const el = frameEl2(headingId);
    act(() => {
      el.dispatchEvent(mouse('dblclick'));
    });

    expect(useEditor.getState().editing).toBeNull();
    expect(useEditor.getState().selectedId).not.toBe(headingId);
    void sectionId;
  });

  it('cancels the click default even while editing, so the frame cannot navigate', async () => {
    await mount();
    const headingId = selectAHeading();
    act(() => useEditor.getState().beginEdit(headingId, 'text'));

    const event = mouse('click');
    act(() => {
      frameEl2(headingId).dispatchEvent(event);
    });
    // A link that is mid-edit would otherwise navigate the frame and replace the
    // document React portals into, blanking the canvas.
    expect(event.defaultPrevented).toBe(true);
  });
});
