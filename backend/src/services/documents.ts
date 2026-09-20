// The document-shaped reads and writes, on top of `mongo.ts`.
//
// Each function here is a mirror or an enrichment, never a dependency: the
// SQLite write happens first and succeeds on its own, then this runs. Read
// paths all take a fallback, so a missing cluster costs a feature, never a page.

import type { Document } from 'mongodb';
import { COLLECTIONS, tryMongo } from './mongo.js';

// --- budget snapshots ----------------------------------------------------

/**
 * A budget plan, as it stood at the end of one month.
 *
 * The relational `Budget` row is a single mutable record: change your method
 * and last month's plan is gone. Snapshots keep it, which is what makes "was I
 * better off in July?" answerable — and they are the reason this belongs in a
 * document store, because a 50/30/20 plan and a set of zero-based envelopes do
 * not share a shape.
 */
export interface BudgetSnapshot extends Document {
  customerId: string;
  /** YYYY-MM. One snapshot per customer per month. */
  month: string;
  method: string;
  monthlyIncomeCents: number;
  safeDailyCents: number;
  surplusCents: number;
  runwayMonths: number;
  /** Whatever the chosen method produced. Shape differs per method, on purpose. */
  plan: Record<string, unknown>;
  envelopes?: { name: string; plannedCents: number; spentCents: number }[];
  householdSize: number;
  capturedAt: Date;
}

export async function saveBudgetSnapshot(snapshot: Omit<BudgetSnapshot, 'capturedAt'>): Promise<boolean> {
  return tryMongo(async (db) => {
    await db.collection<BudgetSnapshot>(COLLECTIONS.budgetSnapshots).updateOne(
      { customerId: snapshot.customerId, month: snapshot.month },
      { $set: { ...snapshot, capturedAt: new Date() } },
      { upsert: true },
    );
    return true;
  }, false);
}

/** The last `months` snapshots, newest first. Empty when Atlas is absent. */
export async function budgetHistory(customerId: string, months = 12): Promise<BudgetSnapshot[]> {
  return tryMongo(
    (db) =>
      db
        .collection<BudgetSnapshot>(COLLECTIONS.budgetSnapshots)
        .find({ customerId })
        .sort({ month: -1 })
        .limit(months)
        .toArray(),
    [],
  );
}

/**
 * How the plan has held up: months where spending stayed inside it, and the
 * trend in what was left over. This is the aggregation a relational schema
 * would need a reporting table for.
 */
export async function budgetTrend(customerId: string): Promise<{
  months: number;
  averageSurplusCents: number;
  bestMonth: string | null;
  worstMonth: string | null;
} | null> {
  return tryMongo(async (db) => {
    const rows = await db
      .collection<BudgetSnapshot>(COLLECTIONS.budgetSnapshots)
      .aggregate<{ _id: null; months: number; averageSurplusCents: number; best: string; worst: string }>([
        { $match: { customerId } },
        { $sort: { surplusCents: -1 } },
        {
          $group: {
            _id: null,
            months: { $sum: 1 },
            averageSurplusCents: { $avg: '$surplusCents' },
            best: { $first: '$month' },
            worst: { $last: '$month' },
          },
        },
      ])
      .toArray();

    const row = rows[0];
    if (!row || row.months === 0) return null;
    return {
      months: row.months,
      averageSurplusCents: Math.round(row.averageSurplusCents),
      bestMonth: row.best ?? null,
      worstMonth: row.worst ?? null,
    };
  }, null);
}

// --- bill splits ---------------------------------------------------------

/**
 * A split receipt, stored the way it is shown.
 *
 * Items, the people who shared each one, and each person's share of tax and
 * tip. Relationally that is three tables joined to render one screen; as a
 * document it is one read, and the nesting is the point rather than a problem.
 */
export interface BillSplitDocument extends Document {
  splitId: string;
  customerId: string;
  merchant: string;
  totalCents: number;
  taxCents: number;
  tipCents: number;
  items: { name: string; cents: number; quantity: number; sharedBy: string[] }[];
  people: { name: string; contact: string | null; owesCents: number; settled: boolean }[];
  /** How it was captured: on-device OCR, or entered by hand. */
  source: 'receipt_ocr' | 'manual' | 'card_purchase';
  createdAt: Date;
}

export async function saveBillSplit(split: Omit<BillSplitDocument, 'createdAt'>): Promise<boolean> {
  return tryMongo(async (db) => {
    await db
      .collection<BillSplitDocument>(COLLECTIONS.billSplits)
      .updateOne({ splitId: split.splitId }, { $set: { ...split, createdAt: new Date() } }, { upsert: true });
    return true;
  }, false);
}

export async function markSplitSettled(splitId: string, personName: string): Promise<boolean> {
  return tryMongo(async (db) => {
    const result = await db
      .collection<BillSplitDocument>(COLLECTIONS.billSplits)
      .updateOne({ splitId, 'people.name': personName }, { $set: { 'people.$.settled': true } });
    return result.modifiedCount > 0;
  }, false);
}

/**
 * Who you split bills with most, and what is still outstanding with each.
 *
 * This is the question the document model earns its place on: it needs the
 * nested `people` array unwound and grouped, which is one pipeline here and a
 * reporting query with two joins in SQL.
 */
export async function splitPartners(customerId: string): Promise<
  { name: string; splits: number; outstandingCents: number; totalCents: number }[]
> {
  return tryMongo(
    (db) =>
      db
        .collection<BillSplitDocument>(COLLECTIONS.billSplits)
        .aggregate<{ name: string; splits: number; outstandingCents: number; totalCents: number }>([
          { $match: { customerId } },
          { $unwind: '$people' },
          {
            $group: {
              _id: '$people.name',
              splits: { $sum: 1 },
              totalCents: { $sum: '$people.owesCents' },
              outstandingCents: {
                $sum: { $cond: [{ $eq: ['$people.settled', false] }, '$people.owesCents', 0] },
              },
            },
          },
          { $project: { _id: 0, name: '$_id', splits: 1, totalCents: 1, outstandingCents: 1 } },
          { $sort: { splits: -1, outstandingCents: -1 } },
          { $limit: 10 },
        ])
        .toArray(),
    [],
  );
}

// --- customer profile documents ------------------------------------------

/**
 * The sparse, always-growing part of a customer record.
 *
 * Accessibility needs, preferences, the context a support agent should see
 * before they say hello. Every one of these is optional and new ones get added
 * constantly — exactly the case where a schema migration per field is the wrong
 * tool. The identity fields a bank must control (legal name, DOB, SSN) stay in
 * SQLite where they are constrained and auditable.
 */
export interface SupportNote {
  at: Date;
  author: string;
  note: string;
}

export interface ProfileDocument extends Document {
  customerId: string;
  displayName: string;
  accessibility?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  /** Free-form notes the support team adds, newest first. */
  supportNotes: SupportNote[];
  /** Anything a future feature wants to hang on a customer. */
  extra?: Record<string, unknown>;
  updatedAt: Date;
}

export async function upsertProfile(
  customerId: string,
  patch: Partial<Omit<ProfileDocument, 'customerId' | 'updatedAt'>>,
): Promise<boolean> {
  return tryMongo(async (db) => {
    await db
      .collection<ProfileDocument>(COLLECTIONS.profiles)
      .updateOne({ customerId }, { $set: { ...patch, customerId, updatedAt: new Date() } }, { upsert: true });
    return true;
  }, false);
}

export async function readProfile(customerId: string): Promise<ProfileDocument | null> {
  return tryMongo((db) => db.collection<ProfileDocument>(COLLECTIONS.profiles).findOne({ customerId }), null);
}

/** Appends a support note without rewriting the document. */
export async function addSupportNote(customerId: string, author: string, note: string): Promise<boolean> {
  return tryMongo(async (db) => {
    await db.collection<ProfileDocument>(COLLECTIONS.profiles).updateOne(
      { customerId },
      {
        // Newest first, capped: a note history that grows without bound is a
        // document that eventually stops fitting.
        $push: {
          supportNotes: { $each: [{ at: new Date(), author, note }], $position: 0, $slice: 50 },
        },
        $set: { customerId, updatedAt: new Date() },
      } as never,
      { upsert: true },
    );
    return true;
  }, false);
}

// --- activity stream -----------------------------------------------------

/**
 * An append-only record of what happened, with whatever detail that kind of
 * event carries. TTL-expired after 180 days by the index in `mongo.ts`.
 *
 * This is the answer to "where did this come from?" for anything that is not
 * already a ledger row — a budget method changed, an invite accepted, a card
 * locked. Relationally every kind would want different columns.
 */
export interface ActivityEvent extends Document {
  customerId: string;
  kind: string;
  summary: string;
  detail?: Record<string, unknown>;
  at: Date;
}

export async function recordActivity(
  customerId: string,
  kind: string,
  summary: string,
  detail?: Record<string, unknown>,
): Promise<boolean> {
  return tryMongo(async (db) => {
    await db.collection<ActivityEvent>(COLLECTIONS.activity).insertOne({
      customerId,
      kind,
      summary,
      ...(detail ? { detail } : {}),
      at: new Date(),
    } as ActivityEvent);
    return true;
  }, false);
}

export async function recentActivity(customerId: string, limit = 50): Promise<ActivityEvent[]> {
  return tryMongo(
    (db) =>
      db.collection<ActivityEvent>(COLLECTIONS.activity).find({ customerId }).sort({ at: -1 }).limit(limit).toArray(),
    [],
  );
}
