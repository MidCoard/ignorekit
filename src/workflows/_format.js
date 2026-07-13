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
    const matchLabel = `${comp.matched.length}/${comp.total} rules`;
    let line = `  ${comp.id.padEnd(ID_PAD)} ${matchLabel.padEnd(MATCH_LABEL_PAD)} ${status}`;
    if (showMissing
      && comp.classification === 'partial'
      && Array.isArray(comp.unmatched)
      && comp.unmatched.length > 0
      && comp.unmatched.length <= MAX_MISSING_TO_LIST) {
      line += ` (missing: ${comp.unmatched.join(', ')})`;
    }
    out += `${line}\n`;
  }
  return out;
}

module.exports = { formatMatchedComponentsTable, ID_PAD, MATCH_LABEL_PAD, MAX_MISSING_TO_LIST };
