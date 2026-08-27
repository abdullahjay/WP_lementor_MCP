<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\PreviewTokens\PreviewTokenService;

defined( 'ABSPATH' ) || exit;

/**
 * `POST /wp-json/emcp/v1/cache/invalidate` — Blueprints.md §6, "Element
 * cache + CSS, with warm-up".
 *
 * `Document::save()` (confirmed live, EMCP-035) already clears both of
 * these as an unconditional side effect of every save that goes through
 * it — this endpoint exists for the one write path that deliberately
 * doesn't: **snapshot restore**, which writes `_elementor_data` directly
 * (CLAUDE.md's slashing gotcha: "Only snapshot restore should ever write
 * directly"). Any future direct-meta writer needs this too, not just
 * snapshot restore specifically — hence a standalone route, not logic
 * folded into one caller.
 */
final class CacheController {

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

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to invalidate cache for this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		\Elementor\Core\Files\CSS\Post::create( $post_id )->delete();
		delete_post_meta( $post_id, \Elementor\Core\Base\Document::CACHE_META_KEY );

		$warm_param = $request->get_param( 'warm' );
		$should_warm = null === $warm_param ? true : (bool) $warm_param;

		$warmed = $should_warm && $this->warm( $post_id );

		return new \WP_REST_Response(
			[
				'post_id'     => $post_id,
				'invalidated' => true,
				'warmed'      => $warmed,
			],
			200
		);
	}

	/**
	 * A real HTTP loopback request against the post's own front end —
	 * regenerating the CSS file and the Element Cache entry synchronously,
	 * the same way any real visitor's first request after a save does
	 * (`Css\Base::enqueue()`'s `is_update_required()` check, confirmed live
	 * EMCP-035). Carries a real, freshly-issued preview token so
	 * `Plugin::maybe_skip_canonical_redirect_for_renderer()` (EMCP-034)
	 * accepts it on this sandbox's mismatched `WP_HOME`/siteurl — the exact
	 * same mechanism `render_preview` itself relies on, not a separate
	 * bypass.
	 */
	private function warm( int $post_id ): bool {
		$relative_path = wp_make_link_relative( (string) get_permalink( $post_id ) );
		$host          = isset( $_SERVER['HTTP_HOST'] ) ? (string) $_SERVER['HTTP_HOST'] : (string) wp_parse_url( home_url(), PHP_URL_HOST ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$scheme        = is_ssl() ? 'https' : 'http';
		$url           = "{$scheme}://{$host}{$relative_path}";

		$token = ( new PreviewTokenService() )->issue( $post_id, 1 )['token'];

		$response = wp_remote_get( // phpcs:ignore WordPress.WP.AlternativeFunctions.wp_remote_get_wp_remote_get
			$url,
			[
				'timeout' => 10,
				'headers' => [ 'X-EMCP-Preview-Token' => $token ],
			]
		);

		return ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response );
	}
}
