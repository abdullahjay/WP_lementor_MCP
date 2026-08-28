<?php

declare(strict_types=1);

namespace EMCP;

use EMCP\Admin\PublishApprovalPage;
use EMCP\Approvals\ApprovalTokenService;
use EMCP\PreviewTokens\PreviewTokenService;
use EMCP\Rest\RestController;
use EMCP\Snapshots\SnapshotService;
use EMCP\Templates\TemplateService;

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

		// EMCP-034: see PreviewTokenService::verify_render_token()'s docblock.
		add_filter( 'redirect_canonical', [ self::class, 'maybe_skip_canonical_redirect_for_renderer' ] );

		// EMCP-047 / D3: the one admin-only, cookie-auth-only screen this
		// plugin has — see PublishApprovalPage's own docblock for why.
		PublishApprovalPage::register();
	}

	/**
	 * @param string|false $redirect_url
	 * @return string|false
	 */
	public static function maybe_skip_canonical_redirect_for_renderer( $redirect_url ) {
		$token = $_SERVER['HTTP_X_EMCP_PREVIEW_TOKEN'] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

		if ( ! is_string( $token ) || '' === $token ) {
			return $redirect_url;
		}

		if ( ( new PreviewTokenService() )->verify_render_token( $token ) ) {
			return false;
		}

		return $redirect_url;
	}

	public static function activate(): void {
		// EMCP-033/037: both dbDelta() calls are idempotent — safe to call
		// on every activation, including plugin updates.
		PreviewTokenService::create_table();
		SnapshotService::create_table();
		ApprovalTokenService::create_table();
		TemplateService::create_table();
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
