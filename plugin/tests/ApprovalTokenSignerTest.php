<?php

declare(strict_types=1);

namespace EMCP\Tests;

use EMCP\Approvals\ApprovalTokenSigner;
use PHPUnit\Framework\TestCase;
use WP_Error;

/**
 * The pure half of Blueprints.md §7.5's confirmation token — signing/
 * verification, no `$wpdb`. Single-use/revocation/content-binding (the
 * nonce-table half) needs a real WordPress database and is live-verified
 * instead, same precedent as `PreviewTokenSignerTest`.
 */
final class ApprovalTokenSignerTest extends TestCase {

	private function signer( string $secret = 'test-secret' ): ApprovalTokenSigner {
		return new ApprovalTokenSigner( $secret );
	}

	public function test_a_freshly_signed_token_verifies_successfully(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, 'hash-abc', time() + 900 );

		$result = $signer->verify( $token );

		self::assertIsArray( $result );
		self::assertSame( 42, $result['pid'] );
		self::assertSame( 'hash-abc', $result['chash'] );
		self::assertSame( 'publish', $result['aud'] );
	}

	public function test_rejects_a_token_signed_with_a_different_secret(): void {
		$token = $this->signer( 'secret-a' )->sign( 42, 'hash-abc', time() + 900 );

		$result = $this->signer( 'secret-b' )->verify( $token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_approval_token_invalid_signature', $result->get_error_code() );
	}

	public function test_rejects_a_tampered_payload_even_with_a_structurally_valid_signature(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, 'hash-abc', time() + 900 );

		[ $payload, $signature ] = explode( '.', $token );
		$decoded                 = json_decode( ApprovalTokenSigner::base64_url_decode( $payload ), true );
		$decoded['pid']           = 999; // attacker tries to repoint the token at a different post
		$tampered_payload         = ApprovalTokenSigner::base64_url_encode( (string) json_encode( $decoded ) );
		$tampered_token           = $tampered_payload . '.' . $signature;

		$result = $signer->verify( $tampered_token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_approval_token_invalid_signature', $result->get_error_code() );
	}

	public function test_rejects_a_payload_with_the_content_hash_swapped(): void {
		// The exact attack this token's content-binding exists to prevent:
		// approve one piece of content, then try to use the token for
		// different content by tampering the `chash` claim. Signature
		// verification catches it — same mechanism as the `pid` swap above,
		// worth its own test since `chash` is this signer's one real
		// difference from `PreviewTokenSigner`.
		$signer = $this->signer();
		$token  = $signer->sign( 42, 'approved-hash', time() + 900 );

		[ $payload, $signature ] = explode( '.', $token );
		$decoded                 = json_decode( ApprovalTokenSigner::base64_url_decode( $payload ), true );
		$decoded['chash']        = 'different-hash';
		$tampered_payload        = ApprovalTokenSigner::base64_url_encode( (string) json_encode( $decoded ) );
		$tampered_token          = $tampered_payload . '.' . $signature;

		$result = $signer->verify( $tampered_token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_approval_token_invalid_signature', $result->get_error_code() );
	}

	public function test_rejects_an_expired_token(): void {
		$signer = $this->signer();
		$token  = $signer->sign( 42, 'hash-abc', time() - 1 ); // already expired

		$result = $signer->verify( $token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_approval_token_expired', $result->get_error_code() );
	}

	public function test_rejects_a_malformed_token(): void {
		$signer = $this->signer();

		self::assertInstanceOf( WP_Error::class, $signer->verify( 'not-a-real-token' ) );
		self::assertInstanceOf( WP_Error::class, $signer->verify( 'too.many.parts.here' ) );
		self::assertInstanceOf( WP_Error::class, $signer->verify( '' ) );
	}

	public function test_the_audience_claim_is_always_publish(): void {
		$token = $this->signer()->sign( 1, 'h', time() + 900 );

		[ $payload ] = explode( '.', $token );
		$decoded     = json_decode( ApprovalTokenSigner::base64_url_decode( $payload ), true );

		self::assertSame( 'publish', $decoded['aud'] );
	}

	public function test_a_renderer_preview_token_style_audience_is_rejected(): void {
		// Two independent secrets/audiences (this class vs. PreviewTokenSigner)
		// must never be interchangeable, even by accident — simulated here by
		// hand-crafting a payload with the wrong `aud` under this signer's own
		// secret, rather than actually cross-wiring the two classes.
		$signer = $this->signer();
		$token  = $signer->sign( 1, 'h', time() + 900 );

		[ $payload, $signature ] = explode( '.', $token );
		$decoded                 = json_decode( ApprovalTokenSigner::base64_url_decode( $payload ), true );
		$decoded['aud']           = 'renderer';
		// Re-sign so the signature matches the tampered payload — isolates
		// the audience check itself, not signature verification (already
		// covered above).
		$resigned_payload = ApprovalTokenSigner::base64_url_encode( (string) json_encode( $decoded ) );
		$resigned_signature = ApprovalTokenSigner::base64_url_encode(
			hash_hmac( 'sha256', $resigned_payload, 'test-secret', true )
		);
		$resigned_token = $resigned_payload . '.' . $resigned_signature;

		$result = $signer->verify( $resigned_token );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_approval_token_wrong_audience', $result->get_error_code() );
	}

	public function test_two_tokens_for_the_same_post_are_never_identical(): void {
		$signer = $this->signer();
		$expiry = time() + 900;

		$first  = $signer->sign( 7, 'hash-x', $expiry );
		$second = $signer->sign( 7, 'hash-x', $expiry );

		self::assertNotSame( $first, $second );
	}

	public function test_the_raw_token_never_contains_the_secret(): void {
		$secret = 'super-secret-value-should-never-appear';
		$token  = $this->signer( $secret )->sign( 1, 'h', time() + 900 );

		self::assertStringNotContainsString( $secret, $token );
	}
}
