<?php

declare(strict_types=1);

namespace EMCP\Approvals;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §7.5: `publish_draft`'s confirmation token is "bound to
 * `(site, post_id, content_hash)`, single-use, minutes-long TTL, and
 * obtainable only through a channel the model cannot write to."
 *
 * The pure half of that — signing/verification, no `$wpdb` — mirrors
 * `PreviewTokenSigner` exactly (EMCP-033/034), down to the base64url/HMAC
 * shape, so it's unit-testable without a live database the same way. The
 * one real difference is the payload: `chash` (the target document's hash
 * at issuance time) sits alongside `pid`, doing for publish approval what a
 * `document_hash` argument does for `edit_elements`'s compare-and-swap — a
 * token minted against one piece of content becomes worthless the moment
 * that content changes, so a stale approval can never be used to publish
 * something different from what a human actually looked at when they
 * approved it. `aud` is `'publish'`, not `PreviewTokenSigner::AUDIENCE`'s
 * `'renderer'` — a renderer token verified here (or vice versa) is rejected
 * outright by the audience check, not just accidentally-compatible.
 */
final class ApprovalTokenSigner {

	public const AUDIENCE = 'publish';

	public function __construct( private readonly string $secret ) {}

	public function sign( int $post_id, string $content_hash, int $expires_at_timestamp ): string {
		$payload = [
			'pid'   => $post_id,
			'chash' => $content_hash,
			'aud'   => self::AUDIENCE,
			'exp'   => $expires_at_timestamp,
			'jti'   => bin2hex( random_bytes( 16 ) ),
		];

		$encoded_payload = self::base64_url_encode( (string) wp_json_encode( $payload ) );
		$signature       = self::base64_url_encode( hash_hmac( 'sha256', $encoded_payload, $this->secret, true ) );

		return $encoded_payload . '.' . $signature;
	}

	/**
	 * @return array{pid: int, chash: string, aud: string, exp: int, jti: string}|\WP_Error
	 */
	public function verify( string $raw_token ): array|\WP_Error {
		$parts = explode( '.', $raw_token );

		if ( 2 !== count( $parts ) ) {
			return new \WP_Error( 'emcp_approval_token_malformed', __( 'Malformed approval token.', 'emcp' ), [ 'status' => 400 ] );
		}

		[ $encoded_payload, $signature ] = $parts;
		$expected_signature = self::base64_url_encode( hash_hmac( 'sha256', $encoded_payload, $this->secret, true ) );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return new \WP_Error( 'emcp_approval_token_invalid_signature', __( 'Approval token signature does not match.', 'emcp' ), [ 'status' => 403 ] );
		}

		$payload = json_decode( self::base64_url_decode( $encoded_payload ), true );

		if ( ! is_array( $payload ) || ! isset( $payload['pid'], $payload['chash'], $payload['aud'], $payload['exp'], $payload['jti'] ) ) {
			return new \WP_Error( 'emcp_approval_token_malformed', __( 'Malformed approval token payload.', 'emcp' ), [ 'status' => 400 ] );
		}

		if ( self::AUDIENCE !== $payload['aud'] ) {
			return new \WP_Error( 'emcp_approval_token_wrong_audience', __( 'Approval token is not valid for this audience.', 'emcp' ), [ 'status' => 403 ] );
		}

		if ( (int) $payload['exp'] < time() ) {
			return new \WP_Error( 'emcp_approval_token_expired', __( 'Approval token has expired.', 'emcp' ), [ 'status' => 403 ] );
		}

		return $payload; // @phpstan-ignore-line array shape verified above
	}

	public static function base64_url_encode( string $data ): string {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}

	public static function base64_url_decode( string $data ): string {
		return (string) base64_decode( strtr( $data, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $data ) % 4 ) % 4 ), true );
	}
}
