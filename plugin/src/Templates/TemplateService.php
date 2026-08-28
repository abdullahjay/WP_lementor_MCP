<?php

declare(strict_types=1);

namespace EMCP\Templates;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §6, `GET/POST /wp-json/emcp/v1/templates` (EMCP-060).
 * "Stores specs, not frozen native JSON" (prd.md) — a saved template is a
 * DSL `Spec` (`server/src/dsl/types.ts`), produced Node-side by
 * `decompile()` (EMCP-054) and handed here as an opaque JSON blob to store
 * and hand back. The plugin never parses or interprets the spec — it is
 * exactly as thin here as `SnapshotService` is for `_elementor_data`
 * (§6.1): a real table, mirroring that class's own pattern
 * (`{$wpdb->prefix}emcp_templates`), not post meta on a hidden post.
 *
 * Site-side storage (not Postgres) is the deliberate choice, matching
 * solution.md §10's reasoning for snapshots ("stored site-side so content
 * stays with the site"): a template is exactly the kind of asset a site
 * owner expects to find *on their own site*, not in this server's own
 * database, and it means a template survives an MCP server migration or
 * outage the same way page content does. Cross-site portability
 * (prd.md Task 62) comes from the DSL spec itself being generation-agnostic
 * and re-`compile()`-able against whatever site `apply_template` targets,
 * not from centralised storage.
 */
final class TemplateService {

	public const TABLE_SUFFIX = 'emcp_templates';

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
			name VARCHAR(191) NOT NULL,
			spec LONGTEXT NOT NULL,
			source_post_id BIGINT UNSIGNED NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id)
		) {$charset_collate};";

		dbDelta( $sql );
	}

	public static function drop_table(): void {
		global $wpdb;

		$wpdb->query( 'DROP TABLE IF EXISTS ' . self::table_name() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/**
	 * @return array{id: int, name: string, created_at: string}
	 */
	public function save( string $name, array $spec, ?int $source_post_id ): array {
		global $wpdb;
		$created_at = gmdate( 'Y-m-d H:i:s' );

		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table_name(),
			[
				'name'           => $name,
				'spec'           => (string) wp_json_encode( $spec ),
				'source_post_id' => $source_post_id,
				'created_at'     => $created_at,
			],
			[ '%s', '%s', '%d', '%s' ]
		);

		return [
			'id'         => (int) $wpdb->insert_id,
			'name'       => $name,
			'created_at' => gmdate( 'c', strtotime( $created_at . ' UTC' ) ),
		];
	}

	/**
	 * @return array<int, array{id: int, name: string, created_at: string, source_post_id: int|null}>
	 */
	public function list_all(): array {
		global $wpdb;
		$table = self::table_name();

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.PreparedSQL.NotPrepared
			"SELECT id, name, source_post_id, created_at FROM {$table} ORDER BY id DESC", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			ARRAY_A
		);

		if ( ! is_array( $rows ) ) {
			return [];
		}

		return array_map(
			static fn ( array $row ): array => [
				'id'             => (int) $row['id'],
				'name'           => (string) $row['name'],
				'source_post_id' => null === $row['source_post_id'] ? null : (int) $row['source_post_id'],
				'created_at'     => gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ),
			],
			$rows
		);
	}

	/**
	 * `GET /templates/{id}` (EMCP-061) — the one route that returns a
	 * template's full stored `spec`, needed by `apply_template` to actually
	 * `compile()` it. `list_all()` deliberately omits `spec` (a lightweight
	 * listing, same split `GET /documents` vs. `GET /documents/{id}`
	 * already establishes) — this is that pair's `{id}` half.
	 *
	 * @return array{id: int, name: string, spec: array<string, mixed>, created_at: string}|null
	 */
	public function find( int $template_id ): ?array {
		global $wpdb;
		$table = self::table_name();

		$row = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->prepare( "SELECT id, name, spec, created_at FROM {$table} WHERE id = %d", $template_id ), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			ARRAY_A
		);

		if ( ! is_array( $row ) ) {
			return null;
		}

		$spec = json_decode( (string) $row['spec'], true );

		return [
			'id'         => (int) $row['id'],
			'name'       => (string) $row['name'],
			'spec'       => is_array( $spec ) ? $spec : [],
			'created_at' => gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ),
		];
	}
}
