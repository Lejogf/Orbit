// MongoDB Atlas: the document-shaped half of Orbit's data.
//
// SQLite via Prisma stays the ledger. Anything that has to add up — balances,
// transactions, plans, points — is relational, transactional and stays exactly
// where it is. Moving a balance into a document store would buy nothing and
// cost the guarantee that makes it a balance.
//
// What Atlas is genuinely better at is the data that is a DIFFERENT SHAPE for
// every row, and that we want to query across:
//
//   * **Budget snapshots.** A 50/30/20 plan, a 70/10/10/10 plan and a set of
//     zero-based envelopes have almost nothing in common as records. As a table
//     they become a pile of nullable columns; as documents they are just
//     themselves. Keeping a snapshot per month also gives us history, which the
//     single mutable Budget row cannot.
//   * **Bill splits.** A receipt is a nested thing — items, each with the
//     people who shared it, tax and tip apportioned per person. In SQL that is
//     three tables and a join to render one screen; here it is one document
//     shaped like the screen.
//   * **Customer profile documents.** Preferences, accessibility settings and
//     the notes a support agent needs are sparse and keep growing. New keys
//     should not need a migration.
//   * **Activity events.** An append-only stream of what happened, which is
//     what you want behind "where did this come from?" and what a relational
//     schema is worst at.
//
// **Atlas is never the source of truth.** Every write here happens after the
// SQLite write has succeeded, and every read has a fallback. If the cluster is
// unreachable, unconfigured, or slow, Orbit works exactly as it did before —
// it just loses the history and the cross-customer views. That is a deliberate
// trade: a hackathon demo must not be one network hiccup from a blank screen.

import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { config, readMongoUri } from '../config.js';

/** The collections Orbit uses. Named here so a typo cannot create a new one. */
export const COLLECTIONS = {
  budgetSnapshots: 'budget_snapshots',
  billSplits: 'bill_splits',
  profiles: 'customer_profiles',
  activity: 'activity_events',
} as const;

let client: MongoClient | null = null;
let database: Db | null = null;
let connecting: Promise<Db | null> | null = null;
/** Set when a connection attempt fails, so we back off instead of hammering. */
let unavailableUntil = 0;
let lastError: string | null = null;

const RETRY_AFTER_MS = 30_000;

export function mongoStatus() {
  return {
    configured: config.mongo.hasUri,
    connected: database !== null,
    database: config.mongo.dbName,
    collections: Object.values(COLLECTIONS),
    lastError,
  };
}

/**
 * The database, or null when there isn't one. Never throws: every caller has
 * a path that works without Atlas.
 */
export async function mongo(): Promise<Db | null> {
  if (!config.mongo.hasUri) return null;
  if (database) return database;
  if (Date.now() < unavailableUntil) return null;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const created = new MongoClient(readMongoUri(), {
        serverSelectionTimeoutMS: config.mongo.timeoutMs,
        connectTimeoutMS: config.mongo.timeoutMs,
        // A demo laptop does not need a big pool, and a small one fails fast.
        maxPoolSize: 10,
        retryWrites: true,
      });
      await created.connect();
      client = created;
      database = created.db(config.mongo.dbName);
      lastError = null;
      await ensureIndexes(database);
      console.log(`[mongo] connected to ${config.mongo.dbName}`);
      return database;
    } catch (error) {
      lastError = (error as Error).message;
      unavailableUntil = Date.now() + RETRY_AFTER_MS;
      console.warn(`[mongo] unavailable, continuing without it: ${lastError}`);
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Indexes, created once on connect.
 *
 * Every one of these exists because of a query below, not on principle — an
 * index nothing reads is write cost for nothing.
 */
async function ensureIndexes(db: Db): Promise<void> {
  try {
    await Promise.all([
      // "This customer's plans, newest first", and one snapshot per month.
      db.collection(COLLECTIONS.budgetSnapshots).createIndex({ customerId: 1, month: -1 }, { unique: true }),
      // "The splits I am part of", whether I created them or owe on them.
      db.collection(COLLECTIONS.billSplits).createIndex({ customerId: 1, createdAt: -1 }),
      db.collection(COLLECTIONS.billSplits).createIndex({ 'people.name': 1 }),
      // One profile document per customer.
      db.collection(COLLECTIONS.profiles).createIndex({ customerId: 1 }, { unique: true }),
      // The activity stream, and a 180-day TTL so it cannot grow for ever.
      db.collection(COLLECTIONS.activity).createIndex({ customerId: 1, at: -1 }),
      db.collection(COLLECTIONS.activity).createIndex({ at: 1 }, { expireAfterSeconds: 180 * 86_400 }),
    ]);
  } catch (error) {
    // An index failure is not worth losing the connection over.
    console.warn('[mongo] index creation failed:', (error as Error).message);
  }
}

/** A typed handle, or null. */
export async function collection<T extends Document>(name: string): Promise<Collection<T> | null> {
  const db = await mongo();
  return db ? db.collection<T>(name) : null;
}

/**
 * Run a Mongo operation, swallowing every failure.
 *
 * This is the shape of every write in this file: Atlas is a mirror, so a
 * failure here must never surface as an error the customer sees. Reads use it
 * too, falling back to whatever the caller passes as `fallback`.
 */
export async function tryMongo<T>(operation: (db: Db) => Promise<T>, fallback: T): Promise<T> {
  const db = await mongo();
  if (!db) return fallback;
  try {
    return await operation(db);
  } catch (error) {
    lastError = (error as Error).message;
    console.warn('[mongo] operation failed:', lastError);
    return fallback;
  }
}

export async function closeMongo(): Promise<void> {
  await client?.close().catch(() => undefined);
  client = null;
  database = null;
}
