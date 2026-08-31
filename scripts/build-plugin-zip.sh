#!/bin/sh
# Builds a real, installable WordPress plugin ZIP from plugin/ — the
# first deployment artifact toward "install locally and on a real
# production site," decoupled from this repo's own Docker Compose dev
# setup.
#
# The dev vendor/ (gitignored, per composer.json) is built with
# --dev for PHPUnit — that vendor/ must never ship, both because it
# drags in test-only packages the plugin doesn't need at runtime, and
# because a site owner installing via wp-admin has no Composer and no
# way to run "composer install" themselves (emcp.php's own existing
# admin-notice fallback for a missing vendor/autoload.php exists
# precisely because that failure mode is otherwise silent and
# confusing). This script builds a clean --no-dev vendor/ inside an
# isolated copy and ships that instead, so the resulting zip works by
# itself: upload it in wp-admin, activate, done.
#
# Usage:
#   scripts/build-plugin-zip.sh              # writes dist/emcp.zip
#   scripts/build-plugin-zip.sh 1.2.0        # stamp a specific version
#
# Requires Composer and zip on the machine *running this script* —
# never on the target WordPress site, which only ever receives the
# finished zip.

set -eu

cd "$(dirname "$0")/.."

VERSION="${1:-}"
BUILD_DIR="$(mktemp -d)"
STAGE_DIR="$BUILD_DIR/emcp"
DIST_DIR="dist"
ZIP_PATH="$DIST_DIR/emcp.zip"

cleanup() {
	rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

if ! command -v composer >/dev/null 2>&1; then
	echo "build-plugin-zip.sh: composer is required to build the zip (not required on the target site)." >&2
	exit 1
fi

if ! php -r 'exit(class_exists("ZipArchive") ? 0 : 1);' 2>/dev/null; then
	echo "build-plugin-zip.sh: PHP's ext-zip (ZipArchive) is required to build the archive." >&2
	exit 1
fi

echo "Staging plugin files into $STAGE_DIR..."
mkdir -p "$STAGE_DIR"

# Copy everything except dev-only artifacts. `vendor/` is excluded here
# even though it may exist locally (dev's own --dev install) — a fresh
# --no-dev install runs directly into $STAGE_DIR below, never copied in.
cp -R plugin/. "$STAGE_DIR/"
rm -rf \
	"$STAGE_DIR/vendor" \
	"$STAGE_DIR/tests" \
	"$STAGE_DIR/phpunit.xml" \
	"$STAGE_DIR/.phpunit.result.cache"

# Deliberately keep composer.lock (unlike everything else stripped above):
# `composer install --no-dev` only reliably excludes require-dev packages
# when installing *from* an existing lock file — without one, Composer
# falls back to generating a fresh lock first, and that lock-generation
# step does not honour --no-dev, silently pulling all 26 PHPUnit-and-its-
# dependencies packages into the shipped zip. Confirmed by reproducing
# both paths directly, not assumed from Composer's docs.
if [ ! -f "$STAGE_DIR/composer.lock" ]; then
	echo "build-plugin-zip.sh: plugin/composer.lock is missing — run 'composer install' in plugin/ once first." >&2
	exit 1
fi

if [ -n "$VERSION" ]; then
	echo "Stamping version $VERSION..."
	# Both the plugin header (what wp-admin's plugin list reads) and the
	# EMCP_VERSION constant (what get_site_info's plugin_version reports,
	# Blueprints.md §6's version-mismatch check) must agree — drifting
	# would make the server's own MINIMUM_PLUGIN_VERSION gate lie about
	# what's actually installed.
	sed -i.bak "s/^ \* Version: .*/ * Version: $VERSION/" "$STAGE_DIR/emcp.php"
	sed -i.bak "s/define( 'EMCP_VERSION', '.*' );/define( 'EMCP_VERSION', '$VERSION' );/" "$STAGE_DIR/emcp.php"
	rm -f "$STAGE_DIR/emcp.php.bak"
fi

echo "Installing production dependencies (--no-dev)..."
composer install --no-dev --optimize-autoloader --no-interaction --working-dir="$STAGE_DIR" >/dev/null

echo "Building $ZIP_PATH..."
mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

# PHP's bundled ZipArchive extension, not the external `zip` CLI — every
# machine that can run this script already has PHP (Composer needs it),
# so this needs nothing beyond what's already required, on any OS.
ABS_ZIP_PATH="$(cd "$DIST_DIR" && pwd)/$(basename "$ZIP_PATH")"
php -r '
	$stageDir = $argv[1];
	$zipPath = $argv[2];
	$zip = new ZipArchive();
	if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
		fwrite(STDERR, "Could not create $zipPath\n");
		exit(1);
	}
	$base = dirname($stageDir);
	$iterator = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator($stageDir, FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::SELF_FIRST
	);
	foreach ($iterator as $path) {
		$localName = substr($path->getPathname(), strlen($base) + 1);
		$localName = str_replace(DIRECTORY_SEPARATOR, "/", $localName);
		if ($path->isDir()) {
			$zip->addEmptyDir($localName);
		} else {
			$zip->addFile($path->getPathname(), $localName);
		}
	}
	$zip->close();
' "$STAGE_DIR" "$ABS_ZIP_PATH"

echo "Built $(pwd)/$ZIP_PATH"
echo "Install via wp-admin: Plugins -> Add New -> Upload Plugin, or unzip into wp-content/plugins/ directly."
