<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * `emcp/v1/widgets` routes — Blueprints.md §6.
 *
 * `handle()` is `GET /widgets` — "List — never calls get_controls() across
 * the registry." Contrast with `RegistryController` (`/registry/snapshot`,
 * EMCP-017), which legitimately forces every widget's lazy control-stack
 * init because its whole job is the full schema. This endpoint's job is a
 * lightweight vocabulary listing — `name`/`title`/`categories`/`keywords`
 * only. CLAUDE.md: "Elementor's control stack is lazy... never call
 * `get_controls()` across the whole registry" — that's exactly the cost
 * this class is structured to make impossible, not just avoid by
 * discipline: `build_payload()` takes widget objects as a parameter
 * (typed `object`, not `\Elementor\Widget_Base`) precisely so
 * `WidgetsControllerTest` can feed it fakes whose `get_controls()` throws,
 * proving the cost assertion as a real, run test — not a code-review
 * promise. See that test for the actual proof.
 *
 * `show()` is `GET /widgets/{type}` (EMCP-028) — the opposite of `handle()`:
 * forces stack init for **one** named widget and returns its full,
 * uncurated control list, including each control's own `tab` (Elementor's
 * native content/style/advanced/layout grouping) and raw name (so
 * responsive breakpoint-suffixed variants like `_tablet`/`_mobile` are
 * still visible). Deliberately does **not** curate, cap, or collapse
 * anything — that's `server/src/domain/curation.ts`'s job, Node-side,
 * where it's actually unit-testable (`solution.md`'s "the plugin stays
 * thin" applied to curation the same way it was to generation detection,
 * EMCP-019).
 */
final class WidgetsController {

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		$widgets_manager = \Elementor\Plugin::$instance->widgets_manager;

		return new \WP_REST_Response( $this->build_payload( $widgets_manager->get_widget_types() ), 200 );
	}

	/** @param iterable<object> $widgets */
	public function build_payload( iterable $widgets ): array {
		$summaries = [];

		foreach ( $widgets as $widget ) {
			$summaries[] = $this->describe_widget_summary( $widget );
		}

		// Deterministic ordering (Blueprints.md §7's tools/list convention,
		// applied here too, matching RegistryController) — a listing
		// shouldn't be noisy just from PHP's registration order.
		usort( $summaries, static fn( $a, $b ) => strcmp( $a['name'], $b['name'] ) );

		return [
			'widget_count' => count( $summaries ),
			'widgets'      => $summaries,
		];
	}

	private function describe_widget_summary( object $widget ): array {
		return [
			'name'       => $widget->get_name(),
			'title'      => $widget->get_title(),
			'categories' => $widget->get_categories(),
			'keywords'   => $widget->get_keywords(),
		];
	}

	public function show( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$type            = (string) $request->get_param( 'type' );
		$widgets_manager = \Elementor\Plugin::$instance->widgets_manager;
		$widget          = $widgets_manager->get_widget_types( $type );

		if ( ! is_object( $widget ) ) {
			return new \WP_Error(
				'emcp_widget_not_found',
				__( 'No widget is registered with that type on this site.', 'emcp' ),
				[ 'status' => 404 ]
			);
		}

		return new \WP_REST_Response( $this->describe_widget_full( $widget ), 200 );
	}

	/**
	 * Forces stack init (`get_controls()`) — deliberately only reachable
	 * from `show()`, a single-widget lookup, never from `handle()`'s
	 * whole-registry list. Layout-only pseudo-controls (`section`/`tab`/
	 * `divider`/`heading`/`popover_toggle`) are still filtered — they carry
	 * no settable value, same as `RegistryController::describe_widget()` —
	 * but every real control keeps its own `tab` field, which
	 * `RegistryController`'s version drops. Nothing here decides what's
	 * "common" or collapses responsive variants; that's curation.ts's job.
	 */
	private function describe_widget_full( object $widget ): array {
		$controls = [];

		foreach ( $widget->get_controls() as $control_name => $control ) {
			if ( in_array( $control['type'] ?? '', [ 'section', 'tab', 'divider', 'heading', 'popover_toggle' ], true ) ) {
				continue;
			}

			$controls[ $control_name ] = array_filter(
				[
					'type'       => $control['type'] ?? null,
					'label'      => $control['label'] ?? null,
					'default'    => $control['default'] ?? null,
					'options'    => $control['options'] ?? null,
					'condition'  => $control['condition'] ?? null,
					'conditions' => $control['conditions'] ?? null,
					'tab'        => $control['tab'] ?? null,
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
