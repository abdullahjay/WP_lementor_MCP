<?php

declare(strict_types=1);

namespace EMCP\PreviewTokens;

defined( 'ABSPATH' ) || exit;

/**
 * The pure half of Blueprints.md §6.5's "signed... bound to a `renderer`
 * audience" — HMAC-SHA256 over a base64url JSON payload, no `$wpdb`, no
 * WordPress option storage. Deliberately separated from
 * `PreviewTokenService` (which owns the nonce-table single-use/revocation
 * side, needing real WordPress) so this half — the part a forged or
 * expired token actually gets caught by — is unit-testable without a live
 * database, matching `WidgetsControllerTest`'s established pattern
 * (EMCP-027) of carving out the part of a class that doesn't need a real
 * WP bootstrap.
 */
final class PreviewTokenSigner {

	public const AUDIENCE = 'renderer';

	public function __construct( private readonly string $secret ) {}

	public function sign( int $post_id, int $expires_at_timestamp ): string {
		$payload = [
			'pid' => $post_id,
			'aud' => self::AUDIENCE,
			'exp' => $expires_at_timestamp,
			'jti' => bin2hex( random_bytes( 16 ) ),
		];

		$encoded_payload = self::base64_url_encode( (string) wp_json_encode( $payload ) );
		$signature       = self::base64_url_encode( hash_hmac( 'sha256', $encoded_payload, $this->secret, true ) );

		return $encoded_payload . '.' . $signature;
	}

	/**
	 * @return array{pid: int, aud: string, exp: int, jti: string}|\WP_Error
	 */
	public function verify( string $raw_token ): array|\WP_Error {
		$parts = explode( '.', $raw_token );

		if ( 2 !== count( $parts ) ) {
			return new \WP_Error( 'emcp_preview_token_malformed', __( 'Malformed preview token.', 'emcp' ), [ 'status' => 400 ] );
		}

		[ $encoded_payload, $signature ] = $parts;
		$expected_signature = self::base64_url_encode( hash_hmac( 'sha256', $encoded_payload, $this->secret, true ) );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return new \WP_Error( 'emcp_preview_token_invalid_signature', __( 'Preview token signature does not match.', 'emcp' ), [ 'status' => 403 ] );
		}

		$payload = json_decode( self::base64_url_decode( $encoded_payload ), true );

		if ( ! is_array( $payload ) || ! isset( $payload['pid'], $payload['aud'], $payload['exp'], $payload['jti'] ) ) {
			return new \WP_Error( 'emcp_preview_token_malformed', __( 'Malformed preview token payload.', 'emcp' ), [ 'status' => 400 ] );
		}

		if ( self::AUDIENCE !== $payload['aud'] ) {
			return new \WP_Error( 'emcp_preview_token_wrong_audience', __( 'Preview token is not valid for this audience.', 'emcp' ), [ 'status' => 403 ] );
		}

		if ( (int) $payload['exp'] < time() ) {
			return new \WP_Error( 'emcp_preview_token_expired', __( 'Preview token has expired.', 'emcp' ), [ 'status' => 403 ] );
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
