<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\Media\MediaService;

defined( 'ABSPATH' ) || exit;

/**
 * `GET/POST /wp-json/emcp/v1/media` — Blueprints.md §6, EMCP-063.
 */
final class MediaController {

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		return new \WP_REST_Response(
			[ 'media' => ( new MediaService() )->list_all() ],
			200
		);
	}

	/**
	 * `{ url }` (server-side fetch, egress-filtered) or a multipart `file`
	 * upload — never both, and at least one is required. Every real
	 * validation step (content-derived MIME, category denial, pixel cap,
	 * EXIF strip, unique filename) lives in `MediaService`, identically for
	 * both paths.
	 */
	public function create( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to upload media.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$files   = $request->get_file_params();
		$url     = $request->get_param( 'url' );
		$has_url = is_string( $url ) && '' !== $url;
		$has_file = isset( $files['file'] );

		if ( $has_url === $has_file ) {
			return new \WP_Error(
				'emcp_invalid_request',
				__( 'Provide exactly one of "url" or a multipart "file" upload.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		$service = new MediaService();

		$result = $has_file
			? $service->upload_file( $files['file'] )
			: $service->upload_from_url( $url, is_string( $request->get_param( 'filename' ) ) ? $request->get_param( 'filename' ) : null );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new \WP_REST_Response( $result, 201 );
	}
}
