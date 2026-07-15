'use strict';

/**
 * Re-export from core/resolver-factory. The canonical location is core/ because
 * buildResolver and applyUserRootDefault depend only on core/ path constants
 * and the definition resolver — not on any CLI-specific code. Workflows and
 * interactive modules previously imported from this cli/ file, creating an
 * upward dependency (workflows → cli). The move to core/ eliminates that
 * layer violation while keeping this re-export for any external consumer
 * that imported from the old path.
 */
module.exports = require('../core/resolver-factory');
