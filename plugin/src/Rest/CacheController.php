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

		// V4 atomic widgets keep a SEPARATE local-style CSS cache
		// (Atomic_Styles_Manager / CSS_Files_Manager), never touched by the
		// legacy Post_CSS deletion above. Confirmed live: without this, a
		// site whose generation_default is v4 keeps serving pre-edit CSS
		// indefinitely even after the two calls above. Clears both the
		// "frontend" and "preview" context variants (a bare ['local',
		// $post_id] path clears the whole subtree — confirmed against
		// Atomic_Widget_Styles::invalidate_cache()'s own equivalent call).
		if ( did_action( 'elementor/loaded' ) && class_exists( '\Elementor\Modules\AtomicWidgets\Styles\Atomic_Styles_Manager' ) ) {
			do_action( 'elementor/atomic-widgets/styles/clear', [ 'local', $post_id ] );
		}

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
	 * accepts it wherever `WP_HOME`/siteurl doesn't match how this request
	 * reaches the server — the exact same mechanism `render_preview` itself
	 * relies on, not a separate bypass.
	 *
	 * **Two-attempt strategy, generic across hosting environments — not
	 * assuming any one of them.** The correct, and by far most common, case
	 * is a normal production/shared/managed WordPress host: `home_url()`'s
	 * own scheme and host are exactly how the server reaches itself, and a
	 * plain loopback to that URL just works, same as any real visitor's
	 * request. Only a specific class of *containerized dev environment* —
	 * where the configured site URL points at a host-mapped port
	 * unreachable from inside the container itself (CLAUDE.md's WP_HOME/
	 * siteurl gotcha; confirmed live in exactly that setup, this call
	 * silently returned `warmed: false` on every attempt all session) —
	 * needs a fallback at all. Trying `home_url()` first, and falling back
	 * to a same-machine loopback (`127.0.0.1`, plain HTTP, explicit `Host`
	 * header so WordPress still routes to the right site) only if that
	 * fails, means this works correctly out of the box on a real website
	 * and *also* self-heals for this dev-container quirk — never the
	 * reverse assumption.
	 */
	private function warm( int $post_id ): bool {
		$relative_path   = wp_make_link_relative( (string) get_permalink( $post_id ) );
		$configured_host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$scheme          = (string) wp_parse_url( home_url(), PHP_URL_SCHEME ) ?: ( is_ssl() ? 'https' : 'http' );

		$token = ( new PreviewTokenService() )->issue( $post_id, 1 )['token'];

		$primary_url = "{$scheme}://{$configured_host}{$relative_path}";
		if ( $this->request( $primary_url, $token ) ) {
			return true;
		}

		// Fallback: same-machine loopback, for environments where the
		// configured site URL isn't reachable from the server itself.
		$fallback_url = "http://127.0.0.1{$relative_path}";
		return $this->request( $fallback_url, $token, $configured_host );
	}

	private function request( string $url, string $token, ?string $host_header = null ): bool {
		$headers = [ 'X-EMCP-Preview-Token' => $token ];
		if ( null !== $host_header && '' !== $host_header ) {
			$headers['Host'] = $host_header;
		}

		$response = wp_remote_get( // phpcs:ignore WordPress.WP.AlternativeFunctions.wp_remote_get_wp_remote_get
			$url,
			[
				'timeout' => 10,
				'headers' => $headers,
			]
		);

		return ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response );
	}
}
