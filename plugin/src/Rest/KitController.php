<?php

declare(strict_types=1);

namespace EMCP\Rest;

use Elementor\Modules\GlobalClasses\Global_Classes_Repository;
use Elementor\Modules\Variables\Services\Batch_Operations\Batch_Processor;
use Elementor\Modules\Variables\Services\Variables_Service;
use Elementor\Modules\Variables\Storage\Variables_Repository;

defined( 'ABSPATH' ) || exit;

/**
 * GET /wp-json/emcp/v1/kit — Blueprints.md §6, "Global styles." Read-only.
 *
 * Every value is read through Elementor's own introspection APIs, never
 * raw post meta — `\Elementor\Plugin::$instance->kits_manager->get_active_kit()`
 * for the active kit document, `Kit::get_settings()` (inherited from
 * `Base_Object`, confirmed against Elementor 4.2.3's own class hierarchy)
 * for colours/typography/fonts. `global_classes`/`variables` are included
 * only when the site defaults to V4 (`e_atomic_elements` active, same
 * check as `SiteController::generation_default()`) — CLAUDE.md: "Global
 * classes are an opt-in reuse layer in a separate post type
 * (`e_global_class`), not in the kit, and have separate frontend and
 * preview meta keys." This controller uses the exact same
 * `Global_Classes_Repository`/`Variables_Service` classes Elementor's own
 * built-in MCP ability (`modules/mcp/abilities/get-globals-ability.php`,
 * confirmed present and used live on this install) calls for the same
 * purpose — not reverse-engineered from meta keys.
 */
final class KitController {

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit();

		$payload = [
			'colors'                => [
				'system' => $kit->get_settings( 'system_colors' ) ?? [],
				'custom' => $kit->get_settings( 'custom_colors' ) ?? [],
			],
			'typography'            => [
				'system' => $kit->get_settings( 'system_typography' ) ?? [],
				'custom' => $kit->get_settings( 'custom_typography' ) ?? [],
			],
			'default_generic_fonts' => $kit->get_settings( 'default_generic_fonts' ) ?? '',
			'generation_default'    => $this->generation_default(),
		];

		if ( 'v4' === $payload['generation_default'] ) {
			$payload['global_classes'] = Global_Classes_Repository::make( $kit )->all()->get();
			$payload['variables']      = $this->variables( $kit );
		}

		return new \WP_REST_Response( $payload, 200 );
	}

	/**
	 * Same experiment check as `SiteController::generation_default()` —
	 * not extracted into a shared helper, since it's a single introspected
	 * call (`is_feature_active('e_atomic_elements')`) and duplicating that
	 * one line is cheaper than a premature shared abstraction across two
	 * otherwise-unrelated controllers.
	 */
	private function generation_default(): string {
		$experiments = \Elementor\Plugin::$instance->experiments;

		if ( $experiments->is_feature_active( 'e_atomic_elements' ) ) {
			return 'v4';
		}

		if ( $experiments->is_feature_active( 'container' ) ) {
			return 'v3';
		}

		return 'legacy';
	}

	private function variables( \Elementor\Core\Kits\Documents\Kit $kit ): array {
		$variables_service = new Variables_Service(
			new Variables_Repository( $kit ),
			new Batch_Processor()
		);

		$result = $variables_service->load();

		return [
			'variables' => $result['data'] ?? [],
			'total'     => isset( $result['data'] ) ? count( $result['data'] ) : 0,
			'watermark' => $result['watermark'] ?? null,
		];
	}
}
