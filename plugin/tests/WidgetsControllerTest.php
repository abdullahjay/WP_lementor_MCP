<?php

declare(strict_types=1);

namespace EMCP\Tests;

use EMCP\Rest\WidgetsController;
use PHPUnit\Framework\TestCase;

/**
 * A fake widget whose get_controls() throws — standing in for a real
 * `\Elementor\Widget_Base`, which isn't stubbed (deliberately: this class
 * is duck-typed, matching WidgetsController's own `object` type hint, so
 * this fake is all a test needs, no WP/Elementor bootstrap required).
 * Calling get_controls() is exactly the cost EMCP-027's AC says must never
 * happen for a whole-registry listing — if `build_payload()` ever calls
 * it, this fake turns that into a failing test instead of a silent
 * performance regression.
 */
final class ThrowsIfControlsRequestedWidget {
	public function __construct(
		private string $name,
		private string $title,
		private array $categories = [ 'general' ],
		private array $keywords = [],
	) {}

	public function get_name(): string {
		return $this->name;
	}

	public function get_title(): string {
		return $this->title;
	}

	public function get_categories(): array {
		return $this->categories;
	}

	public function get_keywords(): array {
		return $this->keywords;
	}

	public function get_controls(): array {
		throw new \RuntimeException( 'get_controls() must never be called by list_widgets (EMCP-027).' );
	}
}

final class WidgetsControllerTest extends TestCase {

	public function test_never_calls_get_controls_across_a_multi_widget_registry(): void {
		$controller = new WidgetsController();

		$widgets = [
			new ThrowsIfControlsRequestedWidget( 'heading', 'Heading' ),
			new ThrowsIfControlsRequestedWidget( 'e-heading', 'Heading' ),
			new ThrowsIfControlsRequestedWidget( 'button', 'Button', [ 'general' ], [ 'click', 'cta' ] ),
		];

		// If build_payload() ever touches get_controls(), the fake throws
		// and this test fails — a real, run assertion of the cost, not a
		// promise kept by code review alone.
		$result = $controller->build_payload( $widgets );

		self::assertSame( 3, $result['widget_count'] );
	}

	public function test_returns_name_title_categories_keywords_only(): void {
		$controller = new WidgetsController();
		$widget     = new ThrowsIfControlsRequestedWidget( 'button', 'Button', [ 'general' ], [ 'click', 'cta' ] );

		$result = $controller->build_payload( [ $widget ] );

		self::assertSame(
			[
				'name'       => 'button',
				'title'      => 'Button',
				'categories' => [ 'general' ],
				'keywords'   => [ 'click', 'cta' ],
			],
			$result['widgets'][0]
		);
		self::assertArrayNotHasKey( 'controls', $result['widgets'][0] );
	}

	public function test_sorts_widgets_deterministically_by_name(): void {
		$controller = new WidgetsController();

		$widgets = [
			new ThrowsIfControlsRequestedWidget( 'zebra', 'Zebra' ),
			new ThrowsIfControlsRequestedWidget( 'apple', 'Apple' ),
			new ThrowsIfControlsRequestedWidget( 'mango', 'Mango' ),
		];

		$result = $controller->build_payload( $widgets );

		self::assertSame(
			[ 'apple', 'mango', 'zebra' ],
			array_column( $result['widgets'], 'name' )
		);
	}

	public function test_empty_registry_returns_zero_count_and_empty_list(): void {
		$controller = new WidgetsController();

		$result = $controller->build_payload( [] );

		self::assertSame( 0, $result['widget_count'] );
		self::assertSame( [], $result['widgets'] );
	}
}
