<?php

declare(strict_types=1);

namespace EMCP;

use EMCP\Rest\RestController;

defined( 'ABSPATH' ) || exit;

/**
 * Boot entry point. Wires up domain services and REST routes as later tasks
 * (EMCP-004+) add them; EMCP-003 itself only proves clean activation and the
 * Elementor-present/-absent boot paths.
 */
final class Plugin {

	public static function boot(): void {
		if ( ! did_action( 'elementor/loaded' ) ) {
			add_action( 'admin_notices', [ self::class, 'render_missing_elementor_notice' ] );
			return;
		}

		add_action( 'rest_api_init', [ new RestController(), 'register_routes' ] );
	}

	public static function activate(): void {
		// No persistent state introduced yet; reserved for future migrations.
	}

	public static function deactivate(): void {
		// No cleanup needed on deactivation; uninstall.php handles data removal.
	}

	public static function render_missing_elementor_notice(): void {
		printf(
			'<div class="notice notice-error"><p>%s</p></div>',
			esc_html__( 'Elementor MCP Server requires Elementor to be installed and active. Its features are currently disabled.', 'emcp' )
		);
	}
}
