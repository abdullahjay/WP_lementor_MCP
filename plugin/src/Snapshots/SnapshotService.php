<?php

declare(strict_types=1);

namespace EMCP\Snapshots;

use EMCP\Documents\DocumentHasher;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §6, `POST /snapshots` + `POST /snapshots/{id}/restore`
 * (EMCP-037). `solution.md` §10: "Snapshot (WordPress): prior
 * `_elementor_data`, which path it captured (parent or autosave), meta,
 * hash. Stored site-side so content stays with the site and rollback
 * survives a Node outage." — a real table (`{$wpdb->prefix}emcp_snapshots`),
 * mirroring `PreviewTokenService`'s pattern (EMCP-033), not post meta on a
 * hidden post.
 *
 * The captured `_elementor_data`/`_elementor_page_settings` are stored
 * **verbatim** — the exact raw JSON string `get_post_meta()` returned, not
 * re-encoded — so a restore reproduces exactly what was there, byte for
 * byte, rather than a re-serialization that merely looks equivalent.
 * `get_post_meta()` already returns this unslashed and DB-clean (WordPress
 * unslashes on write, not on read); restoring it back to `_elementor_data`
 * needs the opposite operation — `wp_slash()` — applied once, immediately
 * before `update_post_meta()`, per CLAUDE.md's slashing gotcha. This is the
 * one write path that deliberately does not go through `Document::save()`,
 * so it does not get that API's automatic cache invalidation for free —
 * callers must follow a restore with `POST /cache/invalidate` (EMCP-035).
 */
final class SnapshotService {

	public const TABLE_SUFFIX = 'emcp_snapshots';

	public static function table_name(): string {
		global $wpdb;

		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Called from `Plugin::activate()`. `dbDelta()` is idempotent — safe to
	 * call on every activation, including plugin updates.
	 */
	public static function create_table(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table_name      = self::table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			post_id BIGINT UNSIGNED NOT NULL,
			source VARCHAR(10) NOT NULL,
			elementor_data LONGTEXT NOT NULL,
			page_settings LONGTEXT NOT NULL,
			doc_meta LONGTEXT NOT NULL,
			hash CHAR(64) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY post_id (post_id)
		) {$charset_collate};";

		dbDelta( $sql );
	}

	public static function drop_table(): void {
		global $wpdb;

		$wpdb->query( 'DROP TABLE IF EXISTS ' . self::table_name() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/**
	 * Captures the given post's current `_elementor_data` (parent, or its
	 * live autosave — mirroring `DocumentsController::show()`'s existing
	 * `?source=autosave|parent` distinction, EMCP-024) verbatim, plus
	 * `_elementor_page_settings` and the document meta trio, and computes a
	 * capture-time hash via the same `DocumentHasher` `GET /documents/{id}`
	 * uses — so a caller can tell, without a second round trip, whether
	 * restoring this snapshot would actually change anything.
	 *
	 * @return array{id: int, post_id: int, source: string, hash: string, created_at: string}|\WP_Error
	 */
	public function capture( int $post_id, string $source ): array|\WP_Error {
		$data_owner_id = $post_id;

		if ( 'autosave' === $source ) {
			$autosave = wp_get_post_autosave( $post_id, get_current_user_id() );

			if ( ! $autosave instanceof \WP_Post ) {
				return new \WP_Error(
					'emcp_no_autosave',
					__( 'No autosave revision exists for this post.', 'emcp' ),
					[ 'status' => 404 ]
				);
			}

			$data_owner_id = $autosave->ID;
		}

		$elementor_data_raw = (string) get_post_meta( $data_owner_id, '_elementor_data', true );
		$page_settings_raw  = (string) get_post_meta( $post_id, '_elementor_page_settings', true );

		$doc_meta = [
			'edit_mode'     => get_post_meta( $post_id, '_elementor_edit_mode', true ),
			'template_type' => get_post_meta( $post_id, '_elementor_template_type', true ),
			'version'       => get_post_meta( $post_id, '_elementor_version', true ),
		];

		$elements       = $this->decode( $elementor_data_raw );
		$page_settings  = $this->decode( $page_settings_raw );
		$hash           = DocumentHasher::hash( $elements, $page_settings );
		$created_at     = gmdate( 'Y-m-d H:i:s' );

		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table_name(),
			[
				'post_id'        => $post_id,
				'source'         => $source,
				'elementor_data' => $elementor_data_raw,
				'page_settings'  => $page_settings_raw,
				'doc_meta'       => (string) wp_json_encode( $doc_meta ),
				'hash'           => $hash,
				'created_at'     => $created_at,
			],
			[ '%d', '%s', '%s', '%s', '%s', '%s', '%s' ]
		);

		return [
			'id'         => (int) $wpdb->insert_id,
			'post_id'    => $post_id,
			'source'     => $source,
			'hash'       => $hash,
			'created_at' => gmdate( 'c', strtotime( $created_at . ' UTC' ) ),
		];
	}

	/**
	 * The snapshot's target post id, without performing any write — callers
	 * must check `current_user_can( 'edit_post', $post_id )` against this
	 * *before* calling `restore()`, which writes unconditionally once
	 * called.
	 */
	public function find_post_id( int $snapshot_id ): ?int {
		$row = $this->find( $snapshot_id );

		return null === $row ? null : (int) $row['post_id'];
	}

	/**
	 * Writes the snapshot's captured `_elementor_data` back onto the
	 * snapshot's own `post_id`, directly via `update_post_meta()` — the one
	 * write path in this plugin that bypasses `Document::save()` entirely
	 * (CLAUDE.md's slashing gotcha), so `wp_slash()` is applied here,
	 * immediately before the write, and nowhere else in this class.
	 *
	 * @return array{post_id: int, restored: bool, hash: string}|\WP_Error
	 */
	public function restore( int $snapshot_id ): array|\WP_Error {
		$row = $this->find( $snapshot_id );

		if ( null === $row ) {
			return new \WP_Error(
				'emcp_snapshot_not_found',
				__( 'No snapshot exists with that ID.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		$post_id = (int) $row['post_id'];

		update_post_meta( $post_id, '_elementor_data', wp_slash( $row['elementor_data'] ) );

		if ( '' !== $row['page_settings'] ) {
			update_post_meta( $post_id, '_elementor_page_settings', wp_slash( $row['page_settings'] ) );
		}

		$doc_meta = json_decode( $row['doc_meta'], true );
		if ( is_array( $doc_meta ) ) {
			foreach ( [ 'edit_mode' => '_elementor_edit_mode', 'template_type' => '_elementor_template_type', 'version' => '_elementor_version' ] as $meta_field => $meta_key ) {
				if ( isset( $doc_meta[ $meta_field ] ) && '' !== $doc_meta[ $meta_field ] ) {
					update_post_meta( $post_id, $meta_key, $doc_meta[ $meta_field ] );
				}
			}
		}

		return [
			'post_id'  => $post_id,
			'restored' => true,
			'hash'     => $row['hash'],
		];
	}

	/**
	 * @return array{post_id: string, source: string, elementor_data: string, page_settings: string, doc_meta: string, hash: string}|null
	 */
	private function find( int $snapshot_id ): ?array {
		global $wpdb;
		$table = self::table_name();

		$row = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->prepare( "SELECT post_id, source, elementor_data, page_settings, doc_meta, hash FROM {$table} WHERE id = %d", $snapshot_id ), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			ARRAY_A
		);

		return is_array( $row ) ? $row : null;
	}

	private function decode( string $raw ): array {
		if ( '' === $raw ) {
			return [];
		}

		$decoded = json_decode( $raw, true );

		return is_array( $decoded ) ? $decoded : [];
	}
}
