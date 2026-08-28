<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\Templates\TemplateService;

defined( 'ABSPATH' ) || exit;

/**
 * `GET/POST /wp-json/emcp/v1/templates` — Blueprints.md §6, EMCP-060.
 */
final class TemplatesController {

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$templates = ( new TemplateService() )->list_all();

		return new \WP_REST_Response(
			[
				'templates' => $templates,
				'count'     => count( $templates ),
			],
			200
		);
	}

	/**
	 * `{ name, spec, source_post_id? }` — the plugin stores `spec` opaquely
	 * (§6.1: "no DSL... no MCP awareness"); it does not validate its shape,
	 * that's `parseSpec()`'s job (EMCP-048), already run Node-side by
	 * `save_as_template` before this route is ever called.
	 */
	public function create( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$name = $request->get_param( 'name' );
		$spec = $request->get_param( 'spec' );

		if ( ! is_string( $name ) || '' === trim( $name ) ) {
			return new \WP_Error(
				'emcp_invalid_request',
				__( 'A non-empty "name" is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		if ( ! is_array( $spec ) || [] === $spec ) {
			return new \WP_Error(
				'emcp_invalid_request',
				__( 'A non-empty "spec" object is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to save templates.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$source_post_id = $request->get_param( 'source_post_id' );
		$source_post_id = is_numeric( $source_post_id ) ? (int) $source_post_id : null;

		$result = ( new TemplateService() )->save( $name, $spec, $source_post_id );

		return new \WP_REST_Response( $result, 201 );
	}
}
