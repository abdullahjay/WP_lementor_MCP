<?php

declare(strict_types=1);

namespace EMCP\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * GET /wp-json/emcp/v1/site — Blueprints.md §6.
 *
 * Every value here is read from Elementor's own runtime APIs at call time
 * (CLAUDE.md: "Introspect Elementor; never hardcode widget names, control
 * names or breakpoints"), not assumed from documentation. See EMCP-004's
 * progress.md log for how each field was verified against a live install.
 */
final class SiteController {

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		return new \WP_REST_Response( $this->build_payload(), 200 );
	}

	private function build_payload(): array {
		return [
			'elementor_version'  => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
			'generation_default' => $this->generation_default(),
			'pro_tier'           => $this->pro_tier(),
			'breakpoints'        => $this->breakpoints(),
			'experiments'        => $this->experiments(),
			'css_print_method'   => get_option( 'elementor_css_print_method', 'external' ),
			'plugin_version'     => EMCP_VERSION,
		];
	}

	/**
	 * 'v4' | 'v3' | 'legacy'. Derived from the experiments Elementor itself
	 * exposes (verified live: e_atomic_elements and container are both real
	 * feature names on 4.2.3), never from a version-number assumption —
	 * V4 has been GA and default since April 2026 per solution.md §5.1, but
	 * either fork can be forced off per-site via the experiments screen.
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

	/**
	 * Not a boolean (CLAUDE.md: "'Pro' is not a boolean"). Essential-vs-
	 * Advanced tier differentiation is a deliberately unresolved item —
	 * neither sandbox has Elementor Pro installed yet (progress.md), so
	 * there is no live Pro registry to introspect for the marker solution.md
	 * §4 recommends (deriving tier from the registered widget list, e.g.
	 * Popup Builder as an Advanced-only signal). Revisit once the Pro zip
	 * is supplied and that signal can be verified rather than guessed.
	 */
	private function pro_tier(): string {
		return class_exists( '\ElementorPro\Plugin' ) ? 'pro-tier-unresolved' : 'free';
	}

	private function breakpoints(): array {
		$out = [];

		foreach ( \Elementor\Plugin::$instance->breakpoints->get_breakpoints() as $name => $breakpoint ) {
			$out[ $name ] = [
				'enabled'   => $breakpoint->is_enabled(),
				'direction' => $breakpoint->get_direction(),
				'value'     => $breakpoint->get_value(),
			];
		}

		return $out;
	}

	private function experiments(): array {
		$experiments = \Elementor\Plugin::$instance->experiments;

		return [
			// get_option() directly, per document.php: this is a plain option,
			// not a registered experiment feature.
			'element_caching' => 'disable' !== get_option( 'elementor_element_cache_ttl', '' ),
			'optimized_markup' => $experiments->is_feature_active( 'e_optimized_markup' ),
		];
	}
}
