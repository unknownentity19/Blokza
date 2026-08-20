/**
 * Form primitives.
 *
 * Exported forms are real HTML forms. With no backend of its own the builder
 * supports the two ways a static site normally collects submissions:
 *   - POST to an external endpoint (Formspree, Basin, your own handler), or
 *   - Netlify Forms, which needs `data-netlify` plus a hidden `form-name`.
 * Both are declarative, so nothing depends on JavaScript at runtime.
 */

import type { ComponentDef, RenderProps } from '../core/types';
import { EmptySlot, Txt, bool, cls, editSlot, list, num, options, str } from './helpers';
import { safeHref } from '../core/sanitize';
import { slugify } from '../core/ids';
import { BUTTON_CSS, FORM_CONTROL_CSS } from './shared-css';

const INPUT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'password', 'date', 'time'] as const;

/** Field `name` attributes must be stable and safe; fall back to the label. */
function fieldName(p: RenderProps, fallback: string): string {
  const explicit = str(p.props, 'name');
  if (explicit) return slugify(explicit, fallback);
  const label = str(p.props, 'label');
  return slugify(label || fallback, fallback);
}

const CONTROL_CSS = FORM_CONTROL_CSS;

const REQUIRED_FIELD = { key: 'required', label: 'Required', type: 'toggle' as const };
const NAME_FIELD = {
  key: 'name',
  label: 'Field name',
  type: 'text' as const,
  help: 'The key this value is submitted under. Defaults to the label.',
};

export const form: ComponentDef = {
  type: 'form',
  label: 'Form',
  group: 'form',
  hint: 'Wraps inputs and posts them somewhere.',
  icon: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4',
  container: true,
  fields: [
    { key: 'name', label: 'Form name', type: 'text', placeholder: 'contact' },
    {
      key: 'action',
      label: 'Post to',
      type: 'url',
      placeholder: 'https://formspree.io/f/…',
      help: 'Leave empty when using Netlify Forms.',
    },
    { key: 'method', label: 'Method', type: 'select', options: options(['post', 'POST'], ['get', 'GET']) },
    {
      key: 'netlify',
      label: 'Netlify Forms',
      type: 'toggle',
      help: 'Adds the attributes Netlify needs to capture submissions with no server.',
    },
  ],
  defaults: { name: 'contact', action: '', method: 'post', netlify: false },
  defaultStyles: {
    base: { display: 'flex', flexDirection: 'column', gap: '18px', width: '100%', maxWidth: '520px' },
  },
  css: CONTROL_CSS,
  render: (p) => {
    const name = fieldName(p, 'contact');
    const action = str(p.props, 'action');
    const netlify = bool(p.props, 'netlify');
    return (
      <form
        {...p.attrs}
        name={name}
        {...(action ? { action: safeHref(action) } : {})}
        method={str(p.props, 'method', 'post') === 'get' ? 'get' : 'post'}
        {...(netlify ? { 'data-netlify': 'true' } : {})}
        // In the canvas a submit would navigate the iframe away from the page.
        {...(p.mode === 'canvas' ? { onSubmit: (e: React.FormEvent) => e.preventDefault() } : {})}
      >
        {netlify ? <input type="hidden" name="form-name" value={name} /> : null}
        {p.children}
        <EmptySlot p={p} label="Drop inputs here" />
      </form>
    );
  },
};

export const input: ComponentDef = {
  type: 'input',
  label: 'Input',
  group: 'form',
  hint: 'Single-line text field.',
  icon: 'M3 8h18v8H3zM7 12h6',
  inlineEditable: ['label'],
  fields: [
    { key: 'label', label: 'Label', type: 'text' },
    NAME_FIELD,
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: INPUT_TYPES.map((t) => ({ value: t, label: t })),
    },
    { key: 'placeholder', label: 'Placeholder', type: 'text' },
    REQUIRED_FIELD,
  ],
  defaults: { label: 'Email', name: '', type: 'email', placeholder: 'you@company.com', required: true },
  defaultStyles: { base: { width: '100%' } },
  css: CONTROL_CSS,
  render: (p) => {
    const name = fieldName(p, 'field');
    const type = str(p.props, 'type', 'text');
    const id = `f-${p.node.id}`;
    return (
      <div {...p.attrs}>
        <label htmlFor={id} {...editSlot(p, 'label')}>
          <Txt p={p} k="label" />
        </label>
        <input
          id={id}
          name={name}
          type={(INPUT_TYPES as readonly string[]).includes(type) ? type : 'text'}
          placeholder={str(p.props, 'placeholder')}
          required={bool(p.props, 'required')}
        />
      </div>
    );
  },
};

export const textarea: ComponentDef = {
  type: 'textarea',
  label: 'Text area',
  group: 'form',
  hint: 'Multi-line text field.',
  icon: 'M3 5h18v14H3zM7 9h10M7 13h10M7 17h6',
  inlineEditable: ['label'],
  fields: [
    { key: 'label', label: 'Label', type: 'text' },
    NAME_FIELD,
    { key: 'placeholder', label: 'Placeholder', type: 'text' },
    { key: 'rows', label: 'Rows', type: 'number', min: 2, max: 20, step: 1 },
    REQUIRED_FIELD,
  ],
  defaults: { label: 'Message', name: '', placeholder: 'How can we help?', rows: 5, required: false },
  defaultStyles: { base: { width: '100%' } },
  css: CONTROL_CSS,
  render: (p) => {
    const id = `f-${p.node.id}`;
    return (
      <div {...p.attrs}>
        <label htmlFor={id} {...editSlot(p, 'label')}>
          <Txt p={p} k="label" />
        </label>
        <textarea
          id={id}
          name={fieldName(p, 'message')}
          placeholder={str(p.props, 'placeholder')}
          rows={Math.max(2, Math.min(20, num(p.props, 'rows', 5)))}
          required={bool(p.props, 'required')}
          defaultValue=""
        />
      </div>
    );
  },
};

export const select: ComponentDef = {
  type: 'select',
  label: 'Select',
  group: 'form',
  hint: 'Dropdown of fixed choices.',
  icon: 'M3 8h18v8H3zM15 11l2 2 2-2',
  inlineEditable: ['label'],
  fields: [
    { key: 'label', label: 'Label', type: 'text' },
    NAME_FIELD,
    {
      key: 'items',
      label: 'Choices',
      type: 'list',
      itemFields: [{ key: 'text', label: 'Choice', type: 'text' }],
      itemDefaults: { text: 'New choice' },
    },
    REQUIRED_FIELD,
  ],
  defaults: {
    label: 'Budget',
    name: '',
    items: [{ text: 'Under $5k' }, { text: '$5k – $20k' }, { text: '$20k+' }],
    required: false,
  },
  defaultStyles: { base: { width: '100%' } },
  css: CONTROL_CSS,
  render: (p) => {
    const id = `f-${p.node.id}`;
    const items = list(p.props, 'items');
    return (
      <div {...p.attrs}>
        <label htmlFor={id} {...editSlot(p, 'label')}>
          <Txt p={p} k="label" />
        </label>
        <select id={id} name={fieldName(p, 'choice')} required={bool(p.props, 'required')} defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {items.map((item, index) => {
            const value = typeof item.text === 'string' ? item.text : '';
            return (
              <option key={index} value={value}>
                {value}
              </option>
            );
          })}
        </select>
      </div>
    );
  },
};

export const checkbox: ComponentDef = {
  type: 'checkbox',
  label: 'Checkbox',
  group: 'form',
  hint: 'Single opt-in box.',
  icon: 'M4 5h7v7H4zM15 8h5M15 12h5M7 8.5l1.5 1.5L11 7',
  inlineEditable: ['label'],
  fields: [
    { key: 'label', label: 'Label', type: 'textarea' },
    NAME_FIELD,
    REQUIRED_FIELD,
  ],
  defaults: { label: 'Send me occasional product updates', name: '', required: false },
  defaultStyles: { base: { width: '100%' } },
  css: CONTROL_CSS,
  render: (p) => {
    const id = `f-${p.node.id}`;
    return (
      <div {...p.attrs}>
        <input id={id} type="checkbox" name={fieldName(p, 'optin')} required={bool(p.props, 'required')} />
        <label htmlFor={id} {...editSlot(p, 'label')}>
          <Txt p={p} k="label" />
        </label>
      </div>
    );
  },
};

export const submit: ComponentDef = {
  type: 'submit',
  label: 'Submit',
  group: 'form',
  hint: 'Real submit button for a form.',
  icon: 'M4 9h16v6H4zM10 12h4',
  inlineEditable: ['label'],
  fields: [
    { key: 'label', label: 'Label', type: 'text' },
    {
      key: 'variant',
      label: 'Style',
      type: 'select',
      options: options(['primary', 'Primary'], ['secondary', 'Secondary'], ['ghost', 'Ghost']),
    },
  ],
  defaults: { label: 'Send message', variant: 'primary' },
  defaultStyles: { base: { width: 'fit-content', maxWidth: '100%' } },
  css: BUTTON_CSS,
  render: (p) => (
    <button
      {...p.attrs}
      className={cls(p, 'c-button', `c-button--${str(p.props, 'variant', 'primary').replace(/[^a-z]/gi, '') || 'primary'}`)}
      type={p.mode === 'export' ? 'submit' : 'button'}
      {...editSlot(p, 'label')}
    >
      <Txt p={p} k="label" />
    </button>
  ),
};

export const FORM_COMPONENTS = [form, input, textarea, select, checkbox, submit];
