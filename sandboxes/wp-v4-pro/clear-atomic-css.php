<?php
$post_id = (int) $args[0];

do_action( 'elementor/atomic-widgets/styles/clear', [ 'local', $post_id ] );

echo "Cleared atomic style cache for post {$post_id}\n";
