<?php
/**
 * Plugin Name: Elementor MCP Server
 * Description: WordPress companion plugin for the Elementor MCP server — registry introspection, Document API writes, media, preview tokens, cache invalidation, snapshots.
 * Version: 0.1.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Requires Plugins: elementor
 * License: GPL-2.0-or-later
 * Text Domain: emcp
 */

defined( 'ABSPATH' ) || exit;

define( 'EMCP_VERSION', '0.1.0' );
define( 'EMCP_PLUGIN_FILE', __FILE__ );
define( 'EMCP_PLUGIN_DIR', __DIR__ );

if ( version_compare( PHP_VERSION, '8.1', '<' ) ) {
	add_action(
		'admin_notices',
		static function (): void {
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html__( 'Elementor MCP Server requires PHP 8.1 or higher and has not been loaded.', 'emcp' )
			);
		}
	);
	return;
}

$emcp_autoload = EMCP_PLUGIN_DIR . '/vendor/autoload.php';

if ( ! file_exists( $emcp_autoload ) ) {
	add_action(
		'admin_notices',
		static function (): void {
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html__( 'Elementor MCP Server: dependencies are not installed. Run "composer install" in the plugin directory.', 'emcp' )
			);
		}
	);
	return;
}

require_once $emcp_autoload;

// Elementor registers its widgets during plugins_loaded; booting at the
// default priority (10) sees an empty widgets_manager. Priority 20 runs after.
add_action( 'plugins_loaded', [ \EMCP\Plugin::class, 'boot' ], 20 );

register_activation_hook( __FILE__, [ \EMCP\Plugin::class, 'activate' ] );
register_deactivation_hook( __FILE__, [ \EMCP\Plugin::class, 'deactivate' ] );
