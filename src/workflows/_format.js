'use strict';

// Shared column widths so every "matched components" listing lines up the same
// way, whether printed by analyze, adopt, or create.
const ID_PAD = 24;
const MATCH_LABEL_PAD = 22;

// Partial matches only list their missing rules when the set is small enough to
// be actionable; a long tail is noise, not guidance.
const MAX_MISSING_TO_LIST = 5;

/**
 * Format the "matched components" table shared by analyze/adopt/create.
 *
 * @param {object[]} components - Matched components ({ id, matched, total, classification, unmatched })
 * @param {object} [opts]
 * @param {boolean} [opts.showMissing=false] - Append "(missing: ...)" for small partial gaps
 * @returns {string} Multi-line table (each line newline-terminated)
 */
function formatMatchedComponentsTable(components, { showMissing = false } = {}) {
  let out = '';
  for (const comp of components) {
    const status = comp.classification === 'full' ? '✓ full' : '✗ partial';
    const matchLabel = `${comp.positiveMatched ?? comp.matched.length}/${comp.total} rules`;
    let line = `  ${comp.id.padEnd(ID_PAD)} ${matchLabel.padEnd(MATCH_LABEL_PAD)} ${status}`;
    if (showMissing
      && comp.classification === 'partial'
      && Array.isArray(comp.unmatched)
      && comp.unmatched.length > 0) {
      // Only show positive missing rules — negation patterns (!...) are
      // structural exemptions, not rules the user should add.
      const positiveUnmatched = comp.unmatched.filter(line => !line.trim().startsWith('!'));
      if (positiveUnmatched.length > 0 && positiveUnmatched.length <= MAX_MISSING_TO_LIST) {
        line += ` (missing: ${positiveUnmatched.join(', ')})`;
      }
    }
    out += `${line}\n`;
  }
  return out;
}

/**
 * Build the "Matched N known component(s)" block as a string.
 * Same wording and spacing as writeMatchedComponentsBlock; returns the
 * formatted string so callers can compose it with other output (e.g. a
 * preceding "Analyzing ..." line).
 *
 * @param {object[]} components - Matched components to display
 * @param {object} [opts]
 * @param {string} [opts.label='Matched'] - Header prefix
 * @returns {string}
 */
function formatMatchedComponentsHeader(components, { label = 'Matched' } = {}) {
  if (!components || components.length === 0) return '';
  return `${label} ${components.length} known component(s):\n${formatMatchedComponentsTable(components)}\n`;
}

/**
 * Write the "Matched N known component(s)" block (header + table +
 * trailing blank line) to a writable stream. When the list is empty, writes
 * nothing — callers don't have to guard the count themselves.
 *
 * Shared by adopt, create component, and the interactive create flow so the
 * exact wording and spacing stays consistent across all three entry points.
 *
 * @param {object[]} components - Matched components to display
 * @param {object} opts
 * @param {object} opts.stdout - Writable stream (required — every caller passes it explicitly)
 * @param {string} [opts.label='Matched'] - Header prefix
 */
function writeMatchedComponentsBlock(components, { stdout, label = 'Matched' } = {}) {
  if (!components || components.length === 0) return;
  stdout.write(`${label} ${components.length} known component(s):\n`);
  stdout.write(formatMatchedComponentsTable(components));
  stdout.write('\n');
}

module.exports = {
  formatMatchedComponentsTable,
  formatMatchedComponentsHeader,
  writeMatchedComponentsBlock,
  ID_PAD,
  MATCH_LABEL_PAD,
  MAX_MISSING_TO_LIST
};
