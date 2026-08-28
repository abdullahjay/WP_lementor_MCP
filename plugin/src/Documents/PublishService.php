<?php

declare(strict_types=1);

namespace EMCP\Documents;

defined( 'ABSPATH' ) || exit;

/**
 * `publish_draft` (Blueprints.md §7.5, EMCP-047). Shared between the
 * wp-admin approval screen (`EMCP\Admin\PublishApprovalPage`, which needs
 * to know the exact content hash to bind an approval token to) and
 * `DocumentsController::publish()` (which needs the same resolution again
 * at redemption time, then actually performs it) — extracted here so the
 * two can never independently drift on what "the current content" means,
 * the same reasoning `DocumentHasher` already exists for.
 *
 * `find_or_create_autosave()` is a third copy of the same small method
 * already duplicated in `DocumentsController` and `SnapshotService`
 * (EMCP-045) — kept separate rather than factored into a shared dependency,
 * matching this codebase's own established precedent for that exact
 * decision (`SnapshotService`'s docblock: "kept as a separate copy rather
 * than a shared dependency since the two classes don't otherwise share
 * one").
 */
final class PublishService {

	/**
	 * The content a `publish_draft` call would act on *right now* — the
	 * post's live autosave if it's currently published (mirroring
	 * `edit_elements`'s EMCP-045 source resolution exactly, since this is
	 * "whatever `edit_elements` would target"), or the post itself if it
	 * isn't published yet (nothing to promote from — the post *is* the
	 * draft).
	 *
	 * @return array{source: 'parent'|'autosave', target_id: int, hash: string}|\WP_Error
	 */
	public function resolve_current_state( int $post_id ): array|\WP_Error {
		$post = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			return new \WP_Error( 'emcp_document_not_found', __( 'No post exists with that ID.', 'emcp' ), [ 'status' => 404 ] );
		}

		$source    = 'publish' === $post->post_status ? 'autosave' : 'parent';
		$target_id = $post_id;

		if ( 'autosave' === $source ) {
			$autosave_post = $this->find_or_create_autosave( $post_id );

			if ( null === $autosave_post ) {
				return new \WP_Error(
					'emcp_no_autosave',
					__( 'No autosave revision exists for this post, and one could not be created.', 'emcp' ),
					[ 'status' => 404 ]
				);
			}

			$target_id = $autosave_post->ID;
		}

		$elements      = $this->decode_json_meta( $target_id, '_elementor_data' );
		$page_settings = $this->decode_json_meta( $target_id, '_elementor_page_settings' );

		return [
			'source'    => $source,
			'target_id' => $target_id,
			'hash'      => DocumentHasher::hash( $elements, $page_settings ),
		];
	}

	/**
	 * Actually promotes the resolved state onto the live, visible post. Two
	 * genuinely different operations depending on `resolve_current_state()`'s
	 * `source`, not one — solution.md §5.4's write-posture table:
	 *
	 * - `'parent'` (post was never published): a normal WordPress
	 *   draft→publish transition (`wp_publish_post()`) — there is no
	 *   separate autosave to promote, since a non-published post's writes
	 *   already land directly on the parent (EMCP-045's own invariant).
	 * - `'autosave'` (post is already published, with pending autosave
	 *   edits): copies `_elementor_data`/`_elementor_page_settings` from the
	 *   autosave onto the parent via `update_metadata()` directly — never
	 *   `update_post_meta()`, though the *destination* here is a normal
	 *   post (not a revision) so the redirect gotcha (CLAUDE.md) wouldn't
	 *   actually bite in this direction; used anyway for consistency with
	 *   every other direct meta write this plugin makes, and because
	 *   `Plugin::$instance->db->copy_elementor_meta()` is the same call already
	 *   proven correct for the reverse direction (EMCP-045).
	 *
	 * Deliberately does **not** invalidate cache itself — same convention
	 * `SnapshotService::restore()` follows (CLAUDE.md: "Only snapshot
	 * restore should ever write directly" — this is the other such path):
	 * the caller (Node) follows with `POST /cache/invalidate`.
	 *
	 * @return array{post_id: int, published: bool}|\WP_Error
	 */
	public function promote( int $post_id ): array|\WP_Error {
		$state = $this->resolve_current_state( $post_id );

		if ( is_wp_error( $state ) ) {
			return $state;
		}

		if ( 'parent' === $state['source'] ) {
			$result = wp_update_post( [ 'ID' => $post_id, 'post_status' => 'publish' ], true );

			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return [ 'post_id' => $post_id, 'published' => true ];
		}

		\Elementor\Plugin::$instance->db->copy_elementor_meta(
			$state['target_id'],
			$post_id,
			[ '_elementor_data', '_elementor_page_settings' ]
		);

		return [ 'post_id' => $post_id, 'published' => true ];
	}

	private function find_or_create_autosave( int $post_id ): ?\WP_Post {
		if ( ! class_exists( '\Elementor\Plugin' ) ) {
			return null;
		}

		$document = \Elementor\Plugin::$instance->documents->get( $post_id );

		if ( ! $document ) {
			return null;
		}

		$autosave = $document->get_autosave( 0, true );

		if ( ! $autosave instanceof \Elementor\Core\Base\Document ) {
			return null;
		}

		$autosave_post = $autosave->get_post();

		return $autosave_post instanceof \WP_Post ? $autosave_post : null;
	}

	private function decode_json_meta( int $post_id, string $key ): array {
		$raw = get_post_meta( $post_id, $key, true );

		if ( ! is_string( $raw ) || '' === $raw ) {
			return [];
		}

		$decoded = json_decode( $raw, true );

		return is_array( $decoded ) ? $decoded : [];
	}
}
