<?php
/**
 * EMCP-035 live verification script — NOT production code, not wired into
 * the plugin. Run via: wp eval-file spikes/v4-authoring/cache-invalidation-check.php -- <post_id> <element_id> <new_text>
 * (inside the wp-v4-pro container, via docker compose run --rm wpcli-v4-pro).
 *
 * Modifies one heading widget's text through Elementor's real
 * Document::save() — never a raw _elementor_data meta write — to prove
 * (or disprove) whether cache invalidation is already handled as a side
 * effect of the real write path, ahead of EMCP-043's edit_elements tool
 * actually existing.
 */

$post_id    = (int) ( $args[0] ?? 0 );
$element_id = (string) ( $args[1] ?? '' );
$new_text   = (string) ( $args[2] ?? '' );

if ( ! $post_id || '' === $element_id || '' === $new_text ) {
	fwrite( STDERR, "Usage: wp eval-file cache-invalidation-check.php -- <post_id> <element_id> <new_text>\n" );
	exit( 1 );
}

wp_set_current_user( 1 );

$document = \Elementor\Plugin::$instance->documents->get( $post_id );

if ( ! $document ) {
	fwrite( STDERR, "No Elementor document for post {$post_id}\n" );
	exit( 1 );
}

$elements = $document->get_elements_data();

$found = false;
$walk  = function ( array &$els ) use ( &$walk, $element_id, $new_text, &$found ) {
	foreach ( $els as &$el ) {
		if ( ( $el['id'] ?? '' ) === $element_id ) {
			$el['settings']['title'] = $new_text;
			$found                   = true;
		}
		if ( ! empty( $el['elements'] ) ) {
			$walk( $el['elements'] );
		}
	}
};
$walk( $elements );

if ( ! $found ) {
	fwrite( STDERR, "Element {$element_id} not found on post {$post_id}\n" );
	exit( 1 );
}

$document->save( [ 'elements' => $elements ] );

echo "Saved. New title: {$new_text}\n";
