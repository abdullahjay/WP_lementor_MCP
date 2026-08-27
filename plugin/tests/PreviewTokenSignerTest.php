<?php

declare(strict_types=1);

namespace EMCP\Tests;

use EMCP\PreviewTokens\PreviewTokenSigner;
use PHPUnit\Framework\TestCase;
use WP_Error;

/**
 * The pure half of Blueprints.md §6.5 — signing/verification, no `$wpdb`.
 * Single-use/revocation (the nonce-table half) needs a real WordPress
 * database and is live-verified instead, same precedent as
 * `RegistryController`/`DocumentsController`.
 */
final class PreviewTokenSignerTest extends TestCase {

	private function signer( string $secret = 'test-secret' ): PreviewTokenSigner {
		return new PreviewTokenSigner( $secret );
	}

	public function test_a_freshly_signed_token_verifies_successfully(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, time() + 900 );

		$result = $signer->verify( $token );

		self::assertIsArray( $result );
		self::assertSame( 42, $result['pid'] );
		self::assertSame( 'renderer', $result['aud'] );
	}

	public function test_rejects_a_token_signed_with_a_different_secret(): void {
		$token = $this->signer( 'secret-a' )->sign( 42, time() + 900 );

		$result = $this->signer( 'secret-b' )->verify( $token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_preview_token_invalid_signature', $result->get_error_code() );
	}

	public function test_rejects_a_tampered_payload_even_with_a_structurally_valid_signature(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, time() + 900 );

		[ $payload, $signature ] = explode( '.', $token );
		$decoded                 = json_decode( PreviewTokenSigner::base64_url_decode( $payload ), true );
		$decoded['pid']           = 999; // attacker tries to repoint the token at a different post
		$tampered_payload         = PreviewTokenSigner::base64_url_encode( (string) json_encode( $decoded ) );
		$tampered_token           = $tampered_payload . '.' . $signature;

		$result = $signer->verify( $tampered_token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_preview_token_invalid_signature', $result->get_error_code() );
	}

	public function test_rejects_an_expired_token(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, time() - 1 ); // already expired

		$result = $signer->verify( $token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_preview_token_expired', $result->get_error_code() );
	}

	public function test_rejects_a_malformed_token(): void {
		$signer = $this->signer();

		self::assertInstanceOf( WP_Error::class, $signer->verify( 'not-a-real-token' ) );
		self::assertInstanceOf( WP_Error::class, $signer->verify( 'too.many.parts.here' ) );
		self::assertInstanceOf( WP_Error::class, $signer->verify( '' ) );
	}

	public function test_the_audience_claim_is_always_renderer(): void {
		$token = $this->signer()->sign( 1, time() + 900 );

		[ $payload ] = explode( '.', $token );
		$decoded     = json_decode( PreviewTokenSigner::base64_url_decode( $payload ), true );

		self::assertSame( 'renderer', $decoded['aud'] );
	}

	public function test_two_tokens_for_the_same_post_are_never_identical(): void {
		$signer = $this->signer();
		$expiry = time() + 900;

		$first  = $signer->sign( 7, $expiry );
		$second = $signer->sign( 7, $expiry );

		// Non-enumerable (Blueprints.md §6.5) starts here — a fresh random
		// `jti` on every issuance, even for the exact same post and expiry,
		// means no two tokens are ever the same value to begin with.
		self::assertNotSame( $first, $second );
	}

	public function test_the_raw_token_never_contains_the_secret(): void {
		$secret = 'super-secret-value-should-never-appear';
		$token  = $this->signer( $secret )->sign( 1, time() + 900 );

		self::assertStringNotContainsString( $secret, $token );
	}
}
