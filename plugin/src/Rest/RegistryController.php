<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * GET /wp-json/emcp/v1/registry/snapshot — Blueprints.md §6, §9.2.
 *
 * Feeds a committed-per-sandbox JSON snapshot + CI drift check (EMCP-018),
 * and is the ground truth server/src/tools/describeWidget.ts (EMCP-028)
 * will curate down for model consumption later — this endpoint prioritises
 * fidelity over compactness, unlike that later tool.
 */
final class RegistryController {

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		return new \WP_REST_Response( $this->build_snapshot(), 200 );
	}

	private function build_snapshot(): array {
		// get_widget_types() lazily calls Widgets_Manager::init_widgets() on
		// first access if not already initialised (verified against
		// Elementor's own source, not assumed) — that registers Elementor's
		// core widgets and fires `elementor/widgets/register`, which is
		// where Pro/third-party widgets hook in. Whether every Pro widget's
		// *own* gating (inside Pro's code, not Elementor core's) requires
		// something beyond that is unverified — neither sandbox has Pro
		// installed to check against. If a captured snapshot is later found
		// missing Pro widgets a real editor session shows, that's the
		// EMCP-008-style signal to fix this for real, not a guess to make
		// now (CLAUDE.md: introspect, never assume).
		$widgets_manager = \Elementor\Plugin::$instance->widgets_manager;
		$widgets = [];

		foreach ( $widgets_manager->get_widget_types() as $widget ) {
			$widgets[] = $this->describe_widget( $widget );
		}

		// Deterministic ordering (Blueprints.md §7's tools/list convention,
		// applied here too) — a snapshot diff shouldn't be noisy just from
		// PHP's registration order.
		usort( $widgets, static fn( $a, $b ) => strcmp( $a['name'], $b['name'] ) );

		return [
			'elementor_version' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
			'plugin_version'    => EMCP_VERSION,
			'widget_count'      => count( $widgets ),
			'widgets'           => $widgets,
		];
	}

	private function describe_widget( \Elementor\Widget_Base $widget ): array {
		// Controls are lazily built per widget (CLAUDE.md) — get_controls()
		// forces that widget's own stack init. list_widgets (EMCP-027) must
		// never do this across the whole registry; this endpoint legitimately
		// does, since its entire job is the full schema.
		$controls = [];

		foreach ( $widget->get_controls() as $control_name => $control ) {
			if ( in_array( $control['type'] ?? '', [ 'section', 'tab', 'divider', 'heading', 'popover_toggle' ], true ) ) {
				continue; // layout-only groupings, not settable values
			}

			$controls[ $control_name ] = array_filter(
				[
					'type'       => $control['type'] ?? null,
					'label'      => $control['label'] ?? null,
					'default'    => $control['default'] ?? null,
					'options'    => $control['options'] ?? null,
					// Blueprints.md §6.2: validation must honour these, or
					// settings Elementor ignores at render time pass
					// validation and produce "wrote it, nothing changed".
					'condition'  => $control['condition'] ?? null,
					'conditions' => $control['conditions'] ?? null,
				],
				static fn( $value ) => null !== $value
			);
		}

		return [
			'name'       => $widget->get_name(),
			'title'      => $widget->get_title(),
			'categories' => $widget->get_categories(),
			'keywords'   => $widget->get_keywords(),
			'controls'   => $controls,
		];
	}
}
