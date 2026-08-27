export function loadRendererUrl(): string {
  return requireEnv('RENDERER_URL');
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}
