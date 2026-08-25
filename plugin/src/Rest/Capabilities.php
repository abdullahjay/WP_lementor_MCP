<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * Shared permission callbacks for emcp/v1 routes.
 *
 * Blueprints.md §6 / solution.md §9.7: cookie-authenticated requests are
 * rejected outright, not merely nonce-checked. WordPress core's own cookie
 * auth path (rest_cookie_check_errors) already blocks a cookie session with
 * no valid nonce, but a valid nonce would otherwise sail through — and a
 * valid nonce is exactly what a same-site CSRF payload can obtain. These
 * routes exist for the Node MCP server to call, authenticating via an
 * Authorization header (Application Passwords now, scoped tokens later,
 * solution.md's decision table) — never a browser session. So the check
 * here is deliberately blunt: no Authorization header, no access, even if
 * WordPress would otherwise consider the request validly authenticated.
 */
final class Capabilities {

	public static function can_read( \WP_REST_Request $request ): bool|\WP_Error {
		if ( '' === (string) $request->get_header( 'authorization' ) ) {
			return new \WP_Error(
				'emcp_cookie_auth_rejected',
				__( 'This route does not accept cookie authentication. Supply an Authorization header.', 'emcp' ),
				[ 'status' => 401 ]
			);
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error(
				'emcp_forbidden',
				__( 'The authenticated user is not permitted to use this route.', 'emcp' ),
				[ 'status' => 403 ]
			);
		}

		return true;
	}
}
