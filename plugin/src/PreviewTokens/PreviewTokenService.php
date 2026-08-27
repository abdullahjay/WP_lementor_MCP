<?php

declare(strict_types=1);

namespace EMCP\PreviewTokens;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §6.5: "Signed, single post ID, TTL in minutes, single-use
 * via a nonce table, non-enumerable, revocable, bound to a `renderer`
 * audience... Issuance and redemption are both logged."
 *
 * Two independent layers, deliberately not just one:
 * - **Signature** (HMAC-SHA256 over the token payload) proves the token
 *   wasn't forged and carries the audience/expiry claims — checkable with
 *   no database access at all.
 * - **The nonce table** (`{$wpdb->prefix}emcp_preview_nonces`) is the
 *   single-use and revocation source of truth — a valid signature alone
 *   never carries a page's content; it never even proves that request
 *   hasn't already been served. Real-time state lives here, not just in
 *   the signature (`server/src/db/schema.ts`'s `previewNonces` table,
 *   EMCP-013, is Node's own audit/ledger copy of "what tokens exist" —
 *   Blueprints.md §11.3 — not the operational single-use store; this
 *   plugin-side table is, since issuance and redemption both happen
 *   against this one WordPress install).
 *
 * Non-enumerable: the raw token is 32 bytes of `random_bytes()`, and only
 * its SHA-256 hash is ever stored — same rule §6.4 already applies to
 * approval tokens and preview nonces alike (never store the presentable
 * secret itself).
 */
final class PreviewTokenService {

	public const TABLE_SUFFIX = 'emcp_preview_nonces';

	private const DEFAULT_TTL_MINUTES = 15;

	private const MAX_TTL_MINUTES = 60;

	public const SECRET_OPTION = 'emcp_preview_token_secret';

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
			token_hash CHAR(64) NOT NULL,
			expires_at DATETIME NOT NULL,
			used_at DATETIME NULL DEFAULT NULL,
			revoked_at DATETIME NULL DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			KEY post_id (post_id)
		) {$charset_collate};";

		dbDelta( $sql );
	}

	public static function drop_table(): void {
		global $wpdb;

		$wpdb->query( 'DROP TABLE IF EXISTS ' . self::table_name() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/**
	 * @return array{token: string, expires_at: string}
	 */
	public function issue( int $post_id, ?int $ttl_minutes = null ): array {
		global $wpdb;

		$ttl_minutes           = $this->clamp_ttl( $ttl_minutes ?? self::DEFAULT_TTL_MINUTES );
		$expires_at_timestamp = time() + ( $ttl_minutes * MINUTE_IN_SECONDS );
		$expires_at            = gmdate( 'Y-m-d H:i:s', $expires_at_timestamp );

		$raw_token = ( new PreviewTokenSigner( $this->secret() ) )->sign( $post_id, $expires_at_timestamp );

		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table_name(),
			[
				'post_id'    => $post_id,
				'token_hash' => hash( 'sha256', $raw_token ),
				'expires_at' => $expires_at,
			],
			[ '%d', '%s', '%s' ]
		);

		$this->log( 'issued', $post_id, [ 'expires_at' => $expires_at ] );

		return [
			'token'      => $raw_token,
			'expires_at' => gmdate( 'c', strtotime( $expires_at . ' UTC' ) ),
		];
	}

	/**
	 * Verifies the signature, then atomically checks and consumes the
	 * nonce row in one `UPDATE ... WHERE used_at IS NULL AND revoked_at IS
	 * NULL` — a second, concurrent redemption of the same token loses the
	 * race at the database level, not via a read-then-write gap this class
	 * would otherwise leave open.
	 *
	 * @return int|\WP_Error the post ID on success
	 */
	public function redeem( string $raw_token ): int|\WP_Error {
		$payload = ( new PreviewTokenSigner( $this->secret() ) )->verify( $raw_token );

		if ( is_wp_error( $payload ) ) {
			return $payload;
		}

		global $wpdb;
		$table = self::table_name();
		$hash  = hash( 'sha256', $raw_token );
		$now   = gmdate( 'Y-m-d H:i:s' );

		$updated = $wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->prepare(
				"UPDATE {$table} SET used_at = %s WHERE token_hash = %s AND used_at IS NULL AND revoked_at IS NULL AND expires_at > %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$now,
				$hash,
				$now
			)
		);

		if ( 1 !== $updated ) {
			$this->log( 'redemption_failed', (int) $payload['pid'], [ 'reason' => 'nonce already used, revoked, or expired' ] );

			return new \WP_Error(
				'emcp_preview_token_invalid',
				__( 'This preview token has already been used, was revoked, or has expired.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$this->log( 'redeemed', (int) $payload['pid'] );

		return (int) $payload['pid'];
	}

	public function revoke( string $raw_token ): bool {
		global $wpdb;
		$table = self::table_name();
		$hash  = hash( 'sha256', $raw_token );

		$updated = $wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->prepare(
				"UPDATE {$table} SET revoked_at = %s WHERE token_hash = %s AND used_at IS NULL AND revoked_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				gmdate( 'Y-m-d H:i:s' ),
				$hash
			)
		);

		$revoked = 1 === $updated;

		if ( $revoked ) {
			$this->log( 'revoked', null );
		}

		return $revoked;
	}

	/**
	 * EMCP-034: signature-only check (no nonce-table consumption) used
	 * solely to decide whether to suppress WordPress's own
	 * `redirect_canonical` for a renderer navigation — the sandbox's
	 * WP_HOME/siteurl carries a host:port unreachable from the renderer's
	 * network segment (CLAUDE.md's gotcha), so every request the renderer
	 * makes to a host that doesn't match siteurl would otherwise 301 into
	 * a dead end. This is deliberately **not** `redeem()`: a single render
	 * makes many requests (the page plus every subresource), all carrying
	 * the same token, and `redeem()`'s single-use semantics would fail every
	 * request after the first. It grants no content access by itself —
	 * only skips a redirect.
	 */
	public function verify_render_token( string $raw_token ): bool {
		$payload = ( new PreviewTokenSigner( $this->secret() ) )->verify( $raw_token );

		return ! is_wp_error( $payload );
	}

	private function clamp_ttl( int $ttl_minutes ): int {
		return max( 1, min( $ttl_minutes, self::MAX_TTL_MINUTES ) );
	}

	/**
	 * Lazily generated, once, on first use — stored with `autoload => no`
	 * (never needed on every page load, only when issuing/redeeming a
	 * token) via `add_option()`'s own race-safe "insert if not exists"
	 * semantics, so two concurrent first-uses can't each mint a different
	 * secret and silently invalidate each other's tokens.
	 */
	private function secret(): string {
		$secret = get_option( self::SECRET_OPTION );

		if ( is_string( $secret ) && '' !== $secret ) {
			return $secret;
		}

		$generated = bin2hex( random_bytes( 32 ) );
		add_option( self::SECRET_OPTION, $generated, '', 'no' );

		// add_option() no-ops if another request won the race — re-read to
		// get whichever value actually won, rather than trusting our own.
		return (string) get_option( self::SECRET_OPTION );
	}

	/**
	 * @param array<string, mixed> $context
	 */
	private function log( string $event, ?int $post_id, array $context = [] ): void {
		error_log( sprintf( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			'[emcp] preview_token.%s post_id=%s %s',
			$event,
			null === $post_id ? 'unknown' : (string) $post_id,
			empty( $context ) ? '' : (string) wp_json_encode( $context )
		) );
	}
}
