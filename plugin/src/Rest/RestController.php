<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the emcp/v1 REST namespace (Blueprints.md §6). Hooked to
 * rest_api_init from Plugin::boot(), which only runs once Elementor is
 * confirmed loaded — every route here can assume \Elementor\Plugin::$instance
 * exists.
 */
final class RestController {

	public const NAMESPACE = 'emcp/v1';

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/site',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new SiteController(), 'handle' ],
				'permission_callback' => [ Capabilities::class, 'can_read_site' ],
			]
		);
	}
}
