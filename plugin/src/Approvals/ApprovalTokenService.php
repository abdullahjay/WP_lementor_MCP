<?php

declare(strict_types=1);

namespace EMCP\Approvals;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §7.5 / prd.md EMCP-047 (D3: issued from a wp-admin
 * approval screen — `EMCP\Admin\PublishApprovalPage` — never from the
 * `emcp/v1` REST namespace, which is exactly the channel the model *can*
 * write to via its Application Password. `issue()` is deliberately only
 * ever called from cookie/nonce-authenticated admin code, the one
 * credential the MCP server never holds.
 *
 * Mirrors `PreviewTokenService`'s established shape (EMCP-033) closely on
 * purpose — same nonce-table single-use/revocation pattern, same "only the
 * SHA-256 hash of the raw token is ever stored" non-enumerability rule, same
 * lazily-generated HMAC secret. The one real difference: `redeem()` here
 * also takes the *current* content hash and refuses the token if it
 * doesn't match what was signed — the content-binding half of "bound to
 * `(site, post_id, content_hash)`" that `ApprovalTokenSigner`'s payload
 * carries but only this method actually enforces against live data.
 */
final class ApprovalTokenService {

	public const TABLE_SUFFIX = 'emcp_approval_tokens';

	private const DEFAULT_TTL_MINUTES = 10;

	private const MAX_TTL_MINUTES = 60;

	public const SECRET_OPTION = 'emcp_approval_token_secret';

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
			issued_by BIGINT UNSIGNED NOT NULL,
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
	public function issue( int $post_id, string $content_hash, int $issued_by, ?int $ttl_minutes = null ): array {
		global $wpdb;

		$ttl_minutes           = $this->clamp_ttl( $ttl_minutes ?? self::DEFAULT_TTL_MINUTES );
		$expires_at_timestamp = time() + ( $ttl_minutes * MINUTE_IN_SECONDS );
		$expires_at            = gmdate( 'Y-m-d H:i:s', $expires_at_timestamp );

		$raw_token = ( new ApprovalTokenSigner( $this->secret() ) )->sign( $post_id, $content_hash, $expires_at_timestamp );

		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table_name(),
			[
				'post_id'    => $post_id,
				'token_hash' => hash( 'sha256', $raw_token ),
				'issued_by'  => $issued_by,
				'expires_at' => $expires_at,
			],
			[ '%d', '%s', '%d', '%s' ]
		);

		$this->log( 'issued', $post_id, [ 'expires_at' => $expires_at, 'issued_by' => $issued_by ] );

		return [
			'token'      => $raw_token,
			'expires_at' => gmdate( 'c', strtotime( $expires_at . ' UTC' ) ),
		];
	}

	/**
	 * Verifies the signature, confirms `$current_content_hash` matches what
	 * was signed (the content-binding CAS half — a token approved against
	 * one piece of content is refused if that content has since changed),
	 * then atomically checks and consumes the nonce row in one
	 * `UPDATE ... WHERE used_at IS NULL` — same race-safety as
	 * `PreviewTokenService::redeem()`.
	 *
	 * @return int|\WP_Error the post ID on success
	 */
	public function redeem( string $raw_token, int $expected_post_id, string $current_content_hash ): int|\WP_Error {
		$payload = ( new ApprovalTokenSigner( $this->secret() ) )->verify( $raw_token );

		if ( is_wp_error( $payload ) ) {
			return $payload;
		}

		if ( $expected_post_id !== (int) $payload['pid'] ) {
			return new \WP_Error(
				'emcp_approval_token_wrong_post',
				__( 'This approval token was not issued for this post.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		if ( ! hash_equals( (string) $payload['chash'], $current_content_hash ) ) {
			$this->log( 'redemption_failed', (int) $payload['pid'], [ 'reason' => 'content changed since approval' ] );

			return new \WP_Error(
				'emcp_approval_content_changed',
				__( 'The content has changed since this approval was issued. Get a fresh approval for the current content.', 'emcp' ),
				[ 'status' => 409 ]
			);
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
				'emcp_approval_token_invalid',
				__( 'This approval token has already been used, was revoked, or has expired.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		$this->log( 'redeemed', (int) $payload['pid'] );

		return (int) $payload['pid'];
	}

	private function clamp_ttl( int $ttl_minutes ): int {
		return max( 1, min( $ttl_minutes, self::MAX_TTL_MINUTES ) );
	}

	/**
	 * Lazily generated, once, on first use — `add_option()`'s race-safe
	 * "insert if not exists" semantics, same as `PreviewTokenService`'s
	 * secret. Deliberately a **separate** option/secret from the preview
	 * token's — an approval token and a renderer preview token must never
	 * be interchangeable even if someone reused a signer by mistake; two
	 * independent secrets make that a signature failure, not a subtle bug.
	 */
	private function secret(): string {
		$secret = get_option( self::SECRET_OPTION );

		if ( is_string( $secret ) && '' !== $secret ) {
			return $secret;
		}

		$generated = bin2hex( random_bytes( 32 ) );
		add_option( self::SECRET_OPTION, $generated, '', 'no' );

		return (string) get_option( self::SECRET_OPTION );
	}

	/**
	 * @param array<string, mixed> $context
	 */
	private function log( string $event, ?int $post_id, array $context = [] ): void {
		error_log( sprintf( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			'[emcp] approval_token.%s post_id=%s %s',
			$event,
			null === $post_id ? 'unknown' : (string) $post_id,
			empty( $context ) ? '' : (string) wp_json_encode( $context )
		) );
	}
}
