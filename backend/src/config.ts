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

  /** Live market data. Without a key, prices stay deterministic-simulated. */
  alphaVantage: {
    baseUrl: process.env.ALPHA_VANTAGE_BASE_URL ?? 'https://www.alphavantage.co/query',
    hasKey: Boolean(process.env.ALPHA_VANTAGE_KEY),
    timeoutMs: Number(process.env.ALPHA_VANTAGE_TIMEOUT_MS ?? 10_000),
    /**
     * The free tier allows 25 calls a day and GLOBAL_QUOTE returns the latest
     * trading day's close, not a tick. So quotes are cached for hours, not
     * seconds: a shorter TTL would spend the day's budget without ever
     * returning a different number.
     */
    quoteTtlMs: Number(process.env.ALPHA_VANTAGE_QUOTE_TTL_MS ?? 6 * 3_600_000),
    seriesTtlMs: Number(process.env.ALPHA_VANTAGE_SERIES_TTL_MS ?? 12 * 3_600_000),
    /** Most new upstream quotes one request may trigger. The rest warm up later. */
    maxFetchesPerRequest: Number(process.env.ALPHA_VANTAGE_MAX_FETCHES ?? 4),
  },

  /** Live flight search. Without a key, the generated inventory is used. */
  serpApi: {
    baseUrl: process.env.SERPAPI_BASE_URL ?? 'https://serpapi.com/search',
    hasKey: Boolean(process.env.SERPAPI_KEY),
    timeoutMs: Number(process.env.SERPAPI_TIMEOUT_MS ?? 20_000),
    cacheTtlMs: Number(process.env.SERPAPI_CACHE_TTL_MS ?? 10 * 60_000),
  },

  /**
   * Gemini powers Ori's phrasing and navigation. The rule-based engine still
   * decides every action: Gemini never gets to move money on its own.
   *
   * This key authenticates by `x-goog-api-key` header, not `?key=`.
   */
  gemini: {
    baseUrl: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta',
    model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 12_000),
    enabled: boolFlag('GEMINI_ENABLED', true) && Boolean(process.env.GEMINI_API_KEY),
  },

  /** MongoDB Atlas. Absent URI means the Mongo-backed features degrade to SQLite. */
  mongo: {
    hasUri: Boolean(process.env.MONGODB_URI),
    dbName: process.env.MONGODB_DB ?? 'orbit',
    timeoutMs: Number(process.env.MONGODB_TIMEOUT_MS ?? 8_000),
  },
} as const;

/** Kept out of `config` so logging `config` can never leak the key. */
export function readNessieKey(): string {
  return required('NESSIE_API_KEY');
}

/**
 * The remaining secrets follow the same rule: they are read through a function,
 * never held on the exported object, so `console.log(config)` stays safe.
 */
export function readAlphaVantageKey(): string {
  return required('ALPHA_VANTAGE_KEY');
}

export function readSerpApiKey(): string {
  return required('SERPAPI_KEY');
}

export function readGeminiKey(): string {
  return required('GEMINI_API_KEY');
}

export function readMongoUri(): string {
  return required('MONGODB_URI');
}
