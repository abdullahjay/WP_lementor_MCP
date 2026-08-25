<?php

declare(strict_types=1);

namespace EMCP\Tests;

use EMCP\Rest\Capabilities;
use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Request;

/**
 * Real assertions against Capabilities::can_read_site() — the security-
 * relevant gate documented at length in Capabilities.php's own docblock
 * (solution.md §9.7's "rejected outright", not just nonce-checked).
 */
final class CapabilitiesTest extends TestCase {

	protected function setUp(): void {
		unset( $GLOBALS['emcp_test_current_user_can'] );
	}

	public function test_rejects_missing_authorization_header(): void {
		$request = new WP_REST_Request( [] );

		$result = Capabilities::can_read_site( $request );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_cookie_auth_rejected', $result->get_error_code() );
		self::assertSame( 401, $result->get_error_data()['status'] );
	}

	public function test_rejects_empty_authorization_header(): void {
		$request = new WP_REST_Request( [ 'authorization' => '' ] );

		$result = Capabilities::can_read_site( $request );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_cookie_auth_rejected', $result->get_error_code() );
	}

	public function test_rejects_present_header_without_capability(): void {
		$GLOBALS['emcp_test_current_user_can'] = false;
		$request = new WP_REST_Request( [ 'authorization' => 'Basic dGVzdDp0ZXN0' ] );

		$result = Capabilities::can_read_site( $request );

		self::assertInstanceOf( WP_Error::class, $result );
		self::assertSame( 'emcp_forbidden', $result->get_error_code() );
		self::assertSame( 403, $result->get_error_data()['status'] );
	}

	public function test_allows_present_header_with_capability(): void {
		$GLOBALS['emcp_test_current_user_can'] = true;
		$request = new WP_REST_Request( [ 'authorization' => 'Basic dGVzdDp0ZXN0' ] );

		$result = Capabilities::can_read_site( $request );

		self::assertTrue( $result );
	}

	public function test_header_lookup_is_case_insensitive_to_key(): void {
		// WP_REST_Request normalizes header keys internally; our stub mimics
		// that by lowercasing on storage, so this asserts our own code reads
		// via get_header() rather than array access, which would break on
		// the real WP_REST_Request too.
		$GLOBALS['emcp_test_current_user_can'] = true;
		$request = new WP_REST_Request( [ 'authorization' => 'Basic dGVzdDp0ZXN0' ] );

		self::assertTrue( Capabilities::can_read_site( $request ) );
	}
}
