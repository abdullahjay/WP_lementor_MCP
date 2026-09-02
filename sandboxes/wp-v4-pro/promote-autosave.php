<?php
$autosave_id = (int) $args[0];
$parent_id = (int) $args[1];

\Elementor\Plugin::$instance->db->copy_elementor_meta( $autosave_id, $parent_id );

$post = get_post( $parent_id );
if ( $post->post_status !== 'publish' ) {
    wp_publish_post( $parent_id );
}

echo "Promoted autosave {$autosave_id} onto parent {$parent_id}\n";
