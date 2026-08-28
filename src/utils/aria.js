/**
 * The ARIA vocabulary, shared by every check that has to decide whether a role
 * or an aria-* attribute exists. One list, so a name added to WAI-ARIA is not
 * reported as invalid by whichever scanner happens to hold a shorter copy.
 * Sources: WAI-ARIA 1.2 plus the index-text attributes of 1.3, DPUB-ARIA 1.0,
 * WAI-ARIA Graphics 1.0.
 */

/** Every aria-* attribute browsers accept, from WAI-ARIA 1.2 and 1.3. */
const ARIA_ATTRIBUTES = [
  'aria-activedescendant',
  'aria-atomic',
  'aria-autocomplete',
  'aria-braillelabel',
  'aria-brailleroledescription',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colindextext',
  'aria-colspan',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-description',
  'aria-details',
  'aria-disabled',
  'aria-dropeffect',
  'aria-errormessage',
  'aria-expanded',
  'aria-flowto',
  'aria-grabbed',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-keyshortcuts',
  'aria-label',
  'aria-labelledby',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-owns',
  'aria-placeholder',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-roledescription',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowindextext',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
];

/** Every role name defined by WAI-ARIA 1.2, including the document structure roles. */
const ARIA_ROLES = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'associationlist',
  'associationlistitemkey',
  'associationlistitemvalue',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'command',
  'comment',
  'complementary',
  'composite',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'image',
  'img',
  'input',
  'insertion',
  'landmark',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'mark',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'range',
  'region',
  'roletype',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'section',
  'sectionhead',
  'select',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'structure',
  'subscript',
  'suggestion',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
  'widget',
  'window',
];

/**
 * Role prefixes of the published ARIA role modules. Their members are valid
 * role names wherever ARIA is, and listing all of them adds nothing.
 */
const ARIA_ROLE_MODULE_PREFIXES = ['doc-', 'graphics-'];

/**
 * Is this the value of a `role` attribute that a user agent can resolve?
 * `role` takes a space separated fallback list, and the element takes the
 * first name it understands, so one known name is enough.
 * @param {string} value - raw role attribute value
 * @returns {boolean}
 */
function isValidRoleValue(value) {
  const tokens = String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some(
    (token) =>
      ARIA_ROLES.includes(token) || ARIA_ROLE_MODULE_PREFIXES.some((p) => token.startsWith(p))
  );
}

module.exports = {
  ARIA_ATTRIBUTES,
  ARIA_ROLES,
  ARIA_ROLE_MODULE_PREFIXES,
  isValidRoleValue,
};
