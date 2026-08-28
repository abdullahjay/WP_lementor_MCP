<?php

declare(strict_types=1);

namespace EMCP\Rest;

use EMCP\Approvals\ApprovalTokenService;
use EMCP\Documents\DocumentHasher;
use EMCP\Documents\PublishService;

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
	 * `POST /documents` — `create_page` (EMCP-046). Always creates a `draft`
	 * — solution.md §5.4's write posture table: "New page → post with `draft`
	 * status," never anything else; publishing is `publish_draft`'s job
	 * (EMCP-047, not built yet), so this route doesn't accept a `status`
	 * input at all.
	 *
	 * Modelled directly on Elementor's own `modules/mcp/abilities/
	 * create-page-ability.php` (Elementor 4.2.3 ships its own MCP "create
	 * page" ability — read live, not guessed) for the parts that matter for
	 * correctness: `post_type_exists() && post_type_supports($type,
	 * 'elementor')` validates the post type the same introspective way
	 * CLAUDE.md's "introspect, never hardcode" already applies to widgets;
	 * `get_post_type_object($type)->cap->create_posts` is the real
	 * capability for that post type, not a hardcoded `edit_pages`; and
	 * `$document->set_is_built_with_elementor( true )` is the one real
	 * Elementor API for "mark this post `_elementor_edit_mode = builder`" —
	 * writing that meta key by hand would drift from whatever internal
	 * representation a future Elementor version chooses (currently the
	 * string `'builder'`, `Document::BUILT_WITH_ELEMENTOR_META_KEY`).
	 *
	 * Goes one step further than Elementor's own minimal ability, which
	 * leaves `_elementor_template_type`/`_elementor_version` unset until a
	 * human's first edit in the real editor: this route also calls
	 * `$document->save( [ 'elements' => [] ] )` immediately, since
	 * `Document::save()` always stamps both of those itself (confirmed live
	 * by reading `core/base/document.php`) — so `GET /documents/{id}`
	 * (`show()`) returns a fully valid, immediately-editable document with a
	 * real `document_hash` right away, rather than a document `edit_elements`
	 * can't yet target because required meta is missing (CLAUDE.md's
	 * `_elementor_edit_mode` gotcha, generalised to the sibling meta keys
	 * `save()` owns).
	 *
	 * `_wp_page_template` is always written explicitly (prd.md's own words
	 * for this task: "page template explicit") — never left absent for
	 * WordPress to resolve implicitly, and validated against the real,
	 * introspected list `wp_get_theme()->get_page_templates()` returns for
	 * this post type (confirmed live: it already includes Elementor's own
	 * `elementor_canvas`/`elementor_header_footer`/`elementor_theme`
	 * entries, registered via the standard `theme_page_templates` filter —
	 * no Elementor-specific slugs are hardcoded here) plus the always-valid
	 * `'default'` sentinel ("use the theme's own default template", which
	 * `get_page_templates()` itself never lists as an option).
	 */
	public function create( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$title = $request->get_param( 'title' );

		if ( ! is_string( $title ) || '' === trim( $title ) ) {
			return new \WP_Error(
				'emcp_invalid_request',
				__( 'A non-empty "title" is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		$post_type = $request->get_param( 'post_type' );
		$post_type = is_string( $post_type ) && '' !== $post_type ? sanitize_key( $post_type ) : 'page';

		if ( ! post_type_exists( $post_type ) || ! post_type_supports( $post_type, 'elementor' ) ) {
			return new \WP_Error(
				'emcp_invalid_post_type',
				__( 'This post type does not exist or does not support Elementor.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		$post_type_object = get_post_type_object( $post_type );

		if ( ! $post_type_object || ! current_user_can( $post_type_object->cap->create_posts ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to create posts of this type.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$page_template = $request->get_param( 'page_template' );
		$page_template = is_string( $page_template ) && '' !== $page_template ? $page_template : 'default';

		if ( 'default' !== $page_template && ! array_key_exists( $page_template, wp_get_theme()->get_page_templates( null, $post_type ) ) ) {
			return new \WP_Error(
				'emcp_invalid_page_template',
				__( 'Unknown "page_template" for this post type.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		$post_id = wp_insert_post(
			[
				'post_title'  => $title,
				'post_status' => 'draft',
				'post_type'   => $post_type,
			],
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		$document = \Elementor\Plugin::$instance->documents->get( $post_id );

		if ( ! $document ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'Elementor could not load the newly created document.', 'emcp' ),
				[ 'status' => 500 ]
			);
		}

		$document->set_is_built_with_elementor( true );
		$document->save( [ 'elements' => [] ] );

		update_post_meta( $post_id, '_wp_page_template', $page_template );

		$meta = [
			'edit_mode'     => get_post_meta( $post_id, '_elementor_edit_mode', true ),
			'template_type' => get_post_meta( $post_id, '_elementor_template_type', true ),
			'version'       => get_post_meta( $post_id, '_elementor_version', true ),
			'page_settings' => $this->decode_json_meta( $post_id, '_elementor_page_settings' ),
		];

		return new \WP_REST_Response(
			[
				'id'            => $post_id,
				'source'        => 'parent',
				'status'        => get_post_status( $post_id ),
				'type'          => $post_type,
				'link'          => get_permalink( $post_id ),
				'edit_url'      => $document->get_edit_url(),
				'page_template' => $page_template,
				'elements'      => [],
				'meta'          => $meta,
				'document_hash' => DocumentHasher::hash( [], $meta['page_settings'] ),
			],
			201
		);
	}

	/**
	 * `PUT /documents/{id}/page` — `update_page` (EMCP-046). Deliberately
	 * **not** the same route `edit_elements` writes through
	 * (`PUT /documents/{id}`, §7.2's frozen `operations[]`/`document_hash`
	 * contract) — a page template or title change is not "document content"
	 * in the sense the rest of the write layer means it. `_wp_page_template`
	 * is a real WordPress post attribute that controls which PHP template
	 * renders the post on *every* request regardless of publish state —
	 * there is no meaningful "draft" version of it the way there is for
	 * `_elementor_data`, so unlike `edit_elements` (EMCP-045) this route
	 * never branches to an autosave: it always writes the real post
	 * directly, published or not, the same way changing a post's title
	 * always take effect immediately rather than being staged. No document
	 * hash CAS either, for the same reason — the compare-and-swap exists to
	 * protect the element tree from being clobbered by a concurrent editor
	 * session; title/template aren't part of that tree or its hash.
	 */
	public function update_attributes( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
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

		$title         = $request->get_param( 'title' );
		$page_template = $request->get_param( 'page_template' );

		if ( ( ! is_string( $title ) || '' === trim( $title ) ) && ( ! is_string( $page_template ) || '' === $page_template ) ) {
			return new \WP_Error(
				'emcp_invalid_request',
				__( 'At least one of "title" or "page_template" is required.', 'emcp' ),
				[ 'status' => 400 ]
			);
		}

		if ( is_string( $page_template ) && '' !== $page_template ) {
			if ( 'default' !== $page_template && ! array_key_exists( $page_template, wp_get_theme()->get_page_templates( $post, $post->post_type ) ) ) {
				return new \WP_Error(
					'emcp_invalid_page_template',
					__( 'Unknown "page_template" for this post type.', 'emcp' ),
					[ 'status' => 400 ]
				);
			}

			update_post_meta( $post_id, '_wp_page_template', $page_template );
		}

		if ( is_string( $title ) && '' !== trim( $title ) ) {
			wp_update_post( [ 'ID' => $post_id, 'post_title' => $title ], true );
		}

		clean_post_cache( $post_id );

		return new \WP_REST_Response(
			[
				'id'            => $post_id,
				'title'         => get_the_title( $post_id ),
				'page_template' => (string) get_post_meta( $post_id, '_wp_page_template', true ),
				'status'        => get_post_status( $post_id ),
				'link'          => get_permalink( $post_id ),
			],
			200
		);
	}

	/**
	 * `POST /documents/{id}/publish` — `publish_draft` (EMCP-047,
	 * Blueprints.md §7.5). Never a boolean argument — the confirmation
	 * token is the human gate. Called without `confirmation_token`, this
	 * returns `pending` plus the exact wp-admin URL a human needs to visit
	 * to approve it — that page (`EMCP\Admin\PublishApprovalPage`) is
	 * cookie/nonce-authenticated only, unreachable through the Application
	 * Password credential this server's own REST calls use, which is
	 * exactly the "channel the model cannot write to" §7.5 requires.
	 *
	 * Requires `publish_posts`-class capability (`current_user_can(
	 * 'publish_post', $post_id )`), not just `edit_post` — a stronger gate
	 * than every other write route in this controller, matching that
	 * publishing is the one action here that's genuinely hard to walk back
	 * for a real site's visitors.
	 */
	public function publish( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post_id = (int) $request->get_param( 'id' );
		$post    = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'No post exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		if ( ! current_user_can( 'publish_post', $post_id ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to publish this post.', 'emcp' ),
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

		$publish_service = new PublishService();
		$state            = $publish_service->resolve_current_state( $post_id );

		if ( is_wp_error( $state ) ) {
			return $state;
		}

		$token = $request->get_param( 'confirmation_token' );

		if ( ! is_string( $token ) || '' === $token ) {
			return new \WP_REST_Response(
				[
					'id'           => $post_id,
					'published'    => false,
					'status'       => 'pending',
					'message'      => __( 'Publishing requires human approval. Visit the approval URL, log into WordPress, and approve — then call publish_draft again with the confirmation_token shown there.', 'emcp' ),
					'approval_url' => admin_url( 'tools.php?page=emcp-publish-approval&post_id=' . $post_id ),
				],
				200
			);
		}

		$redeemed = ( new ApprovalTokenService() )->redeem( $token, $post_id, $state['hash'] );

		if ( is_wp_error( $redeemed ) ) {
			return $redeemed;
		}

		$result = $publish_service->promote( $post_id );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new \WP_REST_Response(
			[
				'id'        => $post_id,
				'published' => true,
				'status'    => get_post_status( $post_id ),
				'url'       => get_permalink( $post_id ),
			],
			200
		);
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
	 * §7.2's real contract. EMCP-045 closes the last gap against §6.3's
	 * table: a **published** post writes its live autosave revision (created
	 * via Elementor's own `Document::get_autosave( 0, true )` if none exists
	 * yet), never the parent directly — "Saved successfully" for a published
	 * page therefore means "the autosave changed," matching CLAUDE.md's
	 * gotcha verbatim ("`_elementor_data` on the parent is untouched"). A
	 * non-published post (draft, pending, etc.) still writes the parent
	 * directly, since there's no "live" version to protect from a
	 * mid-edit write.
	 *
	 * Each operation is a flat object with `op` as a required enum
	 * (Blueprints.md §7.2: "not a JSON Schema `oneOf` at item level, which is
	 * where models reliably produce malformed input"). `set_settings` is a
	 * shallow merge onto one element's existing `settings`, not the deep
	 * merge `raw` (§2.8) needs. Structural validation (widget exists, setting
	 * key real, control conditions honoured — EMCP-036) is Node's job, run
	 * *before* this endpoint is ever called, same as before; this endpoint
	 * validates what only it can know (does this element id exist on this
	 * document *right now*), not widget schema.
	 *
	 * **`replace_tree` (EMCP-055)** — the second `op`, added exactly the way
	 * this docblock's own history already anticipated ("the enum has room
	 * for more without a breaking change"). `apply_page_spec` compiles a
	 * whole DSL spec into a full native element tree (`server/src/dsl/
	 * compile.ts`) — that isn't a per-element settings patch, so reusing
	 * `set_settings` would be dishonest about what's happening. Rather than
	 * a parallel write route duplicating the lock/hash/autosave-branching
	 * machinery below, `replace_tree` is a second operation shape sharing
	 * all of it: `{ op: "replace_tree", elements: [...] }`, required to be
	 * the *sole* operation in its batch (mixing it with `set_settings`
	 * operations has no coherent meaning — one replaces the whole tree, the
	 * other patches one existing element within it). It skips the
	 * per-operation "does this element id exist" check entirely (there is no
	 * target id — the whole tree is the target) and calls `Document::save()`
	 * with the given `elements` verbatim.
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

		$is_replace_tree = isset( $operations[0]['op'] ) && 'replace_tree' === $operations[0]['op'];

		if ( $is_replace_tree && count( $operations ) > 1 ) {
			return new \WP_Error(
				'emcp_invalid_operation',
				__( '"replace_tree" must be the only operation in the batch — it replaces the entire element tree, which has no coherent meaning combined with a per-element "set_settings".', 'emcp' ),
				[ 'status' => 400 ]
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

		$elements      = $this->decode_elementor_data( $target_id );
		$page_settings = $this->decode_json_meta( $target_id, '_elementor_page_settings' );
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

		$results = [];

		if ( $is_replace_tree ) {
			// No per-element existence check — there is no target id, the
			// whole tree is the target. "All operations validate before any
			// apply" is trivially satisfied: shape validation above already
			// confirmed "elements" is an array; there's nothing else to check.
			$elements = $operations[0]['elements'];
		} else {
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

			foreach ( $operations as $operation ) {
				$element_id = (string) $operation['element_id'];
				$this->merge_settings_into_element( $elements, $element_id, $operation['settings'] );
				$results[] = [ 'element_id' => $element_id, 'applied' => true ];
			}
		}

		$document = \Elementor\Plugin::$instance->documents->get( $target_id );

		if ( ! $document ) {
			return new \WP_Error(
				'emcp_document_not_found',
				__( 'Elementor could not load this document.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$document->save( [ 'elements' => $elements ] );

		// EMCP-055: re-read the actually-persisted elements rather than
		// hashing the in-memory `$elements` this method built — `save()`
		// enriches whatever it's given with fields the caller's own input
		// may not have carried (confirmed live for a `replace_tree` write of
		// fresh compiler output: a V4 atomic element without `styles`/
		// `interactions`/`editor_settings`/`version` gets those added as
		// `[]`/`"0.0"` defaults by `save()` itself). Hashing the pre-save
		// `$elements` there would return a `document_hash` that doesn't
		// match what `GET /documents/{id}` reports one call later — a stale
		// value baked into the very response meant to hand back "the new
		// hash". `set_settings` never surfaced this: it only patches
		// settings on elements that already exist, so those fields were
		// already present pre-save. Re-reading protects both op shapes with
		// one fix rather than trusting either not to drift.
		$saved_elements      = $this->decode_elementor_data( $target_id );
		$saved_page_settings = $this->decode_json_meta( $target_id, '_elementor_page_settings' );

		return new \WP_REST_Response(
			[
				'id'            => $post_id,
				'source'        => $source,
				'results'       => $results,
				'document_hash' => DocumentHasher::hash( $saved_elements, $saved_page_settings ),
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

			if ( ! isset( $operation['op'] ) || ! in_array( $operation['op'], [ 'set_settings', 'replace_tree' ], true ) ) {
				$errors[] = [
					'path'    => "{$path}.op",
					'code'    => 'DSL_VERSION_UNSUPPORTED',
					'message' => __( 'Unsupported "op" — only "set_settings" or "replace_tree" exist today.', 'emcp' ),
				];
				continue;
			}

			if ( 'replace_tree' === $operation['op'] ) {
				if ( ! isset( $operation['elements'] ) || ! is_array( $operation['elements'] ) ) {
					$errors[] = [ 'path' => "{$path}.elements", 'code' => 'CONTROL_NOT_FOUND', 'message' => __( 'A "elements" array is required for "replace_tree".', 'emcp' ) ];
				}
				continue;
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

	/**
	 * Finds the post's current autosave revision, creating one via
	 * Elementor's own `Document::get_autosave( 0, true )` (never a
	 * hand-rolled `wp_create_post_autosave()` call — that would skip
	 * Elementor's `copy_elementor_meta()` step) when none exists yet.
	 * Mirrors `SnapshotService::find_or_create_autosave()`; kept as a
	 * separate copy rather than a shared dependency since the two classes
	 * don't otherwise share one (EMCP-045).
	 */
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
