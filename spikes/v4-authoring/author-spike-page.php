<?php
/**
 * EMCP-030 spike script — NOT production code, not wired into the plugin.
 * Run via: wp eval-file spikes/v4-authoring/author-spike-page.php --path=... --user=1
 * (inside the wp-v4-pro container, via docker compose run --rm wpcli-v4-pro).
 *
 * Programmatically authors one V4 page (e-flexbox > e-heading, e-button)
 * with local styles and one responsive override, using Elementor's real
 * Document::save() API — never a raw _elementor_data meta write — to
 * measure what a real v4-emission compiler path would actually need to do.
 */

$post_id = (int) ( $args[0] ?? 0 );
if ( ! $post_id ) {
	fwrite( STDERR, "Usage: wp eval-file author-spike-page.php -- <post_id>\n" );
	exit( 1 );
}

wp_set_current_user( 1 );

$flexbox_id = 'a1b2c3d';
$heading_id = 'a1b2c3e';
$button_id  = 'a1b2c3f';

$elements = [
	[
		'id'       => $flexbox_id,
		'elType'   => 'e-flexbox',
		'settings' => [
			'classes' => [
				'$$type' => 'classes',
				'value'  => [ "e-{$flexbox_id}-spike01" ],
			],
		],
		'styles'   => [
			"e-{$flexbox_id}-spike01" => [
				'id'       => "e-{$flexbox_id}-spike01",
				'label'    => 'local',
				'type'     => 'class',
				'variants' => [
					[
						'meta'       => [ 'breakpoint' => 'desktop', 'state' => null ],
						'props'      => [
							'flex-direction' => [ '$$type' => 'string', 'value' => 'column' ],
							'gap'            => [ '$$type' => 'size', 'value' => [ 'size' => 16, 'unit' => 'px' ] ],
						],
						'custom_css' => null,
					],
				],
			],
		],
		'elements' => [
			[
				'id'         => $heading_id,
				'elType'     => 'widget',
				'widgetType' => 'e-heading',
				'settings'   => [
					'title' => [
						'$$type' => 'html-v3',
						'value'  => [
							'content'  => [ '$$type' => 'string', 'value' => 'V4 Authoring Spike' ],
							'children' => [],
						],
					],
				],
				'elements'   => [],
			],
			[
				'id'         => $button_id,
				'elType'     => 'widget',
				'widgetType' => 'e-button',
				'settings'   => [
					'text' => [
						'$$type' => 'html-v3',
						'value'  => [
							'content'  => [ '$$type' => 'string', 'value' => 'Spike Button' ],
							'children' => [],
						],
					],
					'classes' => [
						'$$type' => 'classes',
						'value'  => [ "e-{$button_id}-spike02" ],
					],
				],
				'styles'     => [
					"e-{$button_id}-spike02" => [
						'id'       => "e-{$button_id}-spike02",
						'label'    => 'local',
						'type'     => 'class',
						'variants' => [
							[
								'meta'       => [ 'breakpoint' => 'desktop', 'state' => null ],
								'props'      => [
									'padding' => [
										'$$type' => 'dimensions',
										'value'  => [
											'top'    => [ '$$type' => 'size', 'value' => [ 'size' => 16, 'unit' => 'px' ] ],
											'right'  => [ '$$type' => 'size', 'value' => [ 'size' => 24, 'unit' => 'px' ] ],
											'bottom' => [ '$$type' => 'size', 'value' => [ 'size' => 16, 'unit' => 'px' ] ],
											'left'   => [ '$$type' => 'size', 'value' => [ 'size' => 24, 'unit' => 'px' ] ],
										],
									],
								],
								'custom_css' => null,
							],
							// The one responsive override the spike AC asks for:
							// same local class, a second variant scoped to tablet.
							[
								'meta'       => [ 'breakpoint' => 'tablet', 'state' => null ],
								'props'      => [
									'padding' => [
										'$$type' => 'dimensions',
										'value'  => [
											'top'    => [ '$$type' => 'size', 'value' => [ 'size' => 10, 'unit' => 'px' ] ],
											'right'  => [ '$$type' => 'size', 'value' => [ 'size' => 14, 'unit' => 'px' ] ],
											'bottom' => [ '$$type' => 'size', 'value' => [ 'size' => 10, 'unit' => 'px' ] ],
											'left'   => [ '$$type' => 'size', 'value' => [ 'size' => 14, 'unit' => 'px' ] ],
										],
									],
								],
								'custom_css' => null,
							],
						],
					],
				],
				'elements'   => [],
			],
		],
	],
];

$document = \Elementor\Plugin::$instance->documents->get( $post_id );

if ( ! $document ) {
	fwrite( STDERR, "No document found for post {$post_id}\n" );
	exit( 1 );
}

$result = $document->save(
	[
		'elements' => $elements,
	]
);

// Document::save() does not set the built-with-Elementor flag itself in
// every code path this spike exercised — set explicitly, matching
// CLAUDE.md's "_elementor_edit_mode = 'builder' is required" gotcha,
// rather than assume it. Recorded as a real finding either way.
update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
update_post_meta( $post_id, '_elementor_template_type', 'wp-page' );

echo 'save() returned: ' . var_export( $result, true ) . "\n";
echo "Done.\n";
