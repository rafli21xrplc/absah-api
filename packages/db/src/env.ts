import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Repo-root .env.local (gitignored). Loaded only outside production; real envs inject variables. */
export const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env.local', import.meta.url));

export function loadLocalEnv(file = ROOT_ENV_FILE): void {
  if (process.env.NODE_ENV === 'production' || !existsSync(file)) return;
  process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
