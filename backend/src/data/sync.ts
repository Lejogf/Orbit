// Writes a DataSnapshot into the SQLite mirror. Safe to re-run: records are
// matched on nessieId (or name/nickname) and upserted.
import { PrismaClient } from '@prisma/client';
import type { DataSnapshot } from './provider.js';
import { ACCOUNT_BLUEPRINTS } from './demoDataset.js';
import { hashPassword } from '../services/auth.js';

/**
 * The demo account's credentials. Published on the sign-in screen on purpose —
 * this build has no real customers and reviewers need a way in.
 */
export const DEMO_EMAIL = 'jordan.rivera@example.com';
export const DEMO_PASSWORD = 'flow-demo-2026';

/** The demo customer has had credit for about five and a half years. */
function demoCreditHistoryStart(): Date {
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - 68);
  return start;
}

// Nessie has no credit-limit field, so this is ours.
const DEFAULT_CREDIT_LIMIT_CENTS =
  ACCOUNT_BLUEPRINTS.find((a) => a.key === 'credit')?.creditLimitCents ?? 800_000;

export interface SyncResult {
  accounts: number;
  merchants: number;
  transactions: number;
}

export async function syncSnapshot(
  prisma: PrismaClient,
  snapshot: DataSnapshot,
  /** Seed into this customer instead of the demo one. */
  targetCustomerId?: string,
): Promise<SyncResult> {
  // Matched on the demo flag, since the mock provider has no Nessie id.
  const existing = targetCustomerId
    ? await prisma.customer.findUnique({ where: { id: targetCustomerId } })
    : await prisma.customer.findFirst({ where: { isDemoUser: true } });
  const demoCredentials = await hashPassword(DEMO_PASSWORD);

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        // A real customer keeps their own name; only the demo row is overwritten.
        data: existing.isDemoUser
          ? {
              nessieId: snapshot.customer.nessieId,
              firstName: snapshot.customer.firstName,
              lastName: snapshot.customer.lastName,
              // Re-applied on every seed, so a re-run refreshes the demo
              // customer's credit history rather than leaving it stale.
              creditHistoryStartedAt: demoCreditHistoryStart(),
            }
          : {},
      })
    : await prisma.customer.create({
        data: {
          nessieId: snapshot.customer.nessieId,
          firstName: snapshot.customer.firstName,
          lastName: snapshot.customer.lastName,
          isDemoUser: true,
          email: DEMO_EMAIL,
          passwordHash: demoCredentials.hash,
          passwordSalt: demoCredentials.salt,
          phone: '(804) 555-0142',
          addressLine1: '1680 Capital One Dr',
          city: 'McLean',
          state: 'VA',
          postalCode: '22102',
          dateOfBirth: new Date('1994-06-12T00:00:00.000Z'),
          ssnLast4: '4417',
          // Credit history begins long before someone joins Flow. Falling back
          // to the oldest transaction would date it to six months and badly
          // understate an established borrower.
          creditHistoryStartedAt: demoCreditHistoryStart(),
          preferences: { create: {} },
        },
      });

  // merchant ref (key or nessieId) -> local row id
  const merchantIdByRef = new Map<string, string>();

  for (const merchant of snapshot.merchants) {
    const match = merchant.nessieId
      ? await prisma.merchant.findUnique({ where: { nessieId: merchant.nessieId } })
      : await prisma.merchant.findFirst({ where: { name: merchant.name, nessieId: null } });

    const row = match
      ? await prisma.merchant.update({
          where: { id: match.id },
          data: {
            name: merchant.name,
            category: merchant.category,
            cancelUrl: merchant.cancelUrl,
            nessieId: merchant.nessieId,
            lastUsedAt: merchant.lastUsedAt ? new Date(merchant.lastUsedAt) : undefined,
            trialConvertsToCents: merchant.trialConvertsToCents,
          },
        })
      : await prisma.merchant.create({
          data: {
            nessieId: merchant.nessieId,
            name: merchant.name,
            category: merchant.category,
            cancelUrl: merchant.cancelUrl,
            lastUsedAt: merchant.lastUsedAt ? new Date(merchant.lastUsedAt) : null,
            trialConvertsToCents: merchant.trialConvertsToCents,
          },
        });

    if (merchant.key) merchantIdByRef.set(merchant.key, row.id);
    if (merchant.nessieId) merchantIdByRef.set(merchant.nessieId, row.id);
  }

  // --- accounts ---
  const accountIdByRef = new Map<string, string>();

  for (const account of snapshot.accounts) {
    const match = account.nessieId
      ? await prisma.account.findUnique({ where: { nessieId: account.nessieId } })
      : await prisma.account.findFirst({
          where: { customerId: customer.id, nickname: account.nickname },
        });

    // Preserve any limit we already hold; fall back to the blueprint default.
    const creditLimitCents =
      account.creditLimitCents ??
      match?.creditLimitCents ??
      (account.type === 'Credit Card' ? DEFAULT_CREDIT_LIMIT_CENTS : null);

    const row = match
      ? await prisma.account.update({
          where: { id: match.id },
          data: {
            nessieId: account.nessieId,
            type: account.type,
            nickname: account.nickname,
            last4: account.last4,
            balanceCents: account.balanceCents,
            creditLimitCents,
            rewardsCents: account.rewardsCents ?? 0,
          },
        })
      : await prisma.account.create({
          data: {
            nessieId: account.nessieId,
            customerId: customer.id,
            type: account.type,
            nickname: account.nickname,
            last4: account.last4,
            balanceCents: account.balanceCents,
            creditLimitCents,
            rewardsCents: account.rewardsCents ?? 0,
          },
        });

    if (account.key) accountIdByRef.set(account.key, row.id);
    if (account.nessieId) accountIdByRef.set(account.nessieId, row.id);
  }

  // The mirror is derived data, so rebuilding it wholesale is always correct
  // and much faster than upserting ~300 rows one at a time.
  const accountIds = [...new Set(accountIdByRef.values())];
  await prisma.transaction.deleteMany({ where: { accountId: { in: accountIds } } });

  const rows = snapshot.transactions.flatMap((transaction) => {
    const accountId = accountIdByRef.get(transaction.accountRef);
    // Skip rather than throw, so one odd record can't fail the whole sync.
    if (!accountId) return [];

    const merchantId = transaction.merchantRef
      ? (merchantIdByRef.get(transaction.merchantRef) ?? null)
      : null;

    return [
      {
        nessieId: transaction.nessieId,
        accountId,
        merchantId,
        source: transaction.source,
        amountCents: transaction.amountCents,
        description: transaction.description,
        postedAt: new Date(transaction.postedAt),
        category: transaction.category,
      },
    ];
  });

  if (rows.length > 0) {
    await prisma.transaction.createMany({ data: rows });
  }

  // Drop merchants left over from an earlier shape of the data.
  await prisma.merchant.deleteMany({
    where: { transactions: { none: {} }, subscriptions: { none: {} } },
  });

  return {
    accounts: accountIdByRef.size ? new Set(accountIdByRef.values()).size : 0,
    merchants: new Set(merchantIdByRef.values()).size,
    transactions: rows.length,
  };
}
