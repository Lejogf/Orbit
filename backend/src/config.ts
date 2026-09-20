// Loads the .env from the PROJECT ROOT, not /backend.
//
// The API key is deliberately not on the exported `config` object — only
// readNessieKey() returns it, so there's one place that can put it on the wire.
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ -> backend/ -> project root
export const PROJECT_ROOT = path.resolve(here, '..', '..');
export const ENV_PATH = path.join(PROJECT_ROOT, '.env');

loadDotenv({ path: ENV_PATH });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Add it to ${ENV_PATH} (see .env.example).`,
    );
  }
  return value;
}

function boolFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  nessie: {
    baseUrl: required('NESSIE_BASE_URL', 'https://api.nessieisreal.com').replace(/\/+$/, ''),
    useMockData: boolFlag('USE_MOCK_DATA', false),
    /** Safe to expose; reveals nothing. */
    hasKey: Boolean(process.env.NESSIE_API_KEY),
    timeoutMs: Number(process.env.NESSIE_TIMEOUT_MS ?? 15_000),
  },
} as const;

/** Kept out of `config` so logging `config` can never leak the key. */
export function readNessieKey(): string {
  return required('NESSIE_API_KEY');
}
