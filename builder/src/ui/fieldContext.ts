/**
 * Shared id plumbing for label/control pairs.
 *
 * Its own module so `common.tsx` exports components only — mixing hooks and
 * components in one file disables React Fast Refresh for that file.
 */

import { createContext, useContext } from 'react';

export const FieldIdContext = createContext<string | undefined>(undefined);

/** The generated id of the enclosing `Field`, for `htmlFor`/`id` pairing. */
export function useFieldId(): string | undefined {
  return useContext(FieldIdContext);
}
