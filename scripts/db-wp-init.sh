#!/bin/sh
# Runs once, on first boot of db-wp, via MariaDB's docker-entrypoint-initdb.d.
# Creates two separate databases and users so wp-v4-pro and wp-v3-free never
# share a schema, even though both live in one MariaDB service.
#
# .sh scripts in docker-entrypoint-initdb.d get container env vars; .sql ones don't,
# which is why this isn't a plain .sql file.
set -eu

mariadb -u root -p"${MARIADB_ROOT_PASSWORD}" <<-SQL
	CREATE DATABASE IF NOT EXISTS wp_v4_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
	CREATE DATABASE IF NOT EXISTS wp_v3_free CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

	CREATE USER IF NOT EXISTS 'wp_v4_pro'@'%' IDENTIFIED BY '${WP_DB_PASSWORD}';
	CREATE USER IF NOT EXISTS 'wp_v3_free'@'%' IDENTIFIED BY '${WP_DB_PASSWORD}';

	GRANT ALL PRIVILEGES ON wp_v4_pro.* TO 'wp_v4_pro'@'%';
	GRANT ALL PRIVILEGES ON wp_v3_free.* TO 'wp_v3_free'@'%';

	FLUSH PRIVILEGES;
SQL
