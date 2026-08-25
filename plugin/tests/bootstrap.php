<?php
/**
 * EMCP-011: PHP unit tests run against lightweight hand-rolled WordPress
 * stubs, not a real WordPress bootstrap — that keeps `composer test` in the
 * "unit: no network" bucket (ralphloop.md's Testing Guidance). Anything
 * needing the real Elementor/WP runtime is `verify:live`'s job instead,
 * exercised so far as manual curl-based checks during each task (see
 * progress.md); scripts/verify-live.sh is where that becomes repeatable.
 */

declare(strict_types=1);

define( 'ABSPATH', __DIR__ . '/../' );

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/stubs.php';
