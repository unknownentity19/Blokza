/**
 * Component registry.
 *
 * A single mutable map populated at module load by the component modules. The
 * rest of the app only ever reads it, so a plain object is enough — no reactive
 * wrapper needed.
 */

import type { ComponentDef, ComponentGroup, FieldDef } from '../core/types';
import type { DropRules, RulesLookup } from '../core/tree';

const REGISTRY = new Map<string, ComponentDef>();

export function register(...defs: ComponentDef[]): void {
  for (const def of defs) {
    if (REGISTRY.has(def.type)) {
      throw new Error(`Duplicate component type registered: ${def.type}`);
    }
    REGISTRY.set(def.type, def);
  }
}

export function getComponent(type: string): ComponentDef | undefined {
  return REGISTRY.get(type);
}

export function allComponents(): ComponentDef[] {
  return [...REGISTRY.values()];
}

export function componentsInGroup(group: ComponentGroup): ComponentDef[] {
  return allComponents().filter((c) => c.group === group && !c.fixed);
}

export function componentLabel(type: string): string {
  return REGISTRY.get(type)?.label ?? type;
}

export function componentFields(type: string): FieldDef[] {
  return REGISTRY.get(type)?.fields ?? [];
}

export function isContainer(type: string): boolean {
  return REGISTRY.get(type)?.container === true;
}

/** Static CSS for a component type — see `compileCss`. */
export function componentCss(type: string): string | undefined {
  return REGISTRY.get(type)?.css;
}

/** Adapter so `core/tree` can validate drops without importing the registry. */
export const dropRules: RulesLookup = (type: string): DropRules | undefined => {
  const def = REGISTRY.get(type);
  if (!def) return undefined;
  return {
    container: def.container === true,
    allowChildren: def.allowChildren,
    allowParents: def.allowParents,
    fixed: def.fixed === true,
  };
};

/** Reset hook for tests that register fixtures. */
export function __clearRegistry(): void {
  REGISTRY.clear();
}
