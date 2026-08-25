<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * `emcp/v1/documents` routes — Blueprints.md §6.
 *
 * `handle()` is `GET /documents` ("List pages"): a "document" here means a
 * post Elementor has actually built, not every post on the site — filtered
 * on `_elementor_edit_mode = 'builder'` (CLAUDE.md — required or the page
 * renders as empty theme content, so it's also the correct signal for
 * "this post has real Elementor content"). Deliberately thin: no native
 * elements, no generation, no document hash — those are `show()`'s job
 * (`GET /documents/{id}`, EMCP-024), which reads `_elementor_data` per
 * document; doing that for every row here would be wasteful for what's
 * meant to be a lightweight listing.
 *
 * `show()` deliberately does **not** return a `generation` field, even
 * though Blueprints.md §6's route table names one — per-node generation
 * detection (CLAUDE.md's most emphasized gotcha: keyed on `widgetType`'s
 * `e-` prefix plus `styles`/`version`, never `elType` alone, and a single
 * document can genuinely mix generations) already exists as tested,
 * fixture-proven TypeScript (`server/src/domain/detect.ts`, EMCP-019).
 * Reimplementing that walk in PHP would be duplicated logic with a real
 * risk of drift between two independent implementations of the same rule
 * — solution.md §6.1's "the plugin stays thin" cuts the other way here:
 * `get_page_structure` (EMCP-024's Node half) derives generation per node
 * from the raw elements this route returns, using the one implementation
 * that already exists and is already fixture-tested.
 */
final class DocumentsController {

	// Elementor documents realistically only need to be listed and sorted
	// by recency, not paged through — page counts on the sandboxes and any
	// realistic client site are small. Revisit with real pagination if a
	// site with an unusually large page count ever needs this.
	private const MAX_RESULTS = 200;

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		return new \WP_REST_Response( $this->build_payload(), 200 );
	}

	private function build_payload(): array {
		$query = new \WP_Query(
			[
				'post_type'      => 'any',
				'post_status'    => [ 'publish', 'future', 'draft', 'pending', 'private' ],
				'posts_per_page' => self::MAX_RESULTS,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'meta_query'     => [ // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					[
						'key'   => '_elementor_edit_mode',
						'value' => 'builder',
					],
				],
				'no_found_rows'  => true,
			]
		);

		$documents = array_map( [ $this, 'describe_post' ], $query->posts );

		return [
			'documents' => $documents,
			'count'     => count( $documents ),
		];
	}

	private function describe_post( \WP_Post $post ): array {
		return [
			'id'       => $post->ID,
			'title'    => get_the_title( $post ),
			'status'   => $post->post_status,
			'type'     => $post->post_type,
			'modified' => get_post_modified_time( 'c', true, $post ),
			'edit_url' => get_edit_post_link( $post->ID, 'raw' ),
		];
	}

	/**
	 * `GET /documents/{id}` — native elements, meta, document hash.
	 * `?source=autosave|parent` (Blueprints.md §6.3), default `parent` —
	 * `source=autosave` is wired but genuinely untested live: no write path
	 * exists yet (`PUT /documents/{id}` is a later task) so no sandbox has
	 * ever produced a real autosave revision to read back. Documented here
	 * rather than silently assumed correct.
	 */
	public function show( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post_id = (int) $request->get_param( 'id' );
		$post    = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'No post exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to read this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		if ( 'builder' !== get_post_meta( $post_id, '_elementor_edit_mode', true ) ) {
			return new \WP_Error(
				'emcp_not_an_elementor_document',
				__( 'This post was not built with Elementor.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$source     = 'autosave' === $request->get_param( 'source' ) ? 'autosave' : 'parent';
		$data_owner = $source === 'autosave' ? $this->find_autosave( $post_id ) : $post;

		if ( null === $data_owner ) {
			return new \WP_Error(
				'emcp_no_autosave',
				__( 'No autosave revision exists for this post.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$elements = $this->decode_elementor_data( $data_owner->ID );

		$meta = [
			'edit_mode'     => get_post_meta( $post_id, '_elementor_edit_mode', true ),
			'template_type' => get_post_meta( $post_id, '_elementor_template_type', true ),
			'version'       => get_post_meta( $post_id, '_elementor_version', true ),
			'page_settings' => $this->decode_json_meta( $post_id, '_elementor_page_settings' ),
		];

		return new \WP_REST_Response(
			[
				'id'             => $post_id,
				'source'         => $source,
				'elements'       => $elements,
				'meta'           => $meta,
				'document_hash'  => $this->document_hash( $elements, $meta['page_settings'] ),
			],
			200
		);
	}

	private function find_autosave( int $parent_id ): ?\WP_Post {
		$user_id  = get_current_user_id();
		$autosave = wp_get_post_autosave( $parent_id, $user_id );

		return $autosave instanceof \WP_Post ? $autosave : null;
	}

	private function decode_elementor_data( int $post_id ): array {
		return $this->decode_json_meta( $post_id, '_elementor_data' );
	}

	private function decode_json_meta( int $post_id, string $key ): array {
		$raw = get_post_meta( $post_id, $key, true );

		if ( ! is_string( $raw ) || '' === $raw ) {
			return [];
		}

		$decoded = json_decode( $raw, true );

		return is_array( $decoded ) ? $decoded : [];
	}

	/**
	 * Blueprints.md §6.4: "covers the element tree and page settings,
	 * computed server-side over a canonical serialization." Canonical here
	 * means: associative (object-shaped) sub-arrays get their keys sorted
	 * before hashing, so key order never changes the hash; list-shaped
	 * arrays (the actual element tree — order is meaningful there) are left
	 * alone. `array_is_list()` (PHP 8.1+, matches this plugin's minimum)
	 * is exactly the distinction this needs.
	 */
	private function document_hash( array $elements, array $page_settings ): string {
		$canonical = $this->canonicalize(
			[
				'elements'      => $elements,
				'page_settings' => $page_settings,
			]
		);

		return hash( 'sha256', (string) wp_json_encode( $canonical ) );
	}

	private function canonicalize( mixed $value ): mixed {
		if ( ! is_array( $value ) ) {
			return $value;
		}

		if ( array_is_list( $value ) ) {
			return array_map( [ $this, 'canonicalize' ], $value );
		}

		ksort( $value );

		return array_map( [ $this, 'canonicalize' ], $value );
	}
}
