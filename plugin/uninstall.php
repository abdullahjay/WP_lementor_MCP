<?php
/**
 * Fires only on "Delete" from the Plugins screen, never on deactivate.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require_once __DIR__ . '/vendor/autoload.php';

// EMCP-033: the preview-token nonce table and its signing secret.
\EMCP\PreviewTokens\PreviewTokenService::drop_table();
delete_option( \EMCP\PreviewTokens\PreviewTokenService::SECRET_OPTION );

// EMCP-037: the snapshots table.
\EMCP\Snapshots\SnapshotService::drop_table();
