<?php

declare(strict_types=1);

namespace EMCP\Documents;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §6.4: "covers the element tree and page settings, computed
 * server-side over a canonical serialization." Extracted from
 * `DocumentsController` (EMCP-024) so `SnapshotsController` (EMCP-037) computes
 * the *same* hash the same way — two independent implementations of this
 * rule would drift the moment either one is touched.
 */
final class DocumentHasher {

	public static function hash( array $elements, array $page_settings ): string {
		$canonical = self::canonicalize(
			[
				'elements'      => $elements,
				'page_settings' => $page_settings,
			]
		);

		return hash( 'sha256', (string) wp_json_encode( $canonical ) );
	}

	/**
	 * Associative (object-shaped) sub-arrays get their keys sorted before
	 * hashing, so key order never changes the hash; list-shaped arrays (the
	 * actual element tree — order is meaningful there) are left alone.
	 * `array_is_list()` (PHP 8.1+, matches this plugin's minimum) is exactly
	 * the distinction this needs.
	 */
	private static function canonicalize( mixed $value ): mixed {
		if ( ! is_array( $value ) ) {
			return $value;
		}

		if ( array_is_list( $value ) ) {
			return array_map( [ self::class, 'canonicalize' ], $value );
		}

		ksort( $value );

		return array_map( [ self::class, 'canonicalize' ], $value );
	}
}
