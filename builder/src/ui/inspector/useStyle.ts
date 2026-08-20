/**
 * Reading and writing the selected node's styles.
 *
 * The inspector always edits exactly one *layer* — the current breakpoint, or
 * the hover bag when hover is armed. Two values matter for every property:
 *
 *   `own`        what this layer sets explicitly. Drives the override dot and
 *                the "reset" affordance.
 *   `effective`  what the node actually renders as here, after the cascade from
 *                wider breakpoints. Shown as the placeholder, so an unset field
 *                on mobile still tells you what it inherits from desktop.
 *
 * Without that distinction a user editing mobile cannot tell an inherited 44px
 * from an overridden 44px, and clearing a field looks like it did nothing.
 */

import { useCallback, useMemo } from 'react';
import { breakpointForDevice } from '../../core/devices';
import { cascadeFor } from '../../core/css';
import { useEditor } from '../../store/editor';
import { getComponent } from '../../registry/registry';
import type { SBNode, StyleBag, StyleKey } from '../../core/types';

export interface StyleAccess {
  node: SBNode | undefined;
  nodeId: string | null;
  /** Layer being edited: `'base' | 'tablet' | 'mobile' | 'hover'`. */
  layer: string;
  /** Whether the layer being edited is an override of something wider. */
  isOverrideLayer: boolean;
  own: (key: StyleKey) => string | undefined;
  effective: (key: StyleKey) => string | undefined;
  /** What the component ships with on this layer, if anything. */
  defaultFor: (key: StyleKey) => string | undefined;
  /**
   * `true` when this layer's value differs from the component's own default.
   * Distinct from "is set": a Section's 96px padding *is* set on `base`, but the
   * user did not set it, so flagging it as an override would mean every fresh
   * element arrives covered in change markers.
   */
  isModified: (key: StyleKey) => boolean;
  set: (key: StyleKey, value: string | null, coalesce?: boolean) => void;
  setMany: (patch: Partial<Record<StyleKey, string | null>>) => void;
  /**
   * Reset to the component default on `base`, or remove the declaration on an
   * override layer. "Reset" should mean "back to how it arrived", and on the base
   * layer deleting the declaration would strip the component's own styling.
   */
  reset: (keys: StyleKey[]) => void;
  /** Keys the user has actually changed on this layer. */
  modifiedKeys: StyleKey[];
}

export function useStyleAccess(): StyleAccess {
  const nodeId = useEditor((s) => s.selectedId);
  const node = useEditor((s) => (s.selectedId ? s.doc.nodes[s.selectedId] : undefined));
  const device = useEditor((s) => s.device);
  const styleState = useEditor((s) => s.styleState);
  const setStyleValue = useEditor((s) => s.setStyleValue);
  const commit = useEditor((s) => s.commit);

  const breakpoint = breakpointForDevice(device);
  const layer = styleState ?? breakpoint;
  const defaults = node ? getComponent(node.type)?.defaultStyles : undefined;

  const own = useCallback(
    (key: StyleKey) => (node?.styles as Record<string, StyleBag | undefined>)?.[layer]?.[key],
    [node, layer],
  );

  const effective = useCallback(
    (key: StyleKey) => {
      if (!node) return undefined;
      // Widest first, so the narrowest definition wins.
      let value: string | undefined;
      for (const bp of cascadeFor(breakpoint)) value = node.styles[bp]?.[key] ?? value;
      if (styleState) value = node.styles[styleState]?.[key] ?? value;
      return value;
    },
    [node, breakpoint, styleState],
  );

  const defaultFor = useCallback(
    (key: StyleKey) => (defaults as Record<string, StyleBag | undefined> | undefined)?.[layer]?.[key],
    [defaults, layer],
  );

  const isModified = useCallback(
    (key: StyleKey) => {
      const value = own(key);
      return value !== undefined && value !== defaultFor(key);
    },
    [own, defaultFor],
  );

  const set = useCallback(
    (key: StyleKey, value: string | null, coalesce = false) => {
      if (!nodeId) return;
      setStyleValue(nodeId, key, value, coalesce);
    },
    [nodeId, setStyleValue],
  );

  const setMany = useCallback(
    (patch: Partial<Record<StyleKey, string | null>>) => {
      if (!nodeId) return;
      // One commit for the whole patch: a linked spacing edit writing four sides
      // must be a single undo step, not four.
      commit((draft) => {
        const target = draft.nodes[nodeId];
        if (!target) return;
        const bag = { ...((target.styles as Record<string, StyleBag | undefined>)[layer] ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') delete bag[key as StyleKey];
          else bag[key as StyleKey] = value;
        }
        const styles = target.styles as Record<string, StyleBag | undefined>;
        if (Object.keys(bag).length === 0) delete styles[layer];
        else styles[layer] = bag;
      });
    },
    [commit, layer, nodeId],
  );

  const reset = useCallback(
    (keys: StyleKey[]) => {
      setMany(Object.fromEntries(keys.map((key) => [key, defaultFor(key) ?? null])));
    },
    [setMany, defaultFor],
  );

  const modifiedKeys = useMemo(() => {
    const bag = (node?.styles as Record<string, StyleBag | undefined>)?.[layer];
    if (!bag) return [];
    const defaultBag = (defaults as Record<string, StyleBag | undefined> | undefined)?.[layer];
    return (Object.keys(bag) as StyleKey[]).filter((key) => bag[key] !== defaultBag?.[key]);
  }, [node, layer, defaults]);

  return {
    node,
    nodeId,
    layer,
    isOverrideLayer: layer !== 'base',
    own,
    effective,
    defaultFor,
    isModified,
    set,
    setMany,
    reset,
    modifiedKeys,
  };
}
