<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\PreviewTokens\PreviewTokenService;

defined( 'ABSPATH' ) || exit;

/**
 * POST /wp-json/emcp/v1/preview-token — Blueprints.md §6.5.
 *
 * `Capabilities::can_read()` (the route's `permission_callback`) is the
 * same generic header-present/`edit_posts` gate every other route uses —
 * but §6.5 explicitly says this endpoint "does its own `read_post` gating
 * rather than leaning on WordPress's preview path," which means a
 * **per-post** check the generic gate can't express. That happens here,
 * inside the handler, against the specific `post_id` in the request body.
 */
final class PreviewTokenController {

	public function handle( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post_id = (int) $request->get_param( 'post_id' );

		if ( $post_id <= 0 ) {
			return new \WP_Error(
				'emcp_invalid_post_id',
				__( 'A valid "post_id" is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		if ( ! get_post( $post_id ) ) {
			return new \WP_Error(
				'emcp_post_not_found',
				__( 'No post exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		// The endpoint's own read_post gating — not WordPress's built-in
		// preview path (Blueprints.md §6.5), and not just the route's
		// generic edit_posts check either.
		if ( ! current_user_can( 'read_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to preview this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$ttl_param   = $request->get_param( 'ttl_minutes' );
		$ttl_minutes = is_numeric( $ttl_param ) ? (int) $ttl_param : null;

		$service = new PreviewTokenService();
		$result  = $service->issue( $post_id, $ttl_minutes );

		$response = new \WP_REST_Response(
			[
				'token'      => $result['token'],
				'expires_at' => $result['expires_at'],
				'post_id'    => $post_id,
			],
			201
		);

		// Blueprints.md §6.5: "sent as a header where possible; if a query
		// parameter is unavoidable, responses set Referrer-Policy:
		// no-referrer and Cache-Control: no-store, private." Set
		// unconditionally on the issuance response itself — the token is
		// sensitive the moment it exists, regardless of how the caller
		// later chooses to transmit it to the renderer.
		$response->header( 'Referrer-Policy', 'no-referrer' );
		$response->header( 'Cache-Control', 'no-store, private' );

		return $response;
	}
}
