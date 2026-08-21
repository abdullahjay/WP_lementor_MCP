<?php
/**
 * Fires only on "Delete" from the Plugins screen, never on deactivate.
 *
 * EMCP-003 introduces no persistent state (no options, no postmeta prefix,
 * no custom tables), so there is nothing to remove yet. Any later task that
 * adds one (EMCP-013's schema, credential storage, the ledger, etc.) must
 * extend this file in the same change that introduces the data.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
