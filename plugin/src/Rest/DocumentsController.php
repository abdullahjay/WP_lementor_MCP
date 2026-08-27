<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\Documents\DocumentHasher;

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
			'link'     => get_permalink( $post ), // EMCP-034: render_preview's navigation target.
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
				'status'         => $post->post_status, // EMCP-039: rollback's publish-state gate.
				'link'           => get_permalink( $post_id ),
				'elements'       => $elements,
				'meta'           => $meta,
				'document_hash'  => DocumentHasher::hash( $elements, $meta['page_settings'] ),
			],
			200
		);
	}

	// Blueprints.md §7.2: "maxItems is set and stated."
	private const MAX_OPERATIONS = 20;

	/**
	 * `PUT /documents/{id}` — the write path `edit_elements` (EMCP-043) calls.
	 * Started as EMCP-040's deliberately minimal single-element vehicle, then
	 * gained document-hash CAS (EMCP-041, §6.4) and post-lock refusal
	 * (EMCP-042, §6.3); EMCP-043 generalized the single `element_id`/
	 * `settings` pair into a **batch** of `operations`, matching Blueprints.md
	 * §7.2's real contract. Still not the full §6.3 contract in one respect:
	 * draft/autosave branching (EMCP-045) — always writes the **parent**
	 * directly via `Document::save()`, never an autosave.
	 *
	 * Each operation is a flat object with `op` as a required enum
	 * (Blueprints.md §7.2: "not a JSON Schema `oneOf` at item level, which is
	 * where models reliably produce malformed input"). Only `set_settings`
	 * exists today — a shallow merge onto one element's existing `settings`,
	 * not the deep merge `raw` (§2.8) needs. Structural validation (widget
	 * exists, setting key real, control conditions honoured — EMCP-036) is
	 * Node's job, run *before* this endpoint is ever called, same as before;
	 * this endpoint validates what only it can know (does this element id
	 * exist on this document *right now*), not widget schema.
	 *
	 * **Transaction semantics (Blueprints.md §7.2): all operations validate
	 * before any apply; the batch is one document save; a failure applies
	 * nothing.** Every operation's target element is located *before* any
	 * merge happens — if any is missing, the whole batch is refused with a
	 * diagnostic per missing operation, and `Document::save()` is never
	 * called. Once every element is confirmed to exist, every merge is
	 * applied in memory and saved in exactly one `Document::save()` call —
	 * never one save per operation, which would leave a partially-applied
	 * document visible between saves if a later operation failed.
	 *
	 * Lock and hash checks below are unchanged from EMCP-041/042 — see their
	 * own history in git blame / progress.md for the reasoning; they still
	 * run once, for the whole batch, before any operation is even located.
	 */
	public function update( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post_id       = (int) $request->get_param( 'id' );
		$operations    = $request->get_param( 'operations' );
		$expected_hash = $request->get_param( 'document_hash' );
		$override_lock = true === $request->get_param( 'override_lock' );

		if (
			! is_array( $operations ) || [] === $operations || count( $operations ) > self::MAX_OPERATIONS ||
			! is_string( $expected_hash ) || '' === $expected_hash
		) {
			return new \WP_Error(
				'emcp_invalid_request',
				sprintf(
					/* translators: %d: max operations */
					__( 'A "document_hash" and a non-empty "operations" array (max %d items) are required.', 'emcp' ),
					self::MAX_OPERATIONS
				),
				[ 'status' => 400 ]
			);
		}

		$shape_errors = $this->validate_operation_shapes( $operations );
		if ( [] !== $shape_errors ) {
			return new \WP_Error(
				'emcp_invalid_operation',
				__( 'One or more operations are malformed.', 'emcp' ),
				[ 'status' => 400, 'diagnostics' => $shape_errors ]
			);
		}

		$post = get_post( $post_id );

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
				__( 'The authenticated user is not permitted to edit this post.', 'emcp' ),
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

		if ( ! $override_lock ) {
			$locked_by = $this->check_lock( $post_id );

			if ( null !== $locked_by ) {
				return new \WP_REST_Response(
					[
						'id'        => $post_id,
						'locked_by' => $locked_by,
						'message'   => __( 'This post is currently being edited by another user. Pass "override_lock": true to write anyway.', 'emcp' ),
					],
					423
				);
			}
		}

		$elements      = $this->decode_elementor_data( $post_id );
		$page_settings = $this->decode_json_meta( $post_id, '_elementor_page_settings' );
		$current_hash  = DocumentHasher::hash( $elements, $page_settings );

		if ( $expected_hash !== $current_hash ) {
			// A flat `WP_REST_Response`, not `WP_Error` — every other error
			// path in this controller uses `WP_Error`, but a hash mismatch is
			// a structured "here is the current state, retry with this hash"
			// payload the caller needs to read data out of (`document_hash`),
			// not just an error code. Blueprints.md §6.4: "returning the new
			// hash... The write response returns the new hash" — kept the
			// same top-level `document_hash` key on both the 409 and the 200
			// so a caller doesn't need two different unwrapping paths.
			return new \WP_REST_Response(
				[
					'id'            => $post_id,
					'document_hash' => $current_hash,
					'message'       => __( 'The document has changed since the hash you sent was read. Re-fetch the document and retry with the current hash.', 'emcp' ),
				],
				409
			);
		}

		// Validate every operation's target element exists *before* applying
		// any of them — "all operations validate before any apply".
		$missing = [];
		foreach ( $operations as $index => $operation ) {
			if ( null === $this->find_element( $elements, (string) $operation['element_id'] ) ) {
				$missing[] = [
					'path'    => "operations[{$index}]",
					'code'    => 'ELEMENT_NOT_FOUND',
					'message' => sprintf(
						/* translators: %s: element id */
						__( 'No element with id "%s" exists on this document.', 'emcp' ),
						$operation['element_id']
					),
				];
			}
		}

		if ( [] !== $missing ) {
			return new \WP_Error(
				'emcp_element_not_found',
				__( 'One or more operations target an element that does not exist. Nothing was applied.', 'emcp' ),
				[ 'status' => 404, 'diagnostics' => $missing ]
			);
		}

		$results = [];
		foreach ( $operations as $operation ) {
			$element_id = (string) $operation['element_id'];
			$this->merge_settings_into_element( $elements, $element_id, $operation['settings'] );
			$results[] = [ 'element_id' => $element_id, 'applied' => true ];
		}

		$document = \Elementor\Plugin::$instance->documents->get( $post_id );

		if ( ! $document ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'Elementor could not load this document.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$document->save( [ 'elements' => $elements ] );

		return new \WP_REST_Response(
			[
				'id'            => $post_id,
				'results'       => $results,
				'document_hash' => DocumentHasher::hash( $elements, $page_settings ),
			],
			200
		);
	}

	/**
	 * @param mixed $operations
	 * @return array<int, array{path: string, code: string, message: string}>
	 */
	private function validate_operation_shapes( $operations ): array {
		$errors = [];

		foreach ( $operations as $index => $operation ) {
			$path = "operations[{$index}]";

			if ( ! is_array( $operation ) ) {
				$errors[] = [ 'path' => $path, 'code' => 'DSL_VERSION_UNSUPPORTED', 'message' => __( 'Each operation must be an object.', 'emcp' ) ];
				continue;
			}

			if ( ! isset( $operation['op'] ) || 'set_settings' !== $operation['op'] ) {
				$errors[] = [
					'path'    => "{$path}.op",
					'code'    => 'DSL_VERSION_UNSUPPORTED',
					'message' => __( 'Unsupported "op" — only "set_settings" exists today.', 'emcp' ),
				];
			}

			if ( ! isset( $operation['element_id'] ) || ! is_string( $operation['element_id'] ) || '' === $operation['element_id'] ) {
				$errors[] = [ 'path' => "{$path}.element_id", 'code' => 'CONTROL_NOT_FOUND', 'message' => __( 'A non-empty "element_id" is required.', 'emcp' ) ];
			}

			if ( ! isset( $operation['settings'] ) || ! is_array( $operation['settings'] ) || [] === $operation['settings'] ) {
				$errors[] = [ 'path' => "{$path}.settings", 'code' => 'CONTROL_NOT_FOUND', 'message' => __( 'A non-empty "settings" object is required.', 'emcp' ) ];
			}
		}

		return $errors;
	}

	/**
	 * @param array<int, array<string, mixed>> $elements
	 * @return array<string, mixed>|null
	 */
	private function find_element( array $elements, string $element_id ): ?array {
		foreach ( $elements as $element ) {
			if ( ( $element['id'] ?? '' ) === $element_id ) {
				return $element;
			}

			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				$found = $this->find_element( $element['elements'], $element_id );
				if ( null !== $found ) {
					return $found;
				}
			}
		}

		return null;
	}

	/**
	 * @param array<int, array<string, mixed>> $elements
	 * @param array<string, mixed>             $settings
	 */
	private function merge_settings_into_element( array &$elements, string $element_id, array $settings ): bool {
		foreach ( $elements as &$element ) {
			if ( ( $element['id'] ?? '' ) === $element_id ) {
				$element['settings'] = array_merge( $element['settings'] ?? [], $settings );
				return true;
			}

			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				if ( $this->merge_settings_into_element( $element['elements'], $element_id, $settings ) ) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * `GET /documents/{id}/lock` — Blueprints.md §6's frozen route table
	 * (row present since EMCP-010; never implemented until now). Lets a
	 * caller check lock state without attempting — and having refused — a
	 * write first, e.g. before deciding whether to show an "in use" warning.
	 * Read-only: `Capabilities::can_read` is enough, no `edit_post` check of
	 * its own beyond that, since this reveals no content, only whether
	 * *someone* is editing.
	 */
	public function lock_status( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post_id = (int) $request->get_param( 'id' );
		$post    = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'No post exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$locked_by = $this->check_lock( $post_id );

		return new \WP_REST_Response(
			[
				'id'        => $post_id,
				'locked'    => null !== $locked_by,
				'locked_by' => $locked_by,
			],
			200
		);
	}

	/**
	 * @return array{id: int, name: string|null}|null
	 */
	private function check_lock( int $post_id ): ?array {
		require_once ABSPATH . 'wp-admin/includes/post.php';
		$locking_user_id = wp_check_post_lock( $post_id );

		if ( false === $locking_user_id ) {
			return null;
		}

		$locking_user = get_userdata( $locking_user_id );

		return [
			'id'   => $locking_user_id,
			'name' => $locking_user instanceof \WP_User ? $locking_user->display_name : null,
		];
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
}
