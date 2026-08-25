<?php
/**
 * Minimal stand-ins for the WordPress/Elementor globals our unit-testable
 * code touches — just enough surface for real assertions, not a WP
 * bootstrap. Extend as more PHP classes gain unit tests; if a class needs
 * more of WordPress than a stub can reasonably fake, that's a sign it
 * belongs in verify:live instead, not a reason to grow these into a full
 * WP core reimplementation.
 */

declare(strict_types=1);

if ( ! function_exists( '__' ) ) {
	function __( string $text, string $domain = 'default' ): string {
		return $text;
	}
}

if ( ! function_exists( 'esc_html__' ) ) {
	function esc_html__( string $text, string $domain = 'default' ): string {
		return $text;
	}
}

if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public function __construct(
			private string $code = '',
			private string $message = '',
			private mixed $data = null,
		) {}

		public function get_error_code(): string {
			return $this->code;
		}

		public function get_error_message(): string {
			return $this->message;
		}

		public function get_error_data(): mixed {
			return $this->data;
		}
	}
}

if ( ! class_exists( 'WP_REST_Request' ) ) {
	class WP_REST_Request {
		/** @param array<string,string> $headers */
		public function __construct( private array $headers = [] ) {}

		public function get_header( string $name ): ?string {
			return $this->headers[ strtolower( $name ) ] ?? null;
		}
	}
}

/**
 * Test-controllable: set $GLOBALS['emcp_test_current_user_can'] before
 * calling code that checks a capability, matching how a test would
 * configure any other fake collaborator.
 */
if ( ! function_exists( 'current_user_can' ) ) {
	function current_user_can( string $capability ): bool {
		return $GLOBALS['emcp_test_current_user_can'] ?? false;
	}
}
