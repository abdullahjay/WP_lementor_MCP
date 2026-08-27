<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\Snapshots\SnapshotService;

defined( 'ABSPATH' ) || exit;

/**
 * `POST /wp-json/emcp/v1/snapshots` + `POST /wp-json/emcp/v1/snapshots/{id}/restore`
 * — Blueprints.md §6, EMCP-037.
 */
final class SnapshotsController {

	public function capture( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
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

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to snapshot this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$source = 'autosave' === $request->get_param( 'source' ) ? 'autosave' : 'parent';

		$result = ( new SnapshotService() )->capture( $post_id, $source );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new \WP_REST_Response( $result, 201 );
	}

	public function restore( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$snapshot_id = (int) $request->get_param( 'id' );

		if ( $snapshot_id <= 0 ) {
			return new \WP_Error(
				'emcp_invalid_snapshot_id',
				__( 'A valid snapshot id is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		$service = new SnapshotService();
		$post_id = $service->find_post_id( $snapshot_id );

		if ( null === $post_id ) {
			return new \WP_Error(
				'emcp_snapshot_not_found',
				__( 'No snapshot exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		// Checked *before* restore() ever writes anything — restoring is a
		// write, and this gate must run before that write happens, not after.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to restore this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$result = $service->restore( $snapshot_id );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new \WP_REST_Response( $result, 200 );
	}
}
