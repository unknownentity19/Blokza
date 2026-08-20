/**
 * Registry entry point. Importing this module registers every component, so it
 * must be imported once before any rendering happens (see `main.tsx`).
 */

import { register } from './registry';
import { LAYOUT_COMPONENTS } from './layout';
import { CONTENT_COMPONENTS } from './content';
import { MEDIA_COMPONENTS } from './media';
import { FORM_COMPONENTS } from './form';

register(...LAYOUT_COMPONENTS, ...CONTENT_COMPONENTS, ...MEDIA_COMPONENTS, ...FORM_COMPONENTS);

export * from './registry';
export { ICONS, ICON_NAMES, iconPath } from './icons';
export { EMPTY_SLOT_CSS } from './helpers';
export { TEMPLATES, templatesByCategory, type Template } from './templates';
