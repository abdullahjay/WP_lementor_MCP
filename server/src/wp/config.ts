/**
 * solution.md §3: one connector URL binds a session to one site — there is
 * no `site_id` argument anywhere in this server (Blueprints.md §7). Until
 * the site registry exists (EMCP-013+), "which site" is this single env-var
 * config, matching local dev's header-auth-only posture (CLAUDE.md).
 */
export interface WordPressSiteConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

export function loadWordPressSiteConfig(): WordPressSiteConfig {
  return {
    baseUrl: requireEnv('WP_BASE_URL'),
    username: requireEnv('WP_AUTH_USER'),
    applicationPassword: requireEnv('WP_AUTH_APP_PASSWORD'),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}
