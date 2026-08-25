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
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/registry/snapshot',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new RegistryController(), 'handle' ],
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new DocumentsController(), 'handle' ],
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/documents/(?P<id>\d+)',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new DocumentsController(), 'show' ],
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/widgets',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new WidgetsController(), 'handle' ],
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/widgets/(?P<type>[\w-]+)',
			[
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => [ new WidgetsController(), 'show' ],
				'permission_callback' => [ Capabilities::class, 'can_read' ],
			]
		);
	}
}
