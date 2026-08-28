<?php

declare(strict_types=1);

namespace EMCP\Admin;

use EMCP\Approvals\ApprovalTokenService;
use EMCP\Documents\PublishService;

defined( 'ABSPATH' ) || exit;

/**
 * D3's answer (prd.md's decision table, resolved for EMCP-047): the
 * out-of-band channel `publish_draft`'s confirmation token comes from is a
 * wp-admin screen, not Slack/email — no new external service, no new
 * credentials, and it satisfies Blueprints.md §7.5's "obtainable only
 * through a channel the model cannot write to" for free. The MCP server
 * authenticates to WordPress with an Application Password over the REST
 * API only; it holds no cookie session and no WordPress nonce, so it
 * cannot load this page, submit its form, or read its response — a human
 * has to actually be logged into wp-admin. `Capabilities::can_read()`
 * (every `emcp/v1` REST route's permission callback) explicitly *rejects*
 * cookie authentication for the opposite reason — this page is the one
 * place in the plugin that deliberately requires it instead.
 *
 * Deliberately minimal: one page, under Tools, taking `?post_id=` — no new
 * menu structure, no post-list row actions, no styling beyond what
 * WordPress's admin chrome provides for free. A human visits it (linked
 * from `publish_draft`'s own `pending` response), reviews the post,
 * clicks Approve, and copies the token shown back to wherever they're
 * talking to the model.
 */
final class PublishApprovalPage {

	public const SLUG = 'emcp-publish-approval';

	private const NONCE_ACTION = 'emcp_publish_approval';

	public static function register(): void {
		add_action( 'admin_menu', [ self::class, 'add_menu_item' ] );
	}

	public static function add_menu_item(): void {
		add_management_page(
			__( 'EMCP Publish Approval', 'emcp' ),
			__( 'EMCP Publish Approval', 'emcp' ),
			'edit_posts',
			self::SLUG,
			[ self::class, 'render' ]
		);
	}

	public static function render(): void {
		$post_id = isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		echo '<div class="wrap"><h1>' . esc_html__( 'EMCP Publish Approval', 'emcp' ) . '</h1>';

		if ( $post_id <= 0 ) {
			printf(
				'<p>%s</p>',
				esc_html__( 'No post specified. This page is meant to be visited via the link publish_draft returns — pass ?post_id=<id> in the URL.', 'emcp' )
			);
			echo '</div>';
			return;
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			printf( '<p>%s</p>', esc_html__( 'No post exists with that ID.', 'emcp' ) );
			echo '</div>';
			return;
		}

		if ( ! current_user_can( 'publish_post', $post_id ) ) {
			printf( '<p>%s</p>', esc_html__( 'You are not permitted to publish this post.', 'emcp' ) );
			echo '</div>';
			return;
		}

		$issued = null;

		if ( isset( $_POST['emcp_approve'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			check_admin_referer( self::NONCE_ACTION . '_' . $post_id );
			$issued = self::approve( $post_id );
		}

		if ( is_wp_error( $issued ) ) {
			printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( $issued->get_error_message() ) );
			$issued = null;
		}

		if ( null !== $issued ) {
			echo '<div class="notice notice-success"><p>' . esc_html__( 'Approved. Copy this token and give it to the model — it expires soon and can only be used once.', 'emcp' ) . '</p></div>';
			printf(
				'<p><label for="emcp-token">%s</label><br><input type="text" id="emcp-token" readonly style="width:32em" value="%s" onclick="this.select()"></p>',
				esc_html__( 'Confirmation token', 'emcp' ),
				esc_attr( $issued['token'] )
			);
			printf(
				'<p>%s <code>%s</code></p>',
				esc_html__( 'Expires:', 'emcp' ),
				esc_html( $issued['expires_at'] )
			);
			echo '</div>';
			return;
		}

		printf(
			'<p>%s</p>',
			sprintf(
				/* translators: 1: post title, 2: post status */
				esc_html__( 'You are about to approve publishing "%1$s" (currently %2$s). Review it before approving.', 'emcp' ),
				esc_html( get_the_title( $post ) ),
				esc_html( $post->post_status )
			)
		);
		printf(
			'<p><a href="%s" target="_blank">%s</a></p>',
			esc_url( (string) get_edit_post_link( $post_id, 'raw' ) ),
			esc_html__( 'Open in the editor to review current content', 'emcp' )
		);

		echo '<form method="post">';
		wp_nonce_field( self::NONCE_ACTION . '_' . $post_id );
		printf(
			'<p><button type="submit" name="emcp_approve" value="1" class="button button-primary">%s</button></p>',
			esc_html__( 'Approve publish', 'emcp' )
		);
		echo '</form></div>';
	}

	/**
	 * @return array{token: string, expires_at: string}|\WP_Error
	 */
	private static function approve( int $post_id ): array|\WP_Error {
		$state = ( new PublishService() )->resolve_current_state( $post_id );

		if ( is_wp_error( $state ) ) {
			return $state;
		}

		return ( new ApprovalTokenService() )->issue( $post_id, $state['hash'], get_current_user_id() );
	}
}
