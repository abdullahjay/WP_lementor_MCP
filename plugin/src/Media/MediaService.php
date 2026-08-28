<?php

declare(strict_types=1);

namespace EMCP\Media;

defined( 'ABSPATH' ) || exit;

/**
 * Blueprints.md §6, `GET/POST /wp-json/emcp/v1/media` (EMCP-063). solution.md
 * §9.7's checklist, implemented literally, not just cited: "Content-derived
 * MIME validation, not extension-based. Deny anything a browser may render
 * as markup or script — SVG, `.svgz`, HTML, XML, PDF — not SVG alone. Cap
 * decoded pixel dimensions against decompression bombs. Strip EXIF. Force
 * unique filenames."
 *
 * **Content-derived, not extension-based**: every uploaded/fetched byte
 * string is sniffed with `finfo` (`FILEINFO_MIME_TYPE`) *before* anything
 * about its claimed filename or `Content-Type` header is trusted. The
 * denylist below is checked against that sniffed type — a `.jpg` that is
 * actually an SVG (or HTML, or a PHP script) is rejected regardless of what
 * its extension or upload `Content-Type` claimed.
 */
final class MediaService {

	// solution.md §9.7: "Deny anything a browser may render as markup or
	// script — SVG, .svgz, HTML, XML, PDF — not SVG alone." Checked against
	// the *sniffed* MIME type, never the caller-declared one.
	private const DENIED_MIME_TYPES = [
		'image/svg+xml',
		'text/html',
		'application/xhtml+xml',
		'text/xml',
		'application/xml',
		'application/pdf',
		'application/x-php',
		'application/x-httpd-php',
		'text/x-php',
	];

	// A generous but finite ceiling against decompression-bomb-style images
	// (a tiny file that decodes to an enormous bitmap) — solution.md §9.7:
	// "Cap decoded pixel dimensions." ~40 megapixels is well above any real
	// design asset's resolution.
	private const MAX_DECODED_PIXELS = 40_000_000;

	private const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
	private const MAX_REDIRECTS      = 5;

	/**
	 * @param array{name: string, tmp_name: string, error: int, size: int} $file `$_FILES`-shaped entry.
	 * @return array{id: int, url: string, filename: string, mime_type: string, width: int|null, height: int|null}|\WP_Error
	 */
	public function upload_file( array $file ): array|\WP_Error {
		if ( UPLOAD_ERR_OK !== $file['error'] ) {
			return new \WP_Error( 'emcp_upload_failed', __( 'The uploaded file could not be read.', 'emcp' ), [ 'status' => 400 ] );
		}

		$bytes = file_get_contents( $file['tmp_name'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents

		if ( ! is_string( $bytes ) || '' === $bytes ) {
			return new \WP_Error( 'emcp_upload_failed', __( 'The uploaded file was empty or unreadable.', 'emcp' ), [ 'status' => 400 ] );
		}

		return $this->ingest( $bytes, $file['name'] );
	}

	/**
	 * solution.md §9.5: "enforce at connect time per request, after every
	 * redirect, rejecting RFC1918/loopback/link-local... Block non-http(s)
	 * schemes." Each hop is independently validated and fetched with
	 * redirect-following *disabled* (`redirection => 0`) — a native
	 * redirect-following HTTP client would follow a Location header to an
	 * internal address without ever re-checking it, exactly the SSRF this
	 * exists to close.
	 *
	 * @return array{id: int, url: string, filename: string, mime_type: string, width: int|null, height: int|null}|\WP_Error
	 */
	public function upload_from_url( string $url, ?string $filename ): array|\WP_Error {
		$fetched = $this->fetch_url_safely( $url );

		if ( is_wp_error( $fetched ) ) {
			return $fetched;
		}

		$name = $filename;
		if ( ! is_string( $name ) || '' === $name ) {
			$path = wp_parse_url( $fetched['url'], PHP_URL_PATH );
			$name = is_string( $path ) && '' !== basename( $path ) ? basename( $path ) : 'download';
		}

		return $this->ingest( $fetched['body'], $name );
	}

	/**
	 * @return array<int, array{id: int, url: string, filename: string, mime_type: string, created_at: string}>
	 */
	public function list_all( int $limit = 100 ): array {
		$query = new \WP_Query(
			[
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => $limit,
				'orderby'        => 'date',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			]
		);

		return array_map(
			static function ( \WP_Post $post ): array {
				return [
					'id'         => $post->ID,
					'url'        => (string) wp_get_attachment_url( $post->ID ),
					'filename'   => wp_basename( get_attached_file( $post->ID ) ?: '' ),
					'mime_type'  => (string) $post->post_mime_type,
					'created_at' => get_post_time( 'c', true, $post ),
				];
			},
			$query->posts
		);
	}

	/**
	 * The full validate-then-store pipeline, shared by both ingestion paths
	 * (direct upload, URL fetch) — solution.md §9.7's checklist runs
	 * identically regardless of how the bytes arrived.
	 *
	 * @return array{id: int, url: string, filename: string, mime_type: string, width: int|null, height: int|null}|\WP_Error
	 */
	private function ingest( string $bytes, string $original_filename ): array|\WP_Error {
		if ( strlen( $bytes ) > self::MAX_DOWNLOAD_BYTES ) {
			return new \WP_Error(
				'emcp_file_too_large',
				sprintf(
					/* translators: %d: max bytes */
					__( 'File exceeds the %d byte limit.', 'emcp' ),
					self::MAX_DOWNLOAD_BYTES
				),
				[ 'status' => 400 ]
			);
		}

		// Content-derived, not extension-based: sniff the real bytes before
		// trusting anything about the filename.
		$finfo     = finfo_open( FILEINFO_MIME_TYPE );
		$real_mime = false !== $finfo ? finfo_buffer( $finfo, $bytes ) : false;
		if ( false !== $finfo ) {
			finfo_close( $finfo );
		}

		if ( ! is_string( $real_mime ) || '' === $real_mime ) {
			return new \WP_Error( 'emcp_mime_undetermined', __( 'Could not determine the file\'s real content type.', 'emcp' ), [ 'status' => 400 ] );
		}

		if ( in_array( $real_mime, self::DENIED_MIME_TYPES, true ) ) {
			return new \WP_Error(
				'emcp_mime_denied',
				sprintf(
					/* translators: %s: real, sniffed MIME type */
					__( 'Content type "%s" is not allowed — it may be rendered as markup or script.', 'emcp' ),
					$real_mime
				),
				[ 'status' => 400 ]
			);
		}

		$allowed_mimes = array_unique( array_values( get_allowed_mime_types() ) );
		if ( ! in_array( $real_mime, $allowed_mimes, true ) ) {
			return new \WP_Error(
				'emcp_mime_not_allowed',
				sprintf(
					/* translators: %s: real, sniffed MIME type */
					__( 'Content type "%s" is not in this site\'s allowed upload types.', 'emcp' ),
					$real_mime
				),
				[ 'status' => 400 ]
			);
		}

		$is_image = str_starts_with( $real_mime, 'image/' );
		$width    = null;
		$height   = null;

		if ( $is_image ) {
			$dimensions = @getimagesizefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged

			if ( is_array( $dimensions ) ) {
				$width  = (int) $dimensions[0];
				$height = (int) $dimensions[1];

				if ( $width * $height > self::MAX_DECODED_PIXELS ) {
					return new \WP_Error(
						'emcp_image_too_large',
						__( 'Image exceeds the maximum decoded pixel dimensions.', 'emcp' ),
						[ 'status' => 400 ]
					);
				}
			}

			// Strip EXIF by round-tripping through GD, which never preserves
			// it — best-effort: if GD can't decode this particular image
			// format, the original bytes are stored as-is rather than
			// failing the whole upload over a metadata-stripping step.
			$stripped = $this->strip_exif( $bytes, $real_mime );
			if ( null !== $stripped ) {
				$bytes = $stripped;
			}
		}

		$upload_dir = wp_upload_dir();

		if ( is_array( $upload_dir ) && ! empty( $upload_dir['error'] ) ) {
			return new \WP_Error( 'emcp_upload_dir_unavailable', (string) $upload_dir['error'], [ 'status' => 500 ] );
		}

		// Force unique filenames — WordPress's own de-duplication (never
		// trusts the caller's name to already be unique on disk).
		$filename = wp_unique_filename( $upload_dir['path'], sanitize_file_name( $original_filename ) );
		$file_path = trailingslashit( $upload_dir['path'] ) . $filename;

		$written = file_put_contents( $file_path, $bytes ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

		if ( false === $written ) {
			return new \WP_Error( 'emcp_write_failed', __( 'Could not write the uploaded file to disk.', 'emcp' ), [ 'status' => 500 ] );
		}

		$attachment_id = wp_insert_attachment(
			[
				'post_mime_type' => $real_mime,
				'post_title'     => sanitize_file_name( pathinfo( $filename, PATHINFO_FILENAME ) ),
				'post_status'    => 'inherit',
			],
			$file_path
		);

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $file_path ) );

		return [
			'id'        => $attachment_id,
			'url'       => (string) wp_get_attachment_url( $attachment_id ),
			'filename'  => $filename,
			'mime_type' => $real_mime,
			'width'     => $width,
			'height'    => $height,
		];
	}

	/**
	 * Re-encodes via GD, which never carries EXIF forward — the standard,
	 * dependency-free way to strip it without a dedicated EXIF-parsing
	 * library. Returns `null` (original bytes kept) rather than failing the
	 * upload when GD lacks support for this specific format.
	 */
	private function strip_exif( string $bytes, string $mime_type ): ?string {
		if ( ! function_exists( 'imagecreatefromstring' ) ) {
			return null;
		}

		$image = @imagecreatefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged

		if ( false === $image ) {
			return null;
		}

		ob_start();
		$encoded = match ( $mime_type ) {
			'image/jpeg' => imagejpeg( $image, null, 90 ),
			'image/png'  => imagepng( $image ),
			'image/gif'  => imagegif( $image ),
			'image/webp' => function_exists( 'imagewebp' ) ? imagewebp( $image ) : false,
			default      => false,
		};
		$output = ob_get_clean();
		imagedestroy( $image );

		if ( ! $encoded || ! is_string( $output ) || '' === $output ) {
			return null;
		}

		return $output;
	}

	/**
	 * @return array{body: string, url: string}|\WP_Error
	 */
	private function fetch_url_safely( string $url ): array|\WP_Error {
		for ( $hop = 0; $hop <= self::MAX_REDIRECTS; $hop++ ) {
			$validation = $this->validate_url_safe( $url );

			if ( is_wp_error( $validation ) ) {
				return $validation;
			}

			$response = wp_remote_get(
				$url,
				[
					'redirection'         => 0, // Re-validated per hop below, never followed natively.
					'timeout'             => 15,
					'limit_response_size' => self::MAX_DOWNLOAD_BYTES,
					'reject_unsafe_urls'  => true, // Defense in depth on top of our own check.
				]
			);

			if ( is_wp_error( $response ) ) {
				return $response;
			}

			$code = wp_remote_retrieve_response_code( $response );

			if ( in_array( $code, [ 301, 302, 303, 307, 308 ], true ) ) {
				$location = wp_remote_retrieve_header( $response, 'location' );

				if ( ! is_string( $location ) || '' === $location ) {
					return new \WP_Error( 'emcp_redirect_missing_location', __( 'Redirect response had no Location header.', 'emcp' ), [ 'status' => 400 ] );
				}

				$url = str_starts_with( $location, 'http://' ) || str_starts_with( $location, 'https://' )
					? $location
					: (string) \WP_Http::make_absolute_url( $location, $url );
				continue;
			}

			if ( $code < 200 || $code >= 300 ) {
				return new \WP_Error(
					'emcp_fetch_failed',
					sprintf(
						/* translators: %d: HTTP status code */
						__( 'Fetching the URL returned HTTP %d.', 'emcp' ),
						$code
					),
					[ 'status' => 400 ]
				);
			}

			return [ 'body' => (string) wp_remote_retrieve_body( $response ), 'url' => $url ];
		}

		return new \WP_Error( 'emcp_too_many_redirects', __( 'Too many redirects while fetching the URL.', 'emcp' ), [ 'status' => 400 ] );
	}

	/**
	 * solution.md §9.5: "rejecting RFC1918/loopback/link-local... Block
	 * non-http(s) schemes and file://." `FILTER_FLAG_NO_PRIV_RANGE` excludes
	 * RFC 1918 (and IPv6 unique-local) ranges; `FILTER_FLAG_NO_RES_RANGE`
	 * excludes loopback/link-local/reserved ranges — the standard PHP idiom
	 * for exactly this SSRF check, not a hand-rolled CIDR list.
	 */
	private function validate_url_safe( string $url ): true|\WP_Error {
		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || ! in_array( $parts['scheme'] ?? '', [ 'http', 'https' ], true ) ) {
			return new \WP_Error( 'emcp_invalid_url_scheme', __( 'Only http(s) URLs are allowed.', 'emcp' ), [ 'status' => 400 ] );
		}

		$host = $parts['host'] ?? '';

		if ( '' === $host ) {
			return new \WP_Error( 'emcp_invalid_url', __( 'The URL has no host.', 'emcp' ), [ 'status' => 400 ] );
		}

		$ip = filter_var( $host, FILTER_VALIDATE_IP ) ? $host : gethostbyname( $host );

		if ( ! is_string( $ip ) || $ip === $host && ! filter_var( $host, FILTER_VALIDATE_IP ) ) {
			return new \WP_Error( 'emcp_dns_resolution_failed', __( 'Could not resolve the URL\'s host.', 'emcp' ), [ 'status' => 400 ] );
		}

		if ( ! filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
			return new \WP_Error( 'emcp_ssrf_blocked', __( 'The URL resolves to a private, loopback, or reserved address.', 'emcp' ), [ 'status' => 400 ] );
		}

		return true;
	}
}
