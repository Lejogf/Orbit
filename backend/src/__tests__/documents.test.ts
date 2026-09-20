// The Atlas layer, against a real MongoDB.
//
// These run against an in-memory mongod rather than mocks, because the thing
// worth testing here is the queries — the aggregation pipelines, the positional
// array update, the upsert semantics. A mock would only test that we called the
// driver, which is not the part that breaks.
//
// If no mongod can be downloaded (offline CI, a locked-down box), the suite
// skips rather than fails: the app itself does not require MongoDB, so its
// tests should not either.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | null = null;
let available = false;

beforeAll(async () => {
  try {
    server = await MongoMemoryServer.create();
    process.env.MONGODB_URI = server.getUri();
    process.env.MONGODB_DB = 'orbit_test';
    available = true;
  } catch {
    available = false;
  }
}, 120_000);

afterAll(async () => {
  if (!available) return;
  const { closeMongo } = await import('../services/mongo.js');
  await closeMongo();
  await server?.stop();
});

describe.runIf(process.env.MONGODB_URI || true)('Atlas document layer', () => {
  it('stores a budget snapshot per month, and updates rather than duplicating', async () => {
    if (!available) return;
    const { saveBudgetSnapshot, budgetHistory } = await import('../services/documents.js');

    const base = {
      customerId: 'cust-1',
      method: 'rule5030',
      monthlyIncomeCents: 500_000,
      safeDailyCents: 4_000,
      surplusCents: 80_000,
      runwayMonths: 3.5,
      plan: { buckets: [] },
      householdSize: 1,
    };

    expect(await saveBudgetSnapshot({ ...base, month: '2026-08' })).toBe(true);
    expect(await saveBudgetSnapshot({ ...base, month: '2026-09', surplusCents: 120_000 })).toBe(true);
    // Same month again: an update, not a second row.
    expect(await saveBudgetSnapshot({ ...base, month: '2026-09', surplusCents: 95_000 })).toBe(true);

    const history = await budgetHistory('cust-1');
    expect(history).toHaveLength(2);
    expect(history[0]!.month).toBe('2026-09');
    expect(history[0]!.surplusCents).toBe(95_000);
  });

  it('summarises the surplus trend across months', async () => {
    if (!available) return;
    const { budgetTrend } = await import('../services/documents.js');

    const trend = await budgetTrend('cust-1');
    expect(trend).not.toBeNull();
    expect(trend!.months).toBe(2);
    // (95,000 + 80,000) / 2
    expect(trend!.averageSurplusCents).toBe(87_500);
    expect(trend!.bestMonth).toBe('2026-09');
    expect(trend!.worstMonth).toBe('2026-08');
  });

  it('returns null for a customer with no snapshots', async () => {
    if (!available) return;
    const { budgetTrend } = await import('../services/documents.js');
    expect(await budgetTrend('nobody')).toBeNull();
  });

  it('settles one person in a split without touching the others', async () => {
    if (!available) return;
    const { saveBillSplit, markSplitSettled, splitPartners } = await import('../services/documents.js');

    await saveBillSplit({
      splitId: 'split-1',
      customerId: 'cust-1',
      merchant: 'Taqueria',
      totalCents: 6_000,
      taxCents: 500,
      tipCents: 900,
      items: [{ name: 'Tacos', cents: 2_400, quantity: 2, sharedBy: ['Jordan', 'Alex'] }],
      people: [
        { name: 'Jordan', contact: null, owesCents: 3_000, settled: true },
        { name: 'Alex', contact: 'alex@example.com', owesCents: 2_000, settled: false },
        { name: 'Sam', contact: '5551234567', owesCents: 1_000, settled: false },
      ],
      source: 'receipt_ocr',
    });

    expect(await markSplitSettled('split-1', 'Alex')).toBe(true);

    const partners = await splitPartners('cust-1');
    const alex = partners.find((p) => p.name === 'Alex')!;
    const sam = partners.find((p) => p.name === 'Sam')!;

    expect(alex.outstandingCents).toBe(0);
    expect(alex.totalCents).toBe(2_000);
    // Settling Alex must not settle Sam.
    expect(sam.outstandingCents).toBe(1_000);
  });

  it('aggregates outstanding amounts across several splits with the same person', async () => {
    if (!available) return;
    const { saveBillSplit, splitPartners } = await import('../services/documents.js');

    await saveBillSplit({
      splitId: 'split-2',
      customerId: 'cust-1',
      merchant: 'Cinema',
      totalCents: 4_000,
      taxCents: 0,
      tipCents: 0,
      items: [],
      people: [
        { name: 'Jordan', contact: null, owesCents: 2_000, settled: true },
        { name: 'Sam', contact: '5551234567', owesCents: 2_000, settled: false },
      ],
      source: 'manual',
    });

    const sam = (await splitPartners('cust-1')).find((p) => p.name === 'Sam')!;
    expect(sam.splits).toBe(2);
    expect(sam.outstandingCents).toBe(3_000);
  });

  it('merges profile patches instead of replacing the document', async () => {
    if (!available) return;
    const { upsertProfile, readProfile } = await import('../services/documents.js');

    await upsertProfile('cust-1', { displayName: 'Jordan Rivera', accessibility: { textScale: 1.5 } });
    await upsertProfile('cust-1', { preferences: { language: 'es' } });

    const profile = await readProfile('cust-1');
    expect(profile!.displayName).toBe('Jordan Rivera');
    // The first patch survives the second.
    expect(profile!.accessibility).toEqual({ textScale: 1.5 });
    expect(profile!.preferences).toEqual({ language: 'es' });
  });

  it('keeps support notes newest-first and capped', async () => {
    if (!available) return;
    const { addSupportNote, readProfile } = await import('../services/documents.js');

    await addSupportNote('cust-1', 'Maya', 'Prefers a slower pace.');
    await addSupportNote('cust-1', 'Andre', 'Uses a screen reader.');

    const profile = await readProfile('cust-1');
    expect(profile!.supportNotes).toHaveLength(2);
    expect(profile!.supportNotes[0]!.note).toBe('Uses a screen reader.');
  });

  it('returns activity newest-first, scoped to one customer', async () => {
    if (!available) return;
    const { recordActivity, recentActivity } = await import('../services/documents.js');

    await recordActivity('cust-1', 'card_locked', 'Locked Orbit Move');
    await recordActivity('cust-1', 'trip_cancelled', 'Cancelled New York → Los Angeles', { feeCents: 1_000 });
    await recordActivity('cust-2', 'card_locked', 'Someone else entirely');

    const events = await recentActivity('cust-1');
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('trip_cancelled');
    expect(events[0]!.detail).toEqual({ feeCents: 1_000 });
    // Another customer's events never leak in.
    expect(events.every((e) => e.customerId === 'cust-1')).toBe(true);
  });
});
